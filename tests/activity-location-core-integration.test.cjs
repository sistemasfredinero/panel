'use strict';
// Integración REAL core + GPS + apertura/agrupación de mapa. Sólo SDK/DOM/renderer
// terminal simulados: sin red, Firebase SDK, escrituras, listeners, tiles ni polling.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const html = readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const DAY = '2026-11-06', BASE = new Date(`${DAY}T10:00:00`).getTime();
function fn(name) {
  const match = html.match(new RegExp(`^  (?:async )?function ${name}\\([^\\n]*\\) \\{(?:[^\\n]*\\}$|\\n[\\s\\S]*?^  \\})`, 'm'));
  assert.ok(match, `Función real ${name}`); return match[0];
}
function action(name) {
  const match = html.match(new RegExp(`^  window\\.${name} = (?:async )?function\\([^\\n]*\\) \\{(?:[^\\n]*\\};$|\\n[\\s\\S]*?^  \\};)`, 'm'));
  assert.ok(match, `Acción real ${name}`); return match[0];
}
function declaration(name) {
  const match = html.match(new RegExp(`^  (?:const|let) ${name} = (?:[^\\n]+;|[\\s\\S]*?^  [^\\n]*;)`, 'm'));
  assert.ok(match, `Estado real ${name}`); return match[0];
}
const NAMES = [
  'normaliseActivityText', 'activityText', 'activityCategory', 'activityCreatedTimestamp',
  'firebasePushIdBoundary', 'firebasePushIdTimestamp', 'isStoredActivityRecord',
  'matchesActivityUser', 'activityMatchesSelectedActions', 'activityFilterRecordAction',
  'currentActivityFilterCriteria', 'activityFilterSignature', 'activityMatchesCriteria',
  'activityPageRecordMatches', 'activityPreview', 'activityAnalysisPreview', 'activityRecordPath',
  'loadActivityTextPage', 'loadActivityUserDirectory', 'resolveActivitySearchSource',
  'activityCanManageAll', 'activityIsManagerScope', 'activityIsAdministrative',
  'isInManagerActivityScope', 'prospectSectionPlazas', 'consolidateProspectFiles',
  'consolidateActivityExportProspects', 'activityQueryContextKey', 'invalidateActivityQueryCache',
  'activityEnsureQueryContext', 'activityBoundedRead', 'activityReadShallowKeys', 'activityCachedKeys',
  'activityReadLightRecord', 'activityInitLightEntry', 'activityScanLightBatch',
  'activityGetLightEntry', 'activityEnsureLightRecords', 'loadActivityAnalysisData',
  'activityLocationContextKey', 'resetActivityLocationCache', 'hasActivityLocationCoordinates',
  'loadActivityLocationRecord', 'loadActivityLocationRecords', 'validCoordinates',
  'activityDateInput', 'activityRouteIdentity', 'activityRouteColor', 'distanceInMeters',
  'calculateActivityRouteMetrics', 'buildActivityRouteGroups', 'renderEmptyActivityRoutesMap',
];
const STATES = [
  'ACTIVITY_RESULTS_PAGE_SIZE', 'FIREBASE_PUSH_ID_CHARS', 'PANEL_PLAZAS', 'TAMPICO_MADERO_MANAGER_EMAIL',
  'ACTIVITY_QUERY_TTL_MS', 'ACTIVITY_LIGHT_FIELDS', '_activityQueryEntries', '_activityMetadataCache',
  '_activityQueryGeneration', '_activityQueryContext', '_activityLightReads', '_activityLightWaiters',
  '_activityUserDirectory', '_activityPageSession', '_activityAnalysisData', '_activityAnalysisSignature',
  '_activityAnalysisLoading', '_activityDetailCache', 'ACTIVITY_LOCATION_CACHE_TTL_MS',
  'ACTIVITY_LOCATION_CACHE_MAX', '_activityLocationCache', '_activityLocationGeneration',
  '_activityRouteLoadRevision', 'ACTIVITY_ROUTE_COLORS',
];
function snapshot(value, key = '') {
  return { key, exists: () => value != null, val: () => value == null ? null : plain(value), forEach(callback) {
    for (const [id, row] of Object.entries(value || {}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) if (callback(snapshot(row, id)) === true) break;
  } };
}
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function harness({ role = 'ADMINISTRATIVO', plaza = 'CHIHUAHUA', beforeRead, denyShallow = false } = {}) {
  const store = {}, reads = [], shallowReads = [], usage = [], forbidden = [], renderCalls = [];
  const nodes = {};
  let context, active = 0, maximum = 0;
  const node = id => nodes[id] ||= {
    value: '', innerHTML: '', style: {}, active: false,
    classList: { add(value) { assert.equal(value, 'active'); node(id).active = true; }, remove(value) { assert.equal(value, 'active'); node(id).active = false; } },
  };
  node('activityStartDate').value = DAY; node('activityEndDate').value = DAY;
  const deny = operation => () => { forbidden.push(operation); throw new Error(`Prohibido ${operation}`); };
  const auth = { currentUser: { uid: 'offline-synthetic', email: role === 'GERENTE' ? 'gerente.chihuahua@example.test' : 'admin@example.test', getIdToken: async () => 'synthetic-token' } };
  const get = async request => {
    const route = typeof request === 'string' ? request : request.route;
    assert.ok(route && route !== '/', 'No se descarga raíz RTDB');
    reads.push(plain(request)); active++; maximum = Math.max(maximum, active);
    try {
      if (beforeRead) await beforeRead(request, { node, auth, store });
      let value = route.split('/').reduce((parent, key) => parent?.[key], store);
      if (request.constraints) {
        assert.match(route, /^activity_summaries\/(plazas|users)\/[^/]+$/);
        assert.deepEqual(request.constraints.map(item => item.type), ['key', 'start', 'end', 'last']);
        assert.equal(request.constraints.at(-1).count, 51, 'Consultas reales 50+1');
        const start = request.constraints[1].value, end = request.constraints[2].value;
        const rows = Object.entries(value || {}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).filter(([id]) => id >= start && id <= end).slice(-51);
        value = rows.length ? Object.fromEntries(rows) : null;
      } else {
        assert.match(route, /^gestor_activities\/[^/]+\/[^/]+$/, 'Sólo hojas escalares, nunca canónico completo/historial/medio');
        const [, id, field] = route.split('/');
        const fields = plain(vm.runInContext('ACTIVITY_LIGHT_FIELDS', context));
        assert.ok(fields.includes(field) || ['latitud', 'longitud'].includes(field), `Hoja no autorizada ${field}`);
        if (role === 'GERENTE' && store.gestor_activities?.[id]?.plaza !== plaza) assert.equal(field, 'plaza', 'Fuera de alcance sólo plaza, ni datos de core ni GPS');
      }
      return snapshot(value);
    } finally { active--; }
  };
  const fetch = async (url, options) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://synthetic.example.test', 'Ninguna petición puede llegar a Firebase real');
    assert.deepEqual([...parsed.searchParams.keys()].sort(), ['auth', 'shallow']);
    assert.equal(parsed.searchParams.get('auth'), 'synthetic-token'); assert.equal(parsed.searchParams.get('shallow'), 'true');
    assert.equal(options.method, 'GET'); assert.equal(options.cache, 'no-store');
    assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error'); assert.equal(options.referrerPolicy, 'no-referrer');
    const route = decodeURIComponent(parsed.pathname.slice(1).replace(/\.json$/, ''));
    assert.match(route, /^(gestor_activities(?:\/[^/]+)?|activity_summaries\/plazas)$/);
    shallowReads.push(route);
    if (beforeRead) await beforeRead({ route, shallow: true }, { node, auth, store });
    if (denyShallow) return { ok: false, json: async () => ({ error: 'offline denied' }) };
    const value = route.split('/').reduce((parent, key) => parent?.[key], store);
    return { ok: true, json: async () => value == null ? null : Object.fromEntries(Object.keys(value).map(key => [key, true])) };
  };
  context = vm.createContext({ window: {}, document: { getElementById: node }, auth, database: {}, get, fetch,
    ref: (_, route) => route === undefined ? { toString: () => 'https://synthetic.example.test/' } : route,
    query: (route, ...constraints) => ({ route, constraints }), orderByKey: () => ({ type: 'key' }),
    startAt: value => ({ type: 'start', value }), endAt: value => ({ type: 'end', value }), limitToLast: count => ({ type: 'last', count }),
    recordPanelDataUsage: (name, value) => usage.push({ name, ...plain(value) }),
    // Sólo se detiene en la frontera visual Leaflet DESPUÉS de agrupación real.
    // Ningún sustituto para loadActivityAnalysisData/core/GPS/cache/route groups.
    createEmptyActivityRoutesMap: element => { renderCalls.push(element); return null; },
    set: deny('set'), update: deny('update'), remove: deny('remove'), push: deny('push'),
    onValue: deny('onValue'), onChildAdded: deny('onChildAdded'), onChildChanged: deny('onChildChanged'),
    onChildRemoved: deny('onChildRemoved'), setInterval: deny('setInterval'), setTimeout: deny('setTimeout'),
    WebSocket: deny('WebSocket'), XMLHttpRequest: deny('XMLHttpRequest'),
    loadFullActivityRecord: deny('loadFullActivityRecord'), loadFullActivityRecords: deny('loadFullActivityRecords'),
  });
  vm.runInContext([...STATES.map(declaration), ...NAMES.map(fn),
    `let _activityProfile = ${JSON.stringify({ rol: role, plaza })}; let _selectedActivityActionFilters = new Set();`,
    action('openActivityRoutesMap'), action('closeActivityRoutesMap'),
    'globalThis.api = { firebasePushIdBoundary, firebasePushIdTimestamp, loadActivityAnalysisData, activityGetLightEntry, activityEnsureLightRecords, currentActivityFilterCriteria, invalidateActivityQueryCache, profile: () => _activityProfile, state: () => ({ query: _activityQueryContext, locationGeneration: _activityLocationGeneration, revision: _activityRouteLoadRevision }) };',
  ].join('\n\n'), context, { filename: 'index.html[actual-core-GPS-map-integration]' });
  return { context, api: context.api, window: context.window, auth, store, node, reads, shallowReads, usage, forbidden, renderCalls, max: () => maximum };
}
function fixture(h, count = 57, { partial = true, foreign = false } = {}) {
  h.store.gestor_activities = {}; h.store.activity_summaries = { plazas: {} };
  const rows = Array.from({ length: count }, (_, index) => ({
    id: index === count - 1 ? 'old-1' : h.api.firebasePushIdBoundary(BASE + index, '-'),
    tipo: 'GENERAL', created_at: BASE + index, plaza: foreign && index % 3 === 0 ? 'TAMPICO' : 'CHIHUAHUA',
    rol: 'GESTOR', user_uid: 'employee-synthetic', nombre_usuario: 'José Díaz', correo_usuario: 'jose@example.test',
    gestion_realizada: 'LLAMADA', comentarios: `Core ligero ${index}`,
    latitud: 28.6 + index / 10000, longitud: -106.08,
    historial_expediente: { noLeer: { comentario: 'PRIVATE_HISTORY' } }, foto_base64: 'PRIVATE_IMAGE', firma_base64: 'PRIVATE_SIGNATURE',
  }));
  for (const [index, row] of rows.entries()) {
    h.store.gestor_activities[row.id] = row;
    if (partial && index % 7 === 0) {
      const summary = Object.fromEntries(Object.entries(row).filter(([field]) => !['latitud', 'longitud', 'historial_expediente', 'foto_base64', 'firma_base64'].includes(field)));
      (h.store.activity_summaries.plazas[row.plaza] ||= {})[row.id] = summary;
    }
  }
  assert.equal(h.api.firebasePushIdTimestamp('old-1'), null);
  return rows;
}
function gpsReads(h) { return h.reads.filter(read => typeof read === 'string' && /\/(latitud|longitud)$/.test(read)); }
function assertSafe(h) {
  assert.deepEqual(h.forbidden, []);
  assert.ok(h.reads.every(read => typeof read !== 'string' || !/historial_expediente|foto_base64|firma_base64|gestor_photos/.test(read)));
  assert.doesNotMatch(JSON.stringify(h.usage), /PRIVATE_HISTORY|PRIVATE_IMAGE|PRIVATE_SIGNATURE/);
}

