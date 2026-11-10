'use strict';
// Código REAL de index.html; fixtures sintéticos, sin SDK, red, escrituras ni producción.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const html = readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const fn = name => {
  const found = html.match(new RegExp(`^  (?:async )?function ${name}\\([^\\n]*\\) \\{(?:[^\\n]*\\}$|\\n[\\s\\S]*?^  \\})`, 'm'));
  assert.ok(found, `Helper REAL ${name}`); return found[0];
};
const decl = name => {
  const found = html.match(new RegExp(`^  (?:const|let) ${name} = [^\\n]+;`, 'm'));
  assert.ok(found, name); return found[0];
};
const NAMES = ['normaliseActivityText', 'activityCategory', 'activityRecordPath', 'firebasePushIdTimestamp', 'firebasePushIdBoundary', 'activityCreatedTimestamp', 'activityCopyDisplayMetadata', 'activityDisplayLinkedPath', 'activityDisplayPaymentLinks', 'activityReadDisplayRootIdentity', 'hydrateActivityDisplayMetadata', 'buildActivityDisplayItems', 'activityPreview', 'activityAnalysisPreview', 'consolidateProspectFiles', 'consolidateActivityExportProspects', 'activityQueryContextKey', 'activityEnsureQueryContext', 'invalidateActivityQueryCache', 'activityBoundedRead', 'activityCanManageAll', 'activityIsManagerScope', 'activityIsAdministrative', 'isInManagerActivityScope', 'prospectSectionPlazas'];
const STATES = ['FIREBASE_PUSH_ID_CHARS', 'ACTIVITY_QUERY_TTL_MS', 'ACTIVITY_LIGHT_FIELDS', '_activityMetadataCache', '_activityQueryEntries', '_activityQueryGeneration', '_activityQueryContext', '_activityLightReads', '_activityLightWaiters', 'PANEL_PLAZAS', 'TAMPICO_MADERO_MANAGER_EMAIL'];
const BASE = new Date('2026-11-06T10:00:00').getTime();
function harness({ store = {}, role = 'ADMINISTRATIVO', plaza = 'CHIHUAHUA', beforeRead } = {}) {
  const reads = [], usage = [];
  let now = BASE, active = 0, maximum = 0;
  const auth = { currentUser: { uid: 'operator', email: 'operator@example.test' } };
  const profile = { rol: role, plaza };
  const get = async route => {
    assert.match(route, /^gestor_activities\/(?:[^/]+\/)?[^/]+\/[^/]+$/, 'Sólo hojas, nunca raíz/expediente');
    assert.doesNotMatch(route, /historial|foto|firma|base64|gestor_photos|latitud|longitud/);
    const field = route.split('/').pop();
    assert.ok(['plaza', 'uid', 'user_uid', 'nombre_usuario', 'correo_usuario', 'rol', 'tipo', 'gestion_realizada', 'expediente_prospeccion_id', 'prospecto_raiz_id', 'seguimiento_de', 'es_expediente_prospeccion', 'promesa_pago_id', 'recepcion_pago_id', 'origen_pago_id', 'origen_pago_tipo', 'tiene_evidencia', 'has_evidence'].includes(field), field);
    reads.push(route); active++; maximum = Math.max(maximum, active);
    try {
      if (beforeRead) await beforeRead(route, { auth, profile });
      await new Promise(resolve => setImmediate(resolve));
      const value = route.split('/').reduce((record, key) => record?.[key], store);
      return { val: () => value ?? null };
    } finally { active--; }
  };
  const context = vm.createContext({ console, window: {}, auth, database: {}, get, ref: (_db, route) => route, Date: class extends Date { static now() { return now; } }, recordPanelDataUsage: (action, data) => usage.push({ action, data }) });
  vm.runInContext([...STATES.map(decl), ...NAMES.map(fn), `let _activityProfile = globalThis.profile; let _activityUserDirectory = null, _activityPageSession = null, _activityAnalysisData = null, _activityAnalysisSignature = '', _activityAnalysisLoading = null; const _activityDetailCache = new Map(); globalThis.api = { ${NAMES.join(', ')}, fields: ACTIVITY_LIGHT_FIELDS };`].join('\n\n').replace('globalThis.profile', JSON.stringify(profile)), context);
  return { api: context.api, reads, usage, auth, profile: vm.runInContext('_activityProfile', context), max: () => maximum, advance: ms => { now += ms; } };
}
const row = (id, action, extra = {}) => ({ id, tipo: 'COBRANZA', gestion_realizada: action, uid: 'gestor', user_uid: 'gestor', nombre_usuario: 'Gestor', correo_usuario: 'gestor@example.test', rol: 'GESTOR', plaza: 'CHIHUAHUA', created_at: BASE, ...extra });
const prospect = (id, extra = {}) => ({ ...row(id, '', extra), tipo: 'PROSPECCION', tipo_accion: 'LLAMADA TELEFONICA', nombre_prospecto: 'Mismo nombre' });

