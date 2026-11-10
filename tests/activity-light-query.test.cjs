'use strict';
// Sólo fixtures sintéticos y código REAL index.html. No SDK/red/datos reales.
const assert = require('node:assert/strict');
const { readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const html = readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const fn = name => {
  const match = html.match(new RegExp(`^  (?:async )?function ${name}\\([^\\n]*\\) \\{(?:[^\\n]*\\}$|\\n[\\s\\S]*?^  \\})`, 'm'));
  assert.ok(match, name); return match[0];
};
const action = name => {
  const match = html.match(new RegExp(`^  window\\.${name} = (?:async )?function\\([^\\n]*\\) \\{(?:[^\\n]*\\};$|\\n[\\s\\S]*?^  \\};)`, 'm'));
  assert.ok(match, name); return match[0];
};
const declaration = name => {
  const match = html.match(new RegExp(`^  (?:const|let) ${name} = [^\\n]+;`, 'm'));
  assert.ok(match, name); return match[0];
};
const NAMES = ['normaliseActivityText', 'activityText', 'activityCategory', 'activityCreatedTimestamp', 'firebasePushIdBoundary', 'firebasePushIdTimestamp', 'isStoredActivityRecord', 'matchesActivityUser', 'activityMatchesSelectedActions', 'activityFilterRecordAction', 'currentActivityFilterCriteria', 'activityFilterSignature', 'activityMatchesCriteria', 'activityPageRecordMatches', 'activityPreview', 'activityAnalysisPreview', 'activityRecordPath', 'loadActivityTextPage', 'loadActivityUserDirectory', 'resolveActivitySearchSource', 'activityCanManageAll', 'activityIsManagerScope', 'activityIsAdministrative', 'isInManagerActivityScope', 'prospectSectionPlazas', 'consolidateProspectFiles', 'consolidateActivityExportProspects', 'activityQueryContextKey', 'invalidateActivityQueryCache', 'activityEnsureQueryContext', 'activityBoundedRead', 'activityReadShallowKeys', 'activityCachedKeys', 'activityReadLightRecord', 'activityInitLightEntry', 'activityScanLightBatch', 'activityGetLightEntry', 'activityEnsureLightRecords', 'loadActivityAnalysisData'];
NAMES.push('activityCopyDisplayMetadata', 'activityDisplayLinkedPath', 'activityDisplayPaymentLinks', 'activityReadDisplayRootIdentity', 'hydrateActivityDisplayMetadata', 'buildActivityDisplayItems');
const STATES = ['ACTIVITY_RESULTS_PAGE_SIZE', 'FIREBASE_PUSH_ID_CHARS', 'PANEL_PLAZAS', 'TAMPICO_MADERO_MANAGER_EMAIL', 'ACTIVITY_QUERY_TTL_MS', 'ACTIVITY_LIGHT_FIELDS', '_activityQueryEntries', '_activityMetadataCache', '_activityQueryGeneration', '_activityQueryContext', '_activityLightReads', '_activityLightWaiters', '_activitySearchRun', '_activityUserDirectory', '_activityPageSession', '_activityAnalysisData', '_activityAnalysisSignature', '_activityAnalysisLoading', '_activityDetailCache', '_activitiesData', '_activitiesFiltered', '_activitiesVisibleCount'];
const DAY = '2026-11-06', BASE = new Date(`${DAY}T10:00:00`).getTime();
function snapshot(value, key = '') {
  return { key, exists: () => value != null, val: () => value == null ? null : plain(value), forEach: callback => {
    for (const [id, row] of Object.entries(value || {}).sort(([a], [b]) => a.localeCompare(b))) if (callback(snapshot(row, id)) === true) break;
  } };
}
function harness({ store = {}, role = 'ADMINISTRATIVO', plaza = 'CHIHUAHUA', beforeRead, denyShallow = false, shallowResponse } = {}) {
  const nodes = {}, reads = [], restReads = [], payloads = [], usage = [], alerts = [], forbidden = [];
  let inFlight = 0, maxInFlight = 0, gpsResets = 0, renders = 0, context, time = Date.now();
  const node = id => nodes[id] ||= { value: '', innerHTML: '', textContent: '', style: {}, setAttribute() {} };
  node('activityStartDate').value = DAY; node('activityEndDate').value = DAY;
  const auth = { currentUser: { uid: 'session-synthetic', email: 'admin@example.test', getIdToken: async () => 'synthetic-token' } };
  const deny = name => () => { forbidden.push(name); throw new Error(name); };
  const perform = async (request, rest) => {
    inFlight++; maxInFlight = Math.max(inFlight, maxInFlight);
    try {
      if (beforeRead) await beforeRead(request, { node, auth, reads, restReads });
      const route = typeof request === 'string' ? request : request.route;
      let value = route.split('/').reduce((obj, key) => obj?.[key], store);
      if (rest) value = value == null ? null : Object.fromEntries(Object.keys(value).map(key => [key, true]));
      else if (request.constraints) {
        assert.match(route, /^activity_summaries\/(plazas|users)\/[^/]+$/);
        assert.deepEqual(request.constraints.map(item => item.type), ['key', 'start', 'end', 'last']);
        assert.equal(request.constraints.at(-1).count, 51);
        const start = request.constraints[1].value, end = request.constraints[2].value;
        const selected = Object.entries(value || {}).sort(([a], [b]) => a < b ? -1 : 1).filter(([key]) => key >= start && key <= end).slice(-51);
        value = selected.length ? Object.fromEntries(selected) : null;
      } else assert.ok(route === 'notice_directory/by_uid' || /^users\/[^/]+\/(nombre_completo|nombre|correo|email)$/.test(route) || /^gestor_activities\/[^/]+\/.+/.test(route), `Prohibida lectura completa ${route}`);
      payloads.push(value ?? null);
      return value;
    } finally { inFlight--; }
  };
  const get = async request => { reads.push(plain(request)); return snapshot(await perform(request, false)); };
  const fetch = async (url, options) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://synthetic.example.test');
    assert.deepEqual([...parsed.searchParams.keys()].sort(), ['auth', 'shallow']);
    assert.equal(parsed.searchParams.get('shallow'), 'true');
    assert.equal(parsed.searchParams.get('auth'), 'synthetic-token');
    assert.equal(options.method, 'GET'); assert.equal(options.cache, 'no-store');
    assert.equal(options.credentials, 'omit'); assert.equal(options.referrerPolicy, 'no-referrer');
    const route = decodeURIComponent(parsed.pathname.slice(1).replace(/\.json$/, ''));
    assert.ok(route !== '', 'Prohibida enumeración root RTDB');
    restReads.push(route);
    if (shallowResponse) return shallowResponse(route, { auth, node });
    if (denyShallow) return { ok: false, json: async () => ({ error: 'denied' }) };
    const value = await perform(route, true);
    return { ok: true, json: async () => value };
  };
  class Clock extends Date { static now() { return time; } }
  context = vm.createContext({ window: { renderActivities: () => { renders++; } }, document: { getElementById: node }, database: {}, auth, console, Date: Clock, get, fetch,
    ref: (_, route) => route === undefined ? { toString: () => 'https://synthetic.example.test/' } : route,
    query: (route, ...constraints) => ({ route, constraints }), orderByKey: () => ({ type: 'key' }), startAt: value => ({ type: 'start', value }), endAt: value => ({ type: 'end', value }), limitToLast: count => ({ type: 'last', count }),
    recordPanelDataUsage: (name, data) => usage.push({ name, data: plain(data) }), alert: message => alerts.push(message), resetActivityLocationCache: () => { gpsResets++; },
    set: deny('set'), update: deny('update'), remove: deny('remove'), onValue: deny('onValue'), setInterval: deny('setInterval'), WebSocket: deny('WebSocket'),
  });
  vm.runInContext([...STATES.map(declaration), ...NAMES.map(fn),
    `let _activityProfile = ${JSON.stringify({ rol: role, plaza })}; let _selectedActivityActionFilters = new Set();`,
    action('searchActivities'), action('loadMoreActivities'),
    `globalThis.api = { ${NAMES.join(', ')}, data: () => _activitiesData, analysis: () => _activityAnalysisData, visible: () => _activitiesVisibleCount, page: () => _activityPageSession, profile: () => _activityProfile, actions: values => { _selectedActivityActionFilters = new Set(values); } };`,
  ].join('\n\n'), context);
  return { context, api: context.api, window: context.window, node, auth, store, reads, restReads, payloads, usage, alerts, forbidden, maxInFlight: () => maxInFlight, gpsResets: () => gpsResets, renders: () => renders, advance: ms => { time += ms; } };
}
function fixture(h, count = 240, { missing = false, prospects = false } = {}) {
  h.store.gestor_activities = {}; h.store.activity_summaries = { plazas: {}, users: {} };
  const rows = [];
  for (let i = 0; i < count; i++) {
    const id = h.api.firebasePushIdBoundary(BASE + i, '-');
    const row = { id, tipo: 'GENERAL', user_uid: 'employee-synthetic', rol: 'GESTOR', plaza: i % 3 === 0 ? 'PLAZA HISTORICA' : i % 3 === 1 ? 'CHIHUAHUA' : '', nombre_usuario: 'José Díaz', correo_usuario: 'jose@example.test', gestion_realizada: 'LLAMADA', created_at: BASE + i, comentarios: `Comentario ${i}`, historial_expediente: { fake: { fecha: BASE, texto: 'x'.repeat(6000) } }, foto_base64: 'data:image/jpeg;base64,' + 'a'.repeat(24000) };
    if (prospects && i % 9 === 0) Object.assign(row, { tipo: 'PROSPECCION', nombre_prospecto: `Prospecto ${i}`, tipo_accion: 'LLAMADA TELEFONICA', actualizado_en: BASE + i + 1000 });
    h.store.gestor_activities[id] = row; rows.push(row);
    if (row.plaza && (!missing || i % 7 !== 0)) {
      const summary = Object.fromEntries(Object.entries(row).filter(([key]) => !['historial_expediente', 'foto_base64', 'comentarios'].includes(key)));
      (h.store.activity_summaries.plazas[row.plaza] ||= {})[id] = summary;
      (h.store.activity_summaries.users['employee-synthetic'] ||= {})[id] = summary;
    }
  }
  return rows;
}
function ids(rows) { return Array.from(rows, row => row.id).sort(); }