test('primera apertura sin Buscar previo: core real completa57, índice parcial y no-push; GPS real y grupos completos sin autocancelarse', async () => {
  const h = harness(); const rows = fixture(h);
  assert.equal(h.api.state().query, ''); assert.equal(h.reads.length + h.shallowReads.length, 0);
  await h.window.openActivityRoutesMap();
  assert.equal(h.node('activityRoutesMapModal').active, true);
  const groups = plain(h.window.__activityRouteGroups);
  assert.ok(groups?.length, 'La primera inicialización de contexto no cambia revision y descarta el mapa');
  assert.deepEqual(groups.flatMap(group => group.records.map(row => row.id)).sort(), rows.map(row => row.id).sort());
  assert.equal(h.api.state().locationGeneration, 0, 'Crear contexto inicial no ejecuta reset de GPS real');
  assert.equal(h.api.state().revision, 1);
  assert.equal(gpsReads(h).length, rows.length * 2, 'Sólo coordenadas por actividad; plaza se valida separadamente');
  assert.equal(h.renderCalls.length, 1, 'Llega al renderer después de core/GPS/agrupación real');
  assert.equal(h.shallowReads.filter(route => route === 'gestor_activities').length, 1);
  assert.ok(h.reads.filter(read => read.constraints).length > 1, 'Completitud más allá de50');
  assert.ok(h.max() <= 6, 'Core y GPS comparten activityBoundedRead real: máximo seis lecturas globales');
  assertSafe(h);
  const readCount = h.reads.length + h.shallowReads.length;
  h.window.closeActivityRoutesMap(); await h.window.openActivityRoutesMap();
  assert.equal(h.reads.length + h.shallowReads.length, readCount, 'Reapertura comparte core y GPS reales, no una función análisis stub');
  assert.equal(h.renderCalls.length, 2); assertSafe(h);
});