test('promesa, recepción, comprobación, control y renuencia: una bitácora por vínculos reales, autor raíz', () => {
  const h = harness();
  const root = row('promise', 'Promesa de pago', { uid: 'original', nombre_usuario: 'Autor original', recepcion_pago_id: 'receipt', ultima_llamada_control_id: 'call', renuencia_pago_id: 'refusal' });
  const records = [root, row('receipt', 'Recepción de pago', { promesa_pago_id: 'promise', comprobacion_id: 'check', created_at: BASE + 1 }), row('check', 'Comprobación de pago', { recepcion_pago_id: 'receipt', origen_pago_id: 'receipt', created_at: BASE + 2 }), row('call', 'Llamada de control', { promesa_pago_id: 'promise', created_at: BASE + 3, tiene_evidencia: true }), row('refusal', 'Renuencia de pago', { promesa_pago_id: 'promise', created_at: BASE + 4 })];
  const before = plain(records);
  const items = h.api.buildActivityDisplayItems(records);
  assert.equal(items.length, 1); const item = items[0];
  assert.equal(item.kind, 'payment'); assert.equal(item.key, 'payment:gestor_activities/promise');
  assert.equal(item.record, root); assert.equal(item.owner.uid, 'original'); assert.equal(item.owner.name, 'Autor original');
  assert.deepEqual(plain(item.relatedRecords.map(record => record.id)), ['promise', 'receipt', 'check', 'call', 'refusal']);
  assert.equal(item.hasEvidence, true); assert.equal(item.loadedCount, 5); assert.equal(item.latestMovementAt, BASE + 4);
  assert.deepEqual(plain(records), before); assert.equal(h.reads.length, 0);
});

test('mismo nombre, número, plaza, hilo o usuario jamás agrupa pagos/prospectos sin enlaces', () => {
  const h = harness(); const records = [row('p1', 'Promesa de pago', { numero_cliente: '42' }), row('p2', 'Recepción de pago', { numero_cliente: '42' }), prospect('x1', { hilo_prospecto: 'same' }), prospect('x2', { hilo_prospecto: 'same' }), row('other', 'Visita de cortesía')];
  assert.equal(h.api.buildActivityDisplayItems(records).length, 5); assert.equal(h.reads.length, 0);
});

test('enlaces forward-only explícitos y comprobación digital se consolidan sin inferir personas', () => {
  const h = harness(); const root = row('p', 'Promesa de pago', { comprobacion_digital_id: 'digital' });
  const item = h.api.buildActivityDisplayItems([root, row('digital', 'Comprobación de pago')])[0];
  assert.equal(item.root_id, 'p'); assert.equal(item.relatedRecords.length, 2);
});

test('extractor puro detalle retorna sólo IDs explícitos únicos y conserva ruta histórica relativa', () => {
  const h = harness(); const root = row('p', 'Promesa de pago', { _activity_path: 'gestor_activities/legacy/p', recepcion_pago_id: 'r', comprobacion_id: 'gestor_activities/legacy/c', comprobacion_digital_id: 'legacy/c', ultima_llamada_control_id: 'call', renuencia_pago_id: 'gestor_photos/invalid' });
  assert.deepEqual(plain(h.api.activityDisplayPaymentLinks(root)), ['legacy/r', 'legacy/c', 'legacy/call']); assert.equal(h.reads.length, 0);
});

