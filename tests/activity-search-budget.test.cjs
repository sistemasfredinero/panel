'use strict';
// Offline: código REAL del lector, REST shallow, modelo visual y acciones de index.html.
// Cuenta peticiones SDK + REST y JSON sintético, sin proxy de facturación/TLS por GET.
const assert = require('node:assert/strict');
const { writeFileSync } = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const { harness, fixture, ids, BASE, plain } = require('./activity-light-query.test.cjs');
const requests = h => h.reads.length + h.restReads.length;
const bytes = h => h.payloads.reduce((sum, item) => sum + Buffer.byteLength(JSON.stringify(item)), 0);
const leaves = h => h.reads.filter(read => typeof read === 'string' && read.startsWith('gestor_activities/'));
function indexed(h, count = 1000) {
  const rows = fixture(h, count);
  h.store.activity_summaries = { plazas: { CHIHUAHUA: {} } };
  rows.forEach(row => {
    row.plaza = 'CHIHUAHUA';
    h.store.activity_summaries.plazas.CHIHUAHUA[row.id] = Object.fromEntries(Object.entries(row).filter(([field]) => !['historial_expediente', 'foto_base64', 'comentarios'].includes(field)));
  });
  const newest = rows.at(-1);
  Object.assign(newest, { tipo: 'PROSPECCION', nombre_prospecto: 'Único prospecto', tipo_accion: 'LLAMADA TELEFONICA', estado_expediente: 'CITA_PROGRAMADA' });
  Object.assign(h.store.activity_summaries.plazas.CHIHUAHUA[newest.id], { tipo: newest.tipo, nombre_prospecto: newest.nombre_prospecto, tipo_accion: newest.tipo_accion, estado_expediente: newest.estado_expediente });
  return rows;
}

test('1000 registros/1 prospecto/index completo: primera tabla50 no recorre todo, sin GET de comentarios; siguientes50 incrementales', async () => {
  const h = harness({ beforeRead: async () => new Promise(resolve => setImmediate(resolve)) });
  const rows = indexed(h);
  assert.equal(await h.window.searchActivities(), true);
  assert.equal(h.api.data().length, 50);
  assert.equal(h.api.page().lightEntry.offset, 51);
  assert.equal(h.api.page().lightEntry.complete, false);
  assert.equal(requests(h), 54, '2 shallow de cobertura + 1 query ligera + 51 verificaciones canónicas');
  assert.equal(leaves(h).length, 0, 'Ficha completa para tabla: ningún GET de hoja');
  assert.equal(h.maxInFlight(), 6);
  assert.equal(h.api.page().hasMore, true);
  const firstBytes = bytes(h), count = requests(h);
  await h.window.searchActivities(); assert.equal(requests(h), count, 'Misma firma reutilizada');
  await h.window.loadMoreActivities();
  assert.equal(h.api.data().length, 100); assert.equal(h.api.page().lightEntry.offset, 102);
  assert.equal(requests(h) - count, 52, 'Sólo query + siguientes51 verificaciones');
  assert.equal(leaves(h).length, 0);
  const oldBytes = Buffer.byteLength(JSON.stringify(Object.fromEntries(rows.map(row => [row.id, row]))));
  assert.ok(firstBytes < oldBytes / 100, `${firstBytes}/${oldBytes} JSON sintético inicial`);
  writeFileSync('/tmp/activity-search-budget-fixture.json', JSON.stringify({ synthetic: true, records: 1000, prospects: 1, firstSearch: { sdkRequests: 1, shallowRequests: 53, totalRequests: count, jsonBytes: firstBytes, candidates: 51, matches: 50, maxConcurrentRequests: h.maxInFlight() }, secondPage: { additionalRequests: requests(h) - count, totalVisible: 100 }, fullCanonicalFixtureBytes: oldBytes, note: 'JSON observado; no mide facturación, protocolo ni latencia de Firebase productivo.' }, null, 2) + '\n');
});