test('GERENTE, primera apertura con índice ausente: core y GPS reales jamás hidratan ni ubican registros de otra plaza', async () => {
  const h = harness({ role: 'GERENTE' }); const rows = fixture(h, 57, { partial: false, foreign: true });
  await h.window.openActivityRoutesMap();
  const expected = rows.filter(row => row.plaza === 'CHIHUAHUA');
  const groups = plain(h.window.__activityRouteGroups);
  assert.deepEqual(groups.flatMap(group => group.records.map(row => row.id)).sort(), expected.map(row => row.id).sort());
  assert.ok(h.reads.filter(read => read.constraints).every(read => read.route === 'activity_summaries/plazas/CHIHUAHUA'));
  assert.equal(gpsReads(h).length, expected.length * 2); assertSafe(h);
});

test('primera apertura: permisos de cobertura denegados muestran error real y no producen mapa vacío como éxito', async () => {
  const h = harness({ denyShallow: true }); fixture(h);
  await h.window.openActivityRoutesMap();
  assert.match(h.node('activityRoutesMap').innerHTML, /No se pudieron cargar las ubicaciones:.*verificar la cobertura histórica/);
  assert.equal(h.window.__activityRouteGroups, undefined); assert.equal(gpsReads(h).length, 0);
  assert.equal(h.renderCalls.length, 0); assertSafe(h);
});