test('gerente original conserva propietario; etapa y responsable más recientes siguen intactos', () => {
  const h = harness();
  const root = prospect('root', { es_expediente_prospeccion: true, uid: 'manager', user_uid: 'manager', nombre_usuario: 'Gerente original', correo_usuario: 'manager@example.test', rol: 'GERENTE', estado_expediente: 'PENDIENTE_RAFIK', tiene_evidencia: true });
  const latest = prospect('child', { seguimiento_de: 'root', uid: 'leader', user_uid: 'leader', nombre_usuario: 'Líder', correo_usuario: 'leader@example.test', rol: 'LIDER A', actualizado_en: BASE + 200, estado_expediente: 'ALTA', lider_asignado_uid: 'leader', tiene_evidencia: false });
  const consolidated = h.api.consolidateActivityExportProspects([root, latest]); const record = consolidated[0];
  assert.equal(record.uid, 'leader', 'Columna CSV/semántica histórica de última etapa no cambia');
  assert.equal(record.estado_expediente, 'ALTA'); assert.equal(record.lider_asignado_uid, 'leader');
  assert.deepEqual(Object.keys(record).filter(key => key.startsWith('_display_')), []);
  const item = h.api.buildActivityDisplayItems(consolidated)[0];
  assert.deepEqual(plain(item.owner), { uid: 'manager', name: 'Gerente original', email: 'manager@example.test', role: 'GERENTE', plaza: 'CHIHUAHUA' });
  assert.equal(item.hasEvidence, true); assert.equal(item.relatedRecords.length, 2); assert.equal(item.record.estado_expediente, 'ALTA');
});

test('proyección dueño/evidencia/acciones sobrevive activityPreview y activityAnalysisPreview sin columnas extra', () => {
  const h = harness(); const root = prospect('root', { uid: 'original', tiene_evidencia: true }); const child = prospect('child', { expediente_prospeccion_id: 'root', creado_por: 'latest', actualizado_en: BASE + 100 });
  const record = h.api.consolidateActivityExportProspects([root, child])[0];
  for (const preview of [h.api.activityPreview(record), h.api.activityAnalysisPreview(record)]) {
    const item = h.api.buildActivityDisplayItems([preview])[0];
    assert.equal(item.owner.uid, 'original'); assert.equal(item.relatedRecords.length, 2); assert.equal(item.hasEvidence, true);
    assert.equal(Object.keys(preview).some(key => key.startsWith('_display_')), false);
  }
});

test('raíz prospecto ausente muestra Autor original no disponible, nunca el creador del seguimiento', () => {
  const h = harness(); const child = prospect('child', { expediente_prospeccion_id: 'absent', seguimiento_de: 'absent', uid: 'latest', nombre_usuario: 'Último líder' });
  const item = h.api.buildActivityDisplayItems(h.api.consolidateActivityExportProspects([child]))[0];
  assert.equal(item.owner.uid, ''); assert.equal(item.owner.name, 'Autor original no disponible'); assert.equal(item.root_id, 'absent');
  assert.equal(item.record.id, 'child'); assert.equal(item.relatedRecords.length, 1);
});

test('pagos filtrados antes de agrupar: sólo movimientos cargados coincidentes, nunca reintroduce raíz', () => {
  const h = harness(); const visible = [row('receipt', 'Recepción de pago', { promesa_pago_id: 'out-of-range' })];
  const item = h.api.buildActivityDisplayItems(visible)[0];
  assert.equal(item.owner.name, 'Autor original no disponible'); assert.equal(item.record.id, 'receipt');
  assert.equal(item.relatedRecords.length, 1); assert.equal(item.loadedCount, 1); assert.equal(visible.length, 1); assert.equal(h.reads.length, 0);
});

test('paginación parcial 50+50 fusiona etapas ya cargadas; no altera registros/totales', () => {
  const h = harness(); const root = row('p', 'Promesa de pago', { uid: 'original' });
  const first = [row('r', 'Recepción de pago', { promesa_pago_id: 'p' }), ...Array.from({ length: 49 }, (_, index) => row(`regular-${index}`, 'Visita de cortesía'))];
  const later = [...first, root, row('c', 'Comprobación de pago', { recepcion_pago_id: 'r' })];
  const one = h.api.buildActivityDisplayItems(first).find(item => item.kind === 'payment');
  const merged = h.api.buildActivityDisplayItems(later).find(item => item.kind === 'payment');
  assert.equal(one.key, merged.key); assert.equal(one.loadedCount, 1); assert.equal(merged.loadedCount, 3); assert.equal(merged.owner.uid, 'original');
  assert.equal(first.length, 50); assert.equal(later.length, 52); assert.equal(h.api.buildActivityDisplayItems(later).length, 50);
});