test('300 históricos fuera de fecha con comentarios pesados: sólo fecha por no coincidencia; fechas/keys TTL compartidas entre firmas', async () => {
  const h = harness(); indexed(h, 1000);
  const old = new Date('2026-11-02T10:00:00').getTime();
  const comments = 'COMMENT_NOT_TO_DOWNLOAD '.repeat(10000);
  for (let i = 0; i < 300; i++) h.store.gestor_activities[`z-old-${String(i).padStart(4, '0')}`] = { tipo: 'GENERAL', gestion_realizada: 'LLAMADA', plaza: 'CHIHUAHUA', created_at: old, comentarios: comments, observaciones: comments, nombre_usuario: 'NO DESCARGAR', foto_base64: comments };
  assert.equal(await h.window.searchActivities(), true); assert.equal(h.api.data().length, 50);
  const oldReads = leaves(h).filter(route => route.includes('/z-old-'));
  assert.equal(oldReads.length, 300); assert.ok(oldReads.every(route => route.endsWith('/created_at')));
  assert.equal(h.restReads.filter(route => /^gestor_activities\/z-old-/.test(route)).length, 300);
  assert.equal(requests(h), 661, 'Cobertura completa + fecha necesaria por histórico, no 60 GETs ni comentarios');
  assert.ok(!leaves(h).some(route => /\/(comentarios|observaciones|foto_base64)$/.test(route)));
  assert.equal(h.api.page().lightEntry.complete, false);
  const before = requests(h), oldReadCount = oldReads.length, metadataReads = h.restReads.length;
  h.node('activityType').value = 'GENERAL';
  assert.equal(await h.window.searchActivities(), true);
  assert.equal(leaves(h).filter(route => route.includes('/z-old-')).length, oldReadCount, 'Fechas de no coincidencias compartidas entre firmas');
  assert.equal(h.restReads.length, metadataReads, 'Presencia canónica compartida por sesión cinco minutos');
  assert.ok(requests(h) - before <= 8, 'Cambiar sólo tipo no repite600 metadatos');
  assert.ok(bytes(h) < 500000);
  assert.ok(h.maxInFlight() <= 6);
  const cache = vm.runInContext('Array.from(_activityMetadataCache.entries())', h.context);
  assert.ok(cache.length <= 2048);
  assert.ok(cache.filter(([key]) => key.includes('|light-meta|')).every(([, value]) => Object.keys(value.values).every(field => ['plaza', 'rol', 'created_at', 'timestamp', 'fecha_hora_registro', 'actualizado_en'].includes(field))));
  assert.doesNotMatch(JSON.stringify(cache), /COMMENT_NOT_TO_DOWNLOAD|NO DESCARGAR|synthetic-token/);
});

test('sin índice: filtros tipo/acción/usuario se resuelven antes de comentarios/enlaces/identidad extra', async () => {
  for (const filter of ['type', 'action', 'user']) {
    const h = harness(); const rows = fixture(h, 61); delete h.store.activity_summaries;
    rows.forEach(row => Object.assign(row, { comentarios: 'NO DESCARGAR '.repeat(10000), promesa_pago_id: 'raiz-fuera-rango' }));
    if (filter === 'type') h.node('activityType').value = 'PROSPECCION';
    if (filter === 'action') h.api.actions(['GENERAL|VALE DENEGADO']);
    if (filter === 'user') h.node('activityUser').value = 'Persona inexistente';
    assert.equal(await h.window.searchActivities(), true); assert.equal(h.api.data().length, 0);
    assert.ok(!leaves(h).some(route => /\/(comentarios|observaciones|promesa_pago_id|uid|user_uid)$/.test(route)), filter);
    assert.ok(h.maxInFlight() <= 6);
  }
});

test('proyección tabla mínima sin índice; Infinity completa campos analíticos sólo de coincidencias y una vez', async () => {
  const h = harness(); const [row] = fixture(h, 1); delete h.store.activity_summaries;
  Object.assign(row, { comentarios: 'c'.repeat(20000), motivo: 'Motivo completo', modalidad_prospeccion: 'Campo analítico', fecha_cita: '2026-11-06', se_agenda_cita: true, estatus_alta: 'ALTA', tiene_evidencia: true });
  assert.equal(await h.window.searchActivities(), true);
  for (const field of ['comentarios', 'motivo', 'modalidad_prospeccion', 'fecha_cita', 'estatus_alta']) assert.ok(!leaves(h).includes(`gestor_activities/${row.id}/${field}`), field);
  assert.equal(h.api.data()[0].tiene_evidencia, true);
  const results = await h.api.loadActivityAnalysisData();
  assert.equal(results[0].comentarios, row.comentarios); assert.equal(results[0].motivo, row.motivo);
  assert.equal(leaves(h).filter(route => route.endsWith('/comentarios')).length, 1, 'Texto largo no se relee entre fases');
  const before = requests(h); await h.api.loadActivityAnalysisData(); await h.window.searchActivities(); assert.equal(requests(h), before);
  assert.equal(h.api.page().lightEntry.complete, true); assert.equal(h.api.page().hasMore, false);
});

test('contenedor nested de1000: expansión sólo de claves, primera página lee51 hijos y nunca historial/medios', async () => {
  const h = harness(); fixture(h, 0);
  h.store.gestor_activities = { legacy: {} };
  for (let i = 0; i < 1000; i++) h.store.gestor_activities.legacy[`row-${String(i).padStart(4, '0')}`] = { tipo: 'GENERAL', gestion_realizada: 'LLAMADA', created_at: BASE + i, plaza: 'CHIHUAHUA', comentarios: 'NO DESCARGAR '.repeat(1000), historial_expediente: { a: { texto: 'NO DESCARGAR' } }, foto_base64: 'NO DESCARGAR' };
  assert.equal(await h.window.searchActivities(), true);
  assert.equal(h.api.data().length, 50);
  assert.equal(h.api.page().lightEntry.complete, false);
  assert.equal(h.restReads.filter(route => /^gestor_activities\/legacy\/row-/.test(route)).length, 51);
  assert.equal(h.api.page().lightEntry.offset, 52, 'Contenedor+51 hijos, no1000 payloads');
  assert.ok(leaves(h).every(route => !/\/(comentarios|historial_expediente|foto_base64)$/.test(route)));
  assert.ok(h.api.data().every(row => row._activity_path.startsWith('gestor_activities/legacy/')));
});