test('fallo GPS después de cargar core real: error visible, no publica grupos parciales', async () => {
  const h = harness({ beforeRead: request => { if (typeof request === 'string' && request.endsWith('/longitud')) throw new Error('GPS sintético denegado'); } });
  fixture(h, 9); await h.window.openActivityRoutesMap();
  assert.ok(h.usage.some(item => item.name === 'PANEL_ACTIVITY_GRAPHICS_RANGE'), 'Core real terminó antes del fallo GPS');
  assert.match(h.node('activityRoutesMap').innerHTML, /No se pudieron cargar las ubicaciones:.*GPS sintético denegado/);
  assert.equal(h.window.__activityRouteGroups, undefined); assert.equal(h.renderCalls.length, 0); assertSafe(h);
});

for (const changed of ['cerrar', 'filtros', 'sesión']) test(`primera apertura: ${changed} durante cobertura core real impide GPS y publicación tardía`, async () => {
  const entered = deferred(), release = deferred();
  const h = harness({ beforeRead: request => { if (request?.shallow && request.route === 'gestor_activities') { entered.resolve(); return release.promise; } } });
  fixture(h, 9); const opening = h.window.openActivityRoutesMap(); await entered.promise;
  if (changed === 'cerrar') h.window.closeActivityRoutesMap();
  if (changed === 'filtros') h.node('activityType').value = 'COBRANZA';
  if (changed === 'sesión') h.auth.currentUser = null;
  release.resolve(); await opening;
  assert.equal(h.window.__activityRouteGroups, undefined); assert.equal(gpsReads(h).length, 0);
  assert.equal(h.renderCalls.length, 0); assertSafe(h);
  if (changed === 'cerrar') assert.equal(h.node('activityRoutesMapModal').active, false);
  else assert.match(h.node('activityRoutesMap').innerHTML, /No se pudieron cargar las ubicaciones/);
});