test('rutas históricas anidadas conservan path y no colisionan por IDs homónimos', () => {
  const h = harness(); const records = ['legacyA', 'legacyB'].flatMap(container => [row('p', 'Promesa de pago', { _activity_path: `gestor_activities/${container}/p` }), row('r', 'Recepción de pago', { promesa_pago_id: 'p', _activity_path: `gestor_activities/${container}/r` })]);
  const items = h.api.buildActivityDisplayItems(records); assert.equal(items.length, 2);
  assert.deepEqual(plain(items.map(item => item.root_path).sort()), ['gestor_activities/legacyA/p', 'gestor_activities/legacyB/p']);
  assert.ok(items.every(item => item.relatedRecords.length === 2));
});

test('evidencia sólo booleanos true en cualquier etapa; no convierte strings, números ni firma en foto', () => {
  const h = harness();
  for (const extra of [{ tiene_evidencia: 'true' }, { tiene_evidencia: 1 }, { has_evidence: 'yes' }, { tiene_firma_promesa: true }, { foto_base64: 'NO-READ' }]) assert.equal(h.api.buildActivityDisplayItems([row('p', 'Promesa de pago', extra)])[0].hasEvidence, false);
  assert.equal(h.api.buildActivityDisplayItems([row('p', 'Promesa de pago', { has_evidence: true })])[0].hasEvidence, true);
});

test('hidrata raíz fuera del rango por hojas de identidad/enlace/evidencia, nunca la incorpora como etapa', async () => {
  const root = prospect('p', { uid: 'manager', user_uid: 'manager', rol: 'GERENTE', nombre_usuario: 'Gerente original', tiene_evidencia: true, historial_expediente: { secret: 'NO' }, foto_base64: 'NO' });
  const h = harness({ store: { gestor_activities: { p: root } } });
  const records = [prospect('child', { seguimiento_de: 'p', expediente_prospeccion_id: 'p', uid: 'leader', actualizado_en: BASE + 100 })];
  await h.api.hydrateActivityDisplayMetadata(records);
  const item = h.api.buildActivityDisplayItems(h.api.consolidateActivityExportProspects(records))[0];
  assert.equal(item.owner.uid, 'manager'); assert.equal(item.owner.role, 'GERENTE'); assert.equal(item.hasEvidence, true);
  assert.equal(item.relatedRecords.length, 1); assert.equal(records.length, 1); assert.equal(item.root_path, 'gestor_activities/p');
  assert.ok(h.reads.every(route => !/historial|base64|foto|latitud|longitud/.test(route))); assert.ok(h.max() <= 6);
});

test('reconsolidación de prospecto nunca sustituye dueño original por autor de última etapa', () => {
  const h = harness(); const root = prospect('p', { uid: 'original', tiene_evidencia: true }); const child = prospect('c', { seguimiento_de: 'p', uid: 'latest', actualizado_en: BASE + 100 });
  let records = h.api.consolidateActivityExportProspects([root, child]);
  records = h.api.consolidateActivityExportProspects(records.map(h.api.activityAnalysisPreview));
  const item = h.api.buildActivityDisplayItems(records)[0]; assert.equal(item.owner.uid, 'original'); assert.equal(item.hasEvidence, true); assert.equal(item.relatedRecords.length, 2);
  assert.equal(h.api.buildActivityDisplayItems([h.api.activityAnalysisPreview(row('invalid', 'Promesa de pago', { has_evidence: 'true' }))])[0].hasEvidence, false);
});

test('comprobación fuera de raíz sigue recepción→promesa sólo enlaces dirigidos y conserva ID acción hoja', async () => {
  const h = harness({ store: { gestor_activities: { p: row('p', 'Promesa de pago', { uid: 'original', tiene_evidencia: true }), r: row('r', 'Recepción de pago', { promesa_pago_id: 'p' }) } } });
  const records = [row('c', 'Comprobación de pago', { recepcion_pago_id: 'r', uid: 'latest' })];
  await h.api.hydrateActivityDisplayMetadata(records); const item = h.api.buildActivityDisplayItems(records)[0];
  assert.equal(item.root_id, 'p'); assert.equal(item.owner.uid, 'original'); assert.equal(item.record.id, 'c'); assert.equal(item.relatedRecords.length, 1); assert.equal(item.hasEvidence, true);
  assert.ok(h.reads.every(route => /^gestor_activities\/(p|r)\/[^/]+$/.test(route)));
});