test('prospecto child/root entre páginas: key de grupo estable, etapas previas actualizadas y autor original; hidrata sólo nuevos matches', async () => {
  const h = harness(); const rows = indexed(h, 180);
  const root = rows[2], child = rows[179], later = rows[99];
  for (const row of [root, child, later]) {
    Object.assign(row, { tipo: 'PROSPECTO', nombre_prospecto: `Prospecto ${row.id}`, tipo_accion: 'LLAMADA TELEFONICA', estado_expediente: 'ALTA' });
    if (row !== root) row.seguimiento_de = root.id;
    Object.assign(h.store.activity_summaries.plazas.CHIHUAHUA[row.id], row);
    delete h.store.activity_summaries.plazas.CHIHUAHUA[row.id].foto_base64;
    delete h.store.activity_summaries.plazas.CHIHUAHUA[row.id].historial_expediente;
  }
  root.nombre_usuario = 'Autor original';
  h.store.activity_summaries.plazas.CHIHUAHUA[root.id].nombre_usuario = root.nombre_usuario;
  vm.runInContext('const _hydratedBatches = []; const _originalHydrate = hydrateActivityDisplayMetadata; hydrateActivityDisplayMetadata = async (records, active) => { _hydratedBatches.push(records.length); return _originalHydrate(records, active); };', h.context);
  assert.equal(await h.window.searchActivities(), true);
  let group = h.api.buildActivityDisplayItems(h.api.data()).find(item => item.kind === 'prospect');
  const key = group.key; assert.equal(group.owner.name, 'Autor original'); assert.equal(group.loadedCount, 1);
  assert.equal(h.api.page().lightEntry.complete, false);
  const rootReadCount = leaves(h).filter(route => route.startsWith(`gestor_activities/${root.id}/`)).length;
  await h.window.loadMoreActivities();
  group = h.api.buildActivityDisplayItems(h.api.data()).find(item => item.key === key);
  assert.ok(group); assert.equal(group.loadedCount, 2); assert.equal(group.owner.name, 'Autor original');
  assert.equal(leaves(h).filter(route => route.startsWith(`gestor_activities/${root.id}/`)).length, rootReadCount, 'Raíz no se relee');
  const hydrated = plain(vm.runInContext('_hydratedBatches', h.context));
  assert.ok(hydrated.every(count => count <= 51)); assert.deepEqual(hydrated.slice(0, 2), [51, 51], 'Nunca entry.raw acumulado102');
  const analysis = await h.api.loadActivityAnalysisData();
  const expected = h.api.consolidateActivityExportProspects(rows.map(h.api.activityAnalysisPreview)).filter(row => h.api.activityMatchesCriteria(row, h.api.currentActivityFilterCriteria()));
  assert.deepEqual(ids(analysis), ids(expected));
  group = h.api.buildActivityDisplayItems(analysis).find(item => item.key === key);
  assert.equal(group.loadedCount, 3); assert.equal(group.owner.name, 'Autor original');
});

test('caché máximo3 firmas + metadatos acotados2048/TTL5min; force/session invalidan; perfil sinrol no consulta', async () => {
  const h = harness(); indexed(h, 1300);
  for (const role of ['', 'GESTOR', '', 'ADMINISTRATIVO']) {
    h.node('activityRole').value = role;
    assert.equal(await h.window.searchActivities(), true);
  }
  assert.ok(vm.runInContext('_activityQueryEntries.size', h.context) <= 3);
  await h.api.loadActivityAnalysisData();
  assert.ok(vm.runInContext('_activityMetadataCache.size', h.context) <= 2048);
  const beforeForce = requests(h); await h.window.searchActivities({ force: true }); assert.ok(requests(h) > beforeForce);
  const beforeTTL = requests(h); h.advance(300001); await h.window.searchActivities(); assert.ok(requests(h) > beforeTTL);
  const oldContext = vm.runInContext('_activityQueryContext', h.context);
  h.auth.currentUser = { uid: 'changed', email: 'changed@example.test', getIdToken: async () => 'synthetic-token' };
  await h.window.searchActivities();
  assert.notEqual(vm.runInContext('_activityQueryContext', h.context), oldContext);
  assert.ok(vm.runInContext('Array.from(_activityMetadataCache.keys()).every(key => key.startsWith(_activityQueryContext))', h.context));
  h.api.profile().rol = '';
  const before = requests(h); assert.throws(() => h.api.activityEnsureQueryContext(), /rol o la plaza/); assert.equal(requests(h), before);
});