test('búsqueda parcial102 de1207 sin índice: cero provisional sin GPS; mapa explícito continúa y publica sólo rango completo', async () => {
  const h = harness(); const rows = fixture(h, 1207, { partial: false });
  rows[0].rol = 'OBJETIVO'; h.node('activityRole').value = 'OBJETIVO';
  const entry = await h.api.activityGetLightEntry(h.api.currentActivityFilterCriteria());
  const first = await h.api.activityEnsureLightRecords(entry, 50);
  assert.equal(first.scannedBatches, 2); assert.equal(entry.offset, 102);
  assert.equal(entry.records.length, 0); assert.equal(entry.complete, false); assert.equal(entry.partial, true);
  assert.match(entry.statusText, /Verificación pendiente.*sin coincidencias en la parte revisada/);
  assert.equal(gpsReads(h).length, 0); assert.equal(h.renderCalls.length, 0);
  await h.window.openActivityRoutesMap();
  assert.equal(entry.complete, true); assert.equal(entry.partial, false); assert.equal(entry.offset, rows.length);
  const groups = plain(h.window.__activityRouteGroups);
  assert.deepEqual(groups.flatMap(group => group.records.map(row => row.id)), [rows[0].id]);
  assert.equal(gpsReads(h).length, 2, 'Sólo se ubica coincidencia verificada después de cobertura completa');
  assert.equal(h.renderCalls.length, 1);
  assert.equal(h.shallowReads.filter(route => route === 'gestor_activities').length, 1, 'No reinicia cobertura');
  assert.equal(new Set(h.shallowReads.filter(route => /^gestor_activities\/[^/]+$/.test(route))).size, rows.length);
  assert.ok(h.max() <= 6); assertSafe(h);
  const count = h.reads.length + h.shallowReads.length;
  h.window.closeActivityRoutesMap(); await h.window.openActivityRoutesMap();
  assert.equal(h.reads.length + h.shallowReads.length, count, 'Reapertura completa utiliza caché real');
});