test('manager scope: plaza raíz canónica se verifica primero; fuera de alcance no lee identidad/evidencia', async () => {
  const h = harness({ role: 'GERENTE', plaza: 'CHIHUAHUA', store: { gestor_activities: { p: prospect('p', { plaza: 'SALTILLO', uid: 'forbidden', tiene_evidencia: true }) } } });
  const records = [prospect('c', { seguimiento_de: 'p', uid: 'latest' })];
  await h.api.hydrateActivityDisplayMetadata(records); const item = h.api.buildActivityDisplayItems(records)[0];
  assert.deepEqual(h.reads, ['gestor_activities/p/plaza']); assert.equal(item.owner.name, 'Autor original no disponible'); assert.equal(item.hasEvidence, false);
});

test('cache contexto+TTL e invalidación existentes evitan repetir lecturas y descartan nueva sesión', async () => {
  const h = harness({ store: { gestor_activities: { p: prospect('p', { uid: 'original' }) } } });
  const make = () => [prospect('c', { seguimiento_de: 'p' })];
  await h.api.hydrateActivityDisplayMetadata(make()); const count = h.reads.length;
  await h.api.hydrateActivityDisplayMetadata(make()); assert.equal(h.reads.length, count);
  h.advance(5 * 60 * 1000); await h.api.hydrateActivityDisplayMetadata(make()); assert.equal(h.reads.length, count * 2);
  h.api.invalidateActivityQueryCache(false); await h.api.hydrateActivityDisplayMetadata(make()); assert.equal(h.reads.length, count * 3);
  h.auth.currentUser = { uid: 'new-session', email: 'new@example.test' }; await h.api.hydrateActivityDisplayMetadata(make()); assert.equal(h.reads.length, count * 4);
});

test('cambio de sesión durante lectura cancela y nunca conserva dueño de respuesta vieja', async () => {
  let changed = false;
  const h = harness({ store: { gestor_activities: { p: prospect('p') } }, beforeRead: (_route, state) => { if (!changed) { changed = true; state.auth.currentUser = null; } } });
  await assert.rejects(h.api.activityReadDisplayRootIdentity('gestor_activities/p'), /sesión|consulta/);
});

test('raíz ausente/no accesible no infiere usuario último ni descarga payloads completos', async () => {
  const h = harness(); const records = [row('r', 'Recepción de pago', { promesa_pago_id: 'missing', uid: 'latest', nombre_usuario: 'Último' })];
  await h.api.hydrateActivityDisplayMetadata(records); const item = h.api.buildActivityDisplayItems(records)[0];
  assert.equal(item.owner.uid, ''); assert.equal(item.owner.name, 'Autor original no disponible'); assert.equal(item.hasEvidence, false);
});

test('no agrega consultas de raíces sin enlaces y no acepta rutas inválidas', async () => {
  const h = harness(); await h.api.hydrateActivityDisplayMetadata([row('p', 'Promesa de pago'), prospect('x')]); assert.equal(h.reads.length, 0);
  for (const invalid of ['../bad', 'gestor_activities/a/b/c', 'gestor_photos/photo', 'a.#bad', '/outside']) assert.equal(h.api.activityDisplayLinkedPath(row('p', 'Promesa de pago'), invalid), '');
  assert.equal(await h.api.activityReadDisplayRootIdentity('gestor_photos/p'), null);
});

test('fields/previews preservan todos los vínculos existentes y evidencia sin medios', () => {
  const h = harness(); const fields = ['promesa_pago_id', 'recepcion_pago_id', 'comprobacion_id', 'comprobacion_digital_id', 'renuencia_pago_id', 'ultima_llamada_control_id', 'origen_pago_id', 'origen_pago_tipo'];
  const record = row('p', 'Promesa de pago', Object.fromEntries(fields.map(field => [field, 'explicit'])));
  for (const field of fields) { assert.ok(h.api.fields.includes(field)); assert.equal(h.api.activityPreview(record)[field], 'explicit'); assert.equal(h.api.activityAnalysisPreview(record)[field], 'explicit'); }
  assert.ok(!h.api.fields.some(field => /foto|base64|historial/.test(field)));
});