module.exports = { harness, fixture, ids, DAY, BASE, plain };
if (require.main === module) {
test('general: 240 registros, plaza fuera catálogo/sin plaza e índice parcial; tabla50 y gráficos todo el rango sin fullcanónicos', async () => {
  const h = harness(); const rows = fixture(h, 240, { missing: true });
  assert.equal(await h.window.searchActivities(), true);
  assert.equal(h.api.data().length, 50); assert.equal(h.api.visible(), 50);
  assert.equal(h.gpsResets(), 0, 'La primera creación de contexto no cancela el mapa');
  const before = h.restReads.length + h.reads.length;
  const results = await h.api.loadActivityAnalysisData();
  assert.deepEqual(ids(results), ids(rows)); assert.equal(results.length, 240);
  assert.ok(h.restReads.length + h.reads.length > before, 'Gráficos completan más allá de50');
  assert.ok(h.reads.some(read => read.route === 'activity_summaries/plazas/PLAZA HISTORICA'));
  assert.equal(h.restReads.filter(route => route === 'gestor_activities').length, 1);
  assert.equal(h.restReads.filter(route => /^gestor_activities\/[^/]+$/.test(route)).length, 240, 'Primera página compartida no se relee');
  assert.ok(results.every(row => row.comentarios === `Comentario ${rows.findIndex(other => other.id === row.id)}`));
  assert.ok(results.every(row => !row.foto_base64 && !row.historial_expediente));
  assert.ok(h.maxInFlight() <= 6); assert.deepEqual(h.forbidden, []);
  const reads = h.restReads.length + h.reads.length;
  await h.window.searchActivities(); await Promise.all([h.api.loadActivityAnalysisData(), h.api.loadActivityAnalysisData()]);
  assert.equal(h.restReads.length + h.reads.length, reads, 'Buscar con misma firma y abrir gráficos no descargan otra vez');
  const oldBytes = Buffer.byteLength(JSON.stringify(Object.fromEntries(rows.map(row => [row.id, row]))));
  const newBytes = h.payloads.reduce((sum, value) => sum + Buffer.byteLength(JSON.stringify(value)), 0);
  assert.ok(newBytes < oldBytes * 0.1, `Reducción sintética JSON: ${newBytes}/${oldBytes}`);
  writeFileSync('/tmp/activity-light-byte-fixture.json', JSON.stringify({ synthetic: true, records: rows.length, oldBytes, newBytes, reductionPercent: (1 - newBytes / oldBytes) * 100, sdkReads: h.reads.length, shallowReads: h.restReads.length }, null, 2) + '\n');
});

test('Actualizar/TTL/session cambian contexto y datos; concurrencia en búsqueda/gráficos deduplicada', async () => {
  const h = harness(); fixture(h, 220);
  await Promise.all([h.window.searchActivities(), h.api.loadActivityAnalysisData(), h.api.loadActivityAnalysisData()]);
  assert.equal(h.restReads.filter(route => route === 'gestor_activities').length, 1);
  const readCount = h.restReads.length + h.reads.length;
  await h.window.searchActivities(); assert.equal(h.restReads.length + h.reads.length, readCount);
  await h.window.searchActivities({ force: true }); assert.ok(h.restReads.length + h.reads.length > readCount); assert.ok(h.gpsResets() >= 1);
  h.advance(300001); const expired = h.restReads.length + h.reads.length;
  await h.api.loadActivityAnalysisData(); assert.ok(h.restReads.length + h.reads.length > expired);
  h.auth.currentUser.uid = 'new-session'; await h.window.searchActivities();
  assert.equal(h.restReads.filter(route => route === 'gestor_activities').length, 4);
});

test('loadMore añade50 coincidencias, no50 candidatos; todas las páginasbounded51', async () => {
  const h = harness(); const rows = fixture(h, 280, { missing: true });
  h.node('activityPlaza').value = 'CHIHUAHUA';
  await h.window.searchActivities(); assert.equal(h.api.data().length, 50);
  await h.window.loadMoreActivities();
  assert.equal(h.api.data().length, rows.filter(row => row.plaza === 'CHIHUAHUA').length);
  assert.equal(h.api.visible(), 100); assert.equal(h.api.page().hasMore, false);
  assert.ok(h.api.data().every(row => row.plaza === 'CHIHUAHUA'));
});

test('GERENTE scope estricto: verificación sólo plaza mínima fuera alcance; desconocida y sinplaza no se hidratan', async () => {
  const h = harness({ role: 'GERENTE' }); const rows = fixture(h, 220, { missing: true });
  await h.window.searchActivities(); const results = await h.api.loadActivityAnalysisData();
  assert.deepEqual(ids(results), ids(rows.filter(row => row.plaza === 'CHIHUAHUA')));
  const outside = new Set(rows.filter(row => row.plaza !== 'CHIHUAHUA').map(row => row.id));
  assert.ok(h.reads.filter(read => typeof read === 'string' && read.startsWith('gestor_activities/')).every(read => !outside.has(read.split('/')[1]) || read.endsWith('/plaza')));
  h.node('activityPlaza').value = 'PLAZA HISTORICA'; assert.equal(await h.window.searchActivities(), false);
  assert.match(h.node('activitiesTableContainer').innerHTML, /alcance del gerente/);
});

test('índice ausente completo y ausencia de permisos shallow producen cobertura exacta o error explícito, nunca cero silencioso', async () => {
  const h = harness(); const rows = fixture(h, 230); delete h.store.activity_summaries;
  await h.window.searchActivities(); assert.deepEqual(ids(await h.api.loadActivityAnalysisData()), ids(rows));
  const denied = harness({ denyShallow: true }); fixture(denied, 230);
  assert.equal(await denied.window.searchActivities(), false);
  assert.match(denied.node('activitiesTableContainer').innerHTML, /verificar la cobertura histórica/);
  await assert.rejects(denied.api.loadActivityAnalysisData(), /verificar la cobertura histórica/);
});

test('expedientes raíz/seguimiento_de y aliasPROSPECTO: Buscar pagina50 y gráficos consolidan completo como export', async () => {
  const h = harness(); const rows = fixture(h, 220);
  const root = rows[0], child = rows[219];
  Object.assign(root, { tipo: 'PROSPECTO', nombre_prospecto: 'Raíz', estado_expediente: 'CITA_PROGRAMADA', actualizado_en: BASE + 1000 });
  Object.assign(child, { tipo: 'PROSPECTO', nombre_prospecto: 'Hijo', seguimiento_de: root.id, actualizado_en: BASE + 2000, estado_expediente: 'ALTA' });
  delete h.store.activity_summaries;
  await h.window.searchActivities(); const results = await h.api.loadActivityAnalysisData();
  const expected = h.api.consolidateActivityExportProspects(rows.map(h.api.activityAnalysisPreview)).filter(row => h.api.activityMatchesCriteria(row, h.api.currentActivityFilterCriteria()));
  assert.deepEqual(ids(results), ids(expected)); assert.equal(results.length, 219);
  const prospect = results.find(row => row.id === root.id);
  assert.equal(prospect._expediente_registros_consolidados, 2); assert.equal(prospect.nombre_prospecto, 'Hijo');
});

for (const changed of ['filtros', 'logout', 'rol']) test(`cambio de ${changed} duranteawait descarta respuesta y no repinta`, async () => {
  let release, entered; const waiting = new Promise(resolve => { entered = resolve; }); const blocked = new Promise(resolve => { release = resolve; });
  let first = true;
  const h = harness({ beforeRead: async request => { if (first && request === 'gestor_activities') { first = false; entered(); await blocked; } } }); fixture(h, 220);
  const searching = h.window.searchActivities(); await waiting;
  if (changed === 'filtros') h.node('activityUser').value = 'Otra persona';
  if (changed === 'logout') h.auth.currentUser = null;
  if (changed === 'rol') h.api.profile().rol = 'GERENTE';
  release(); assert.equal(await searching, false); assert.equal(h.renders(), 0);
});

test('directorio usuario: proyecciónby_uid y fallback scalar identidad, nuncauserscompleto/métricas', async () => {
  const h = harness();
  h.store.users = { one: { nombre_completo: 'José Díaz', correo: 'jose@example.test', data_usage_metrics: { never: 'download' } }, two: { nombre: 'Otro empleado', email: 'other@example.test' } };
  h.store.notice_directory = { by_uid: { one: { uid: 'one', name: 'José Díaz', email: 'jose@example.test' } } };
  const result = await h.api.loadActivityUserDirectory();
  assert.deepEqual(plain(result), [{ uid: 'one', nombre: 'José Díaz', correo: 'jose@example.test' }, { uid: 'two', nombre: 'Otro empleado', correo: 'other@example.test' }]);
  assert.ok(!h.reads.some(read => read === 'users')); assert.ok(!h.reads.some(read => /data_usage_metrics/.test(read)));
  const count = h.reads.length + h.restReads.length; await h.api.loadActivityUserDirectory(); assert.equal(h.reads.length + h.restReads.length, count);
});

test('claves no push: fecha mexicana y fallback sólo fechas de historia respetan el rango real', async () => {
  const h = harness(); fixture(h, 0);
  const basic = { tipo: 'GENERAL', gestion_realizada: 'LLAMADA', plaza: 'CHIHUAHUA', rol: 'GESTOR' };
  const large = 'NO DESCARGAR '.repeat(10000);
  h.store.gestor_activities = {
    'date-mx': { ...basic, fecha_hora_registro: '6/11/2026, 10:20:30 a. m.', historial_expediente: { old: { fecha: '5/11/2026' } } },
    'history-in': { ...basic, historial_expediente: { a: { fecha: '6/11/2026, 11:30 p. m.', texto: large, foto_base64: large }, z: { fecha: '7/11/2026', texto: large } }, foto_base64: large },
    'history-out': { ...basic, historial_expediente: { a: { fecha: '5/11/2026, 11:30 p. m.', texto: large } } },
    'timestamp-in': { ...basic, timestamp: BASE },
  };
  assert.equal(await h.window.searchActivities(), true);
  const results = await h.api.loadActivityAnalysisData();
  assert.deepEqual(ids(results), ['date-mx', 'history-in', 'timestamp-in']);
  assert.equal(h.api.activityCreatedTimestamp(results.find(row => row.id === 'history-in')), new Date(`${DAY}T23:30:00`).getTime());
  assert.ok(!h.restReads.includes('gestor_activities/date-mx/historial_expediente'), 'La fecha escalar evita incluso enumerar la historia');
  assert.deepEqual(h.reads.filter(read => typeof read === 'string' && read.includes('/historial_expediente/')).sort(), [
    'gestor_activities/history-in/historial_expediente/a/fecha', 'gestor_activities/history-in/historial_expediente/z/fecha', 'gestor_activities/history-out/historial_expediente/a/fecha',
  ]);
  assert.ok(h.reads.every(read => typeof read !== 'string' || !/\/(texto|foto_base64|historial_expediente)$/.test(read)));
  assert.ok(results.every(row => !row.historial_expediente && !row.foto_base64));
  assert.ok(h.maxInFlight() <= 6); assert.deepEqual(h.forbidden, []);
});

test('históricos de dos segmentos: conserva rutas reales y no confunde contenedor con actividad raíz', async () => {
  const h = harness(); const rows = fixture(h, 1);
  const large = 'NO DESCARGAR '.repeat(10000);
  h.store.gestor_activities.legacy = {
    'payment-1': { tipo: 'COBRANZA', gestion_realizada: 'PROMESA DE PAGO', plaza: 'CHIHUAHUA', created_at: BASE, foto_base64: large, historial_expediente: { x: { texto: large } } },
    'prospect-1': { tipo: 'PROSPECTO', nombre_prospecto: 'Expediente histórico', tipo_accion: 'LLAMADA TELEFONICA', plaza: 'PLAZA HISTORICA', actualizado_en: BASE, historial_expediente: { x: { fecha: '6/11/2026, 10:00 a. m.', texto: large } } },
    'old-payment': { tipo: 'COBRANZA', gestion_realizada: 'LLAMADA', created_at: new Date('2026-11-05T10:00:00').getTime() },
  };
  assert.equal(await h.window.searchActivities(), true);
  const results = await h.api.loadActivityAnalysisData();
  assert.deepEqual(ids(results), [rows[0].id, 'payment-1', 'prospect-1'].sort());
  for (const id of ['payment-1', 'prospect-1']) {
    assert.equal(h.api.activityRecordPath(results.find(row => row.id === id)), `gestor_activities/legacy/${id}`);
    assert.equal(h.api.activityRecordPath(h.api.data().find(row => row.id === id)), `gestor_activities/legacy/${id}`);
  }
  assert.ok(h.restReads.includes('gestor_activities/legacy/payment-1'));
  assert.ok(h.reads.every(read => typeof read !== 'string' || !/^gestor_activities\/legacy\/(payment-1|prospect-1|old-payment)$/.test(read)));
  assert.ok(h.reads.every(read => typeof read !== 'string' || !/\/(texto|foto_base64|historial_expediente)$/.test(read)));
  const count = h.reads.length + h.restReads.length;
  await h.window.searchActivities(); await h.api.loadActivityAnalysisData();
  assert.equal(h.reads.length + h.restReads.length, count, 'Tabla y gráficos reutilizan cobertura nested');
  assert.ok(h.maxInFlight() <= 6); assert.deepEqual(h.forbidden, []);
});

test('GERENTE con históricos nested sólo hidrata plaza fuera de alcance, sin tipo ni historia ni medios', async () => {
  const h = harness({ role: 'GERENTE' }); fixture(h, 0);
  const basic = { tipo: 'GENERAL', gestion_realizada: 'LLAMADA', created_at: BASE, historial_expediente: { a: { texto: 'NO DESCARGAR' } }, foto_base64: 'NO DESCARGAR' };
  h.store.gestor_activities.legacy = {
    inside: { ...basic, plaza: 'CHIHUAHUA' },
    outside: { ...basic, plaza: 'TAMPICO' },
    unknown: { ...basic, plaza: 'PLAZA HISTORICA' },
    absent: { ...basic },
  };
  assert.equal(await h.window.searchActivities(), true);
  assert.deepEqual(ids(await h.api.loadActivityAnalysisData()), ['inside']);
  assert.deepEqual(h.reads.filter(read => typeof read === 'string' && /^gestor_activities\/legacy\/(outside|unknown|absent)\//.test(read)).sort(), [
    'gestor_activities/legacy/absent/plaza', 'gestor_activities/legacy/outside/plaza', 'gestor_activities/legacy/unknown/plaza',
  ]);
  assert.ok(h.reads.every(read => typeof read !== 'string' || !/\/(foto_base64|historial_expediente)$/.test(read)));
  assert.ok(h.maxInFlight() <= 6); assert.deepEqual(h.forbidden, []);
});

for (const [label, container] of [
  ['tercer nivel no soportado', { layer: { record: { tipo: 'GENERAL', gestion_realizada: 'LLAMADA', created_at: BASE } } }],
  ['estructura desconocida', { metadata: { count: 1 } }],
  ['registro incompleto', { tipo: 'GENERAL', created_at: BASE }],
]) test(`histórico ${label}: error explícito, nunca cobertura cero silenciosa`, async () => {
  const h = harness(); fixture(h, 0); h.store.gestor_activities.legacy = container;
  assert.equal(await h.window.searchActivities(), false);
  assert.match(h.node('activitiesTableContainer').innerHTML, /históric|estructura|registro/i);
  await assert.rejects(h.api.loadActivityAnalysisData(), /históric|estructura|registro/i);
  assert.equal(h.renders(), 0);
  assert.ok(!h.reads.some(read => typeof read === 'string' && /^gestor_activities\/legacy\/(layer|metadata)$/.test(read)), 'No descarga contenedor desconocido');
});

test('summary obsoleto: elimina hojas ausentes canónicas antes de filtros y proyección, sin leer hojas borradas', async () => {
  const h = harness(); const [row] = fixture(h, 1);
  const summary = h.store.activity_summaries.plazas[row.plaza][row.id];
  Object.assign(summary, { comentarios: 'Texto borrado', tiene_evidencia: true, seguimiento_de: 'raiz-borrada', motivo: 'Motivo borrado' });
  for (const field of ['tipo', 'gestion_realizada', 'nombre_usuario', 'correo_usuario', 'comentarios']) delete row[field];
  Object.assign(row, { activity_type: 'COBRANZA', gestion: 'VISITA DE CORTESIA' });
  h.node('activityType').value = 'COBRANZA';
  assert.equal(await h.window.searchActivities(), true);
  const [result] = await h.api.loadActivityAnalysisData();
  assert.equal(result.id, row.id); assert.equal(result.activity_type, 'COBRANZA'); assert.equal(result.gestion, 'VISITA DE CORTESIA');
  for (const field of ['tipo', 'gestion_realizada', 'nombre_usuario', 'correo_usuario', 'comentarios', 'seguimiento_de', 'motivo']) assert.equal(result[field], undefined, field);
  assert.equal(result.tiene_evidencia, false); assert.equal(result.has_evidence, false);
  assert.ok(!h.reads.some(read => typeof read === 'string' && /\/(tipo|gestion_realizada|nombre_usuario|correo_usuario|comentarios|tiene_evidencia|seguimiento_de|motivo)$/.test(read)));
  h.node('activityType').value = ''; h.node('activityUser').value = 'José Díaz';
  await h.window.searchActivities(); assert.deepEqual(ids(await h.api.loadActivityAnalysisData()), [], 'Usuario borrado del canónico no coincide por ficha obsoleta');
});

test('shallow: rechaza valores no true y claves inválidas/control sin filtrar y presentar cobertura parcial', async () => {
  const malformed = [false, 'invalid', [], { safe: 1 }, { safe: false }, { safe: null }, { safe: {} },
    { safe: true, '': true }, { safe: true, 'bad.key': true }, { safe: true, 'bad/key': true },
    { safe: true, 'bad#key': true }, { safe: true, 'bad$key': true }, { safe: true, 'bad[key]': true },
    { safe: true, 'bad\u0000key': true }, { safe: true, 'bad\nkey': true }, { safe: true, 'bad\u007fkey': true },
  ];
  for (const value of malformed) {
    const h = harness({ shallowResponse: async () => ({ ok: true, json: async () => value }) });
    await assert.rejects(h.api.activityReadShallowKeys('gestor_activities'), /verificar la cobertura histórica/);
    assert.equal(h.usage.length, 0, 'No registra metadatos inválidos como lectura exitosa');
    assert.equal(await h.window.searchActivities(), false);
    assert.equal(h.renders(), 0); assert.match(h.node('activitiesTableContainer').innerHTML, /no se mostrarán resultados parciales/i);
  }
  for (const value of [null, {}, { safe: true }]) {
    const h = harness({ shallowResponse: async () => ({ ok: true, json: async () => value }) });
    assert.deepEqual(plain(await h.api.activityReadShallowKeys('gestor_activities')), Object.keys(value || {}));
  }
});

test('shallow: rutas arbitrarias, tercer nivel o caracteres control se rechazan antes de red', async () => {
  const h = harness();
  for (const route of ['gestor_activities/a/b/c', 'gestor_activities/a/../b', 'gestor_activities/a\n', 'gestor_activities/a\u007f', 'gestor_photos/a', 'users/account', '']) {
    await assert.rejects(h.api.activityReadShallowKeys(route), /Ruta de metadatos no permitida/);
  }
  assert.equal(h.restReads.length, 0); assert.equal(h.reads.length, 0);
});

for (const stage of ['fetch', 'json', 'token']) test(`shallow error ${stage}: mensaje visible genérico sin URL ni token, reintento manual posible`, async () => {
  const sensitive = 'https://synthetic.example.test/gestor_activities.json?auth=synthetic-token';
  let failing = true;
  const h = harness({ shallowResponse: async () => {
    if (failing && stage === 'fetch') throw new Error(sensitive);
    return { ok: true, json: async () => { if (failing && stage === 'json') throw new Error(sensitive); return null; } };
  } });
  if (stage === 'token') h.auth.currentUser.getIdToken = async () => { if (failing) throw new Error(sensitive); return 'synthetic-token'; };
  assert.equal(await h.window.searchActivities(), false);
  const visible = h.node('activitiesTableContainer').innerHTML;
  assert.match(visible, /verificar la cobertura histórica/);
  assert.doesNotMatch(visible, /synthetic-token|https:|auth=/);
  await assert.rejects(h.api.loadActivityAnalysisData(), error => /verificar la cobertura histórica/.test(error.message) && !/synthetic-token|https:|auth=/.test(error.message));
  failing = false; assert.equal(await h.window.searchActivities(), true);
});

test('fecha fallback nested: JSON shallow inválido también falla sin descargar bitácora ni mostrar cobertura parcial', async () => {
  const store = { gestor_activities: { legacy: { 'payment-1': { tipo: 'COBRANZA', gestion_realizada: 'LLAMADA', historial_expediente: { a: { fecha: BASE } } } } } };
  const h = harness({ store, shallowResponse: async route => {
    if (route.endsWith('/historial_expediente')) return { ok: true, json: async () => ({ a: true, 'bad\nkey': true }) };
    const value = route.split('/').reduce((obj, key) => obj?.[key], store);
    return { ok: true, json: async () => value == null ? null : Object.fromEntries(Object.keys(value).map(key => [key, true])) };
  } });
  assert.equal(await h.window.searchActivities(), false);
  assert.match(h.node('activitiesTableContainer').innerHTML, /verificar la cobertura histórica/);
  assert.ok(!h.reads.some(read => typeof read === 'string' && read.includes('/historial_expediente')));
  assert.equal(h.renders(), 0);
});

test('IDs históricos duplicados en dos rutas: error visible en vez de consolidación o mapa a ruta inventada', async () => {
  const h = harness(); fixture(h, 0);
  const basic = { tipo: 'GENERAL', gestion_realizada: 'LLAMADA', created_at: BASE };
  h.store.gestor_activities = { first: { 'payment-1': { ...basic } }, second: { 'payment-1': { ...basic } } };
  assert.equal(await h.window.searchActivities(), false);
  assert.match(h.node('activitiesTableContainer').innerHTML, /IDs históricos ambiguos/);
  assert.equal(h.renders(), 0);
});
}
