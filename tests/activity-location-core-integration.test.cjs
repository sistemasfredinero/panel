'use strict';
// Funciones REALES extraídas de index.html. SDK, DOM y frontera Leaflet simulados.
// Sin red, cuentas reales, escrituras, tiles, polling, análisis ni canónico completo.
const assert = require('node:assert/strict');
const { readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const html = readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const DAY = '2026-11-15', END = '2026-11-17', BASE = new Date(`${DAY}T10:00:00`).getTime();
function fn(name) { const match = html.match(new RegExp(`^  (?:async )?function ${name}\\([^\\n]*\\) \\{(?:[^\\n]*\\}$|\\n[\\s\\S]*?^  \\})`, 'm')); assert.ok(match, name); return match[0]; }
function action(name) { const match = html.match(new RegExp(`^  window\\.${name} = (?:async )?function\\([^\\n]*\\) \\{(?:[^\\n]*\\};$|\\n[\\s\\S]*?^  \\};)`, 'm')); assert.ok(match, name); return match[0]; }
function declaration(name) { const match = html.match(new RegExp(`^  (?:const|let) ${name} = (?:[^\\n]+;|[\\s\\S]*?^  [^\\n]*;)`, 'm')); assert.ok(match, name); return match[0]; }
const NAMES = ['estimateDataUsageBytes', 'normaliseActivityText', 'activityText', 'activityCategory', 'activityCreatedTimestamp', 'firebasePushIdBoundary', 'firebasePushIdTimestamp', 'matchesActivityUser', 'activityMatchesSelectedActions', 'activityFilterRecordAction', 'currentActivityFilterCriteria', 'activityFilterSignature', 'activityRecordPath', 'activityCanManageAll', 'activityIsManagerScope', 'activityIsAdministrative', 'isInManagerActivityScope', 'prospectSectionPlazas', 'activityQueryContextKey', 'invalidateActivityQueryCache', 'activityEnsureQueryContext', 'activityBoundedRead', 'cancelActivityRoutesLoad', 'resetActivityRoutesCache', 'activityRoutesCapturedTimestamp', 'activityRoutesMatchesUser', 'activityRoutesMatchesCriteria', 'activityRoutesSdkRead', 'activityRoutesReadPlazas', 'loadActivityRoutesData', 'activityLocationContextKey', 'resetActivityLocationCache', 'hasActivityLocationCoordinates', 'loadActivityLocationRecord', 'loadActivityLocationRecords', 'validCoordinates', 'activityDateInput', 'activityRouteIdentity', 'activityRouteManagement', 'activityRoutesVisibility', 'activityRouteColor', 'distanceInMeters', 'calculateActivityRouteMetrics', 'buildActivityRouteGroups', 'renderEmptyActivityRoutesMap'];
const STATES = ['ACTIVITY_RESULTS_PAGE_SIZE', 'FIREBASE_PUSH_ID_CHARS', 'PANEL_PLAZAS', 'TAMPICO_MADERO_MANAGER_EMAIL', 'ACTIVITY_QUERY_TTL_MS', '_activityQueryEntries', '_activityMetadataCache', '_activityQueryGeneration', '_activityQueryContext', '_activityLightReads', '_activityLightWaiters', '_activityUserDirectory', '_activityPageSession', '_activityAnalysisData', '_activityAnalysisSignature', '_activityDetailCache', 'ACTIVITY_LOCATION_CACHE_TTL_MS', 'ACTIVITY_LOCATION_CACHE_MAX', '_activityLocationCache', '_activityLocationGeneration', '_activityRouteLoadRevision', 'ACTIVITY_ROUTE_COLORS', 'ACTIVITY_ROUTES_COVERAGE_MESSAGE', 'ACTIVITY_ROUTES_FIELDS', '_activityRoutesCache', '_activityRoutesPending', '_activityRoutesGeneration', '_activityRouteController'];
function snapshot(value, key = '') { return { key, exists: () => value != null, val: () => value == null ? null : plain(value), forEach(callback) { for (const [id, row] of Object.entries(value || {}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) if (callback(snapshot(row, id)) === true) break; } }; }
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function harness({ role = 'ADMINISTRATIVO', plaza = 'CHIHUAHUA', email, beforeRead, denyShallow = false, denyIndex = false } = {}) {
  const store = {}, reads = [], shallowReads = [], usage = [], forbidden = [], renderCalls = [], events = {};
  let context, active = 0, maximum = 0, now = 100_000, stopped = 0;
  const nodes = {};
  const node = id => nodes[id] ||= { id, value: '', innerHTML: '', textContent: '', style: {}, dataset: {}, active: false, classList: { add() { node(id).active = true; }, remove() { node(id).active = false; } } };
  node('activityStartDate').value = DAY; node('activityEndDate').value = END;
  node('activityPlaza').value = plaza;
  const deny = operation => () => { forbidden.push(operation); throw new Error(`Prohibido ${operation}`); };
  const auth = { currentUser: { uid: 'offline-synthetic', email: email || (role === 'GERENTE' ? 'gerente.chihuahua@example.test' : 'admin@example.test'), getIdToken: async () => 'synthetic-token' } };
  const readValue = request => {
    const route = typeof request === 'string' ? request : request.route;
    let value = route.split('/').reduce((parent, key) => parent?.[key], store);
    if (request.constraints) {
      assert.match(route, /^activity_summaries\/plazas\/[^/]+$/);
      assert.deepEqual(request.constraints.map(item => item.type), ['key', 'start', 'end', 'last']);
      assert.equal(request.constraints.at(-1).count, 51);
      const start = request.constraints[1].value, end = request.constraints[2].value;
      assert.equal(start, context.api.firebasePushIdBoundary(new Date(`${DAY}T00:00:00`).getTime(), '-'));
      assert.ok(end <= context.api.firebasePushIdBoundary(new Date(`${END}T23:59:59.999`).getTime(), 'z'));
      const rows = Object.entries(value || {}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).filter(([id]) => id >= start && id <= end).slice(-51);
      value = rows.length ? Object.fromEntries(rows) : null;
    } else assert.match(route, /^gestor_activities\/[^/]+\/(latitud|longitud|plaza)$/, 'Sólo GPS mínimo y plaza vigente');
    return snapshot(value);
  };
  const onValue = (request, success, failure, options) => {
    assert.deepEqual(plain(options), { onlyOnce: true }, 'Nunca listener persistente');
    reads.push(plain(request)); active++; maximum = Math.max(maximum, active);
    let canceled = false, finished = false;
    const finish = () => { if (!finished) { finished = true; active--; } };
    Promise.resolve().then(async () => {
      try {
        if (beforeRead) await beforeRead(request, { node, auth, store });
        if (canceled) return;
        if (denyIndex && request.constraints) throw new Error('synthetic-denied');
        success(readValue(request));
      } catch (error) { if (!canceled) failure(error); }
      finally { finish(); }
    });
    return () => { if (!canceled) { canceled = true; stopped++; finish(); } };
  };
  const fetch = async (url, options) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://synthetic.example.test');
    assert.deepEqual([...parsed.searchParams.keys()].sort(), ['auth', 'shallow']);
    assert.equal(parsed.searchParams.get('auth'), 'synthetic-token'); assert.equal(parsed.searchParams.get('shallow'), 'true');
    assert.equal(options.method, 'GET'); assert.equal(options.cache, 'no-store'); assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error'); assert.equal(options.referrerPolicy, 'no-referrer');
    assert.ok(options.signal, 'Shallow cancelable con AbortSignal');
    const route = decodeURIComponent(parsed.pathname.slice(1).replace(/\.json$/, ''));
    assert.equal(route, 'activity_summaries/plazas', 'Sólo nombres de plazas, jamás claves gestor_activities/users');
    shallowReads.push(route); active++; maximum = Math.max(maximum, active);
    try {
      if (beforeRead) await Promise.race([beforeRead({ route, shallow: true }, { node, auth, store }), new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true }))]);
      if (options.signal.aborted) throw new Error('Aborted');
      if (denyShallow) return { ok: false };
      const value = store.activity_summaries?.plazas;
      return { ok: true, json: async () => value == null ? null : Object.fromEntries(Object.keys(value).map(key => [key, true])) };
    } finally { active--; }
  };
  context = vm.createContext({ window: {}, document: { getElementById: node, addEventListener: (type, fn) => events[type] = fn }, auth, database: {}, onValue, fetch, AbortController, TextEncoder,
    Date: class extends Date { static now() { return now; } },
    ref: (_, route) => route === undefined ? { toString: () => 'https://synthetic.example.test/' } : route,
    query: (route, ...constraints) => ({ route, constraints }), orderByKey: () => ({ type: 'key' }), startAt: value => ({ type: 'start', value }), endAt: value => ({ type: 'end', value }), limitToLast: count => ({ type: 'last', count }),
    recordPanelDataUsage: (name, value) => usage.push({ name, ...plain(value) }), createEmptyActivityRoutesMap: element => { renderCalls.push(element); return null; },
    get: deny('get'), set: deny('set'), update: deny('update'), remove: deny('remove'), push: deny('push'),
    setInterval: deny('setInterval'), setTimeout, clearTimeout, WebSocket: deny('WebSocket'), XMLHttpRequest: deny('XMLHttpRequest'),
    loadActivityAnalysisData: deny('loadActivityAnalysisData'), activityEnsureLightRecords: deny('activityEnsureLightRecords'), loadFullActivityRecord: deny('loadFullActivityRecord'), loadFullActivityRecords: deny('loadFullActivityRecords'),
  });
  const domEvents = [...html.matchAll(/^  document\.addEventListener\?\.\('input',[\s\S]*?^  \}\);\n  document\.addEventListener\?\.\('change',[\s\S]*?^  \}\);/gm)].find(match => match[0].includes('cancelActivityRoutesLoad'));
  assert.ok(domEvents);
  vm.runInContext([...STATES.map(declaration), ...NAMES.map(fn), domEvents[0],
    `let _activityProfile = ${JSON.stringify({ rol: role, plaza })}; let _selectedActivityActionFilters = new Set();`,
    action('openActivityRoutesMap'), action('closeActivityRoutesMap'), action('refreshActivityRoutesMap'),
    'globalThis.api = { firebasePushIdBoundary, loadActivityRoutesData, currentActivityFilterCriteria, invalidateActivityQueryCache, cancelActivityRoutesLoad, profile: () => _activityProfile, setActions: keys => _selectedActivityActionFilters = new Set(keys), state: () => ({ query: _activityQueryContext, locationGeneration: _activityLocationGeneration, revision: _activityRouteLoadRevision, cacheSize: _activityRoutesCache.size, pending: _activityRoutesPending.size }) };',
  ].join('\n\n'), context, { filename: 'index.html[actual-ranged-map-GPS-integration]' });
  context.window.searchActivities = deny('searchActivities');
  return { context, api: context.api, window: context.window, auth, store, node, reads, shallowReads, usage, forbidden, renderCalls, advance: ms => now += ms, max: () => maximum, stopped: () => stopped, active: () => active, change: (id, value) => { node(id).value = value; events.input({ target: node(id) }); } };
}
function id(h, timestamp, index = 0) { return h.api.firebasePushIdBoundary(timestamp, '-').slice(0, 8) + String(index).padStart(12, '0'); }
function fixture(h, count = 4, exterior = 0, { plaza = 'CHIHUAHUA', sameTimestamp = false, partial = false, timestampOffset = 0 } = {}) {
  h.store.gestor_activities ||= {}; h.store.activity_summaries ||= { plazas: {} };
  const summaries = h.store.activity_summaries.plazas[plaza] ||= {};
  const rows = Array.from({ length: count }, (_, index) => ({ id: id(h, BASE + timestampOffset + (sameTimestamp ? 0 : index), index), tipo: 'GENERAL', created_at: BASE + index, plaza, rol: 'GESTOR', user_uid: `employee-${index % 2}`, nombre_usuario: index % 2 ? 'RODRIGO RODRIGUEZ' : 'IRMA BERENICE', correo_usuario: 'synthetic@example.test', gestion_realizada: 'LLAMADA', latitud: 28.6 + index / 10000, longitud: -106.08, historial_expediente: { noLeer: { comentario: 'PRIVATE_HISTORY' } }, foto_base64: 'PRIVATE_IMAGE', firma_base64: 'PRIVATE_SIGNATURE' }));
  rows.forEach((row, index) => {
    h.store.gestor_activities[row.id] = row;
    if (!partial || index % 7 === 0) summaries[row.id] = Object.fromEntries(Object.entries(row).filter(([field]) => !['id', 'latitud', 'longitud', 'historial_expediente', 'foto_base64', 'firma_base64'].includes(field)));
  });
  for (let index = 0; index < exterior; index++) { const key = id(h, BASE + (index % 2 ? -10 : 10) * 86400000, index); summaries[key] = { created_at: BASE - 86400000 * 10, plaza, tipo: 'PROSPECCION', nombre_usuario: 'NO LEER', actualizado_en: BASE }; h.store.gestor_activities[key] = { ...summaries[key], latitud: 0, longitud: 0 }; }
  return rows;
}
function queryReads(h) { return h.reads.filter(read => read.constraints); }
function gpsReads(h) { return h.reads.filter(read => typeof read === 'string' && /\/(latitud|longitud)$/.test(read)); }
function groupIds(h) { return plain((h.window.__activityRouteGroups || []).flatMap(group => group.records.map(row => row.id)).sort()); }
function assertSafe(h) { assert.deepEqual(h.forbidden, []); assert.ok(h.max() <= 6); assert.equal(h.active(), 0); assert.doesNotMatch(JSON.stringify(h.usage), /PRIVATE_HISTORY|PRIVATE_IMAGE|PRIVATE_SIGNATURE/); assert.ok(h.shallowReads.every(route => route === 'activity_summaries/plazas')); }
const budgets = [];
for (const count of [0, 4, 120]) test(`fixture20000 exterior/${count} dentro: presupuesto sólo rango y GPS coincidente`, async () => {
  for (const exterior of [0, 20000]) {
    const h = harness(); const rows = fixture(h, count, exterior, { sameTimestamp: true });
    assert.equal(h.api.state().query, '');
    await h.window.openActivityRoutesMap();
    assert.deepEqual(groupIds(h), rows.map(row => row.id).sort());
    assert.equal(queryReads(h).length, count > 50 ? 3 : 1);
    assert.equal(h.shallowReads.length, 0);
    assert.equal(gpsReads(h).length, count * 2); assert.equal(h.reads.filter(read => typeof read === 'string').length, count * 3);
    assert.match(h.node('activityRoutesCoverage').textContent, /Mapa de fichas disponibles del rango; históricos sin ficha o sin clave cronológica requieren índice diario/);
    assert.match(h.node('activityRoutesCoverage').textContent, /No certifica completitud histórica/);
    assertSafe(h);
    budgets.push({ exterior, within: count, indexQueries: queryReads(h).length, shallowPlazaNames: h.shallowReads.length, gpsScalars: gpsReads(h).length, canonicalPlazaScalars: count, totalReads: h.reads.length + h.shallowReads.length, maxConcurrency: h.max(), forbiddenOperations: h.forbidden.length });
    const readCount = h.reads.length;
    h.window.closeActivityRoutesMap(); await h.window.openActivityRoutesMap(); assert.equal(h.reads.length, readCount, 'Cerrar conserva caché completada');
    await h.window.refreshActivityRoutesMap(); assert.equal(h.reads.length, readCount * 2, 'Force mapa y GPS, sin Buscar general'); assertSafe(h);
  }
});
test('admin Todas enumera únicamente nombres plazas existentes, incluso fuera catálogo', async () => {
  const h = harness(); h.node('activityPlaza').value = '';
  const a = fixture(h, 4, 20000), b = fixture(h, 3, 0, { plaza: 'PLAZA HISTORICA' });
  // IDs duplicados entre índices se deduplican; sólo los registros que realmente corresponden a la plaza.
  await h.window.openActivityRoutesMap();
  assert.equal(h.shallowReads.length, 1); assert.equal(queryReads(h).length, 2); assert.equal(new Set(groupIds(h)).size, 4);
  assert.ok(queryReads(h).some(read => read.route.endsWith('/PLAZA HISTORICA'))); assertSafe(h);
});
test('índice parcial y IDs sin ficha/no cronológicos son cobertura limitada, nunca fallback masivo', async () => {
  const h = harness(); const rows = fixture(h, 120, 20000, { partial: true });
  h.store.gestor_activities['legacy-id'] = { ...rows[0], created_at: BASE };
  h.store.activity_summaries.plazas.CHIHUAHUA['legacy-id'] = { ...rows[0], created_at: BASE };
  await h.window.openActivityRoutesMap();
  assert.equal(groupIds(h).length, 18); assert.equal(queryReads(h).length, 1); assert.equal(gpsReads(h).length, 36);
  assert.match(h.node('activityRoutesCoverage').textContent, /históricos sin ficha o sin clave cronológica requieren índice diario/); assertSafe(h);
});
test('índice ausente muestra no hay ubicaciones en fichas disponibles, no cero histórico ni fallback', async () => {
  const h = harness(); fixture(h, 4); h.store.activity_summaries.plazas.CHIHUAHUA = null;
  await h.window.openActivityRoutesMap(); assert.deepEqual(groupIds(h), []); assert.equal(gpsReads(h).length, 0); assert.equal(queryReads(h).length, 1); assertSafe(h);
  assert.match(fn('renderEmptyActivityRoutesMap'), /No hay ubicaciones en las fichas disponibles del rango/);
});
test('captura real de fichas, no actualizado_en, raíz ni push ID con fecha inventada; filtros substring/tipo/rol/plaza/acciones', async () => {
  const h = harness(); const rows = fixture(h, 4, 20000);
  const summaries = h.store.activity_summaries.plazas.CHIHUAHUA;
  summaries[rows[0].id].tipo = 'PROSPECCION'; summaries[rows[0].id].created_at = BASE - 10 * 86400000; summaries[rows[0].id].actualizado_en = BASE;
  delete summaries[rows[1].id].created_at; summaries[rows[1].id].actualizado_en = BASE;
  summaries[rows[2].id].created_at = null; summaries[rows[2].id].timestamp = BASE; summaries[rows[2].id].tipo_accion = 'VISITA EN DOMICILIO';
  h.node('activityUser').value = 'bere'; h.node('activityRole').value = 'GESTOR'; h.node('activityType').value = 'GENERAL'; h.api.setActions(['GENERAL|LLAMADA', 'PROSPECCION|VISITA EN DOMICILIO']);
  await h.window.openActivityRoutesMap(); assert.deepEqual(groupIds(h), [rows[2].id]); assert.equal(gpsReads(h).length, 2);
  h.change('activityUser', 'rd'); await h.window.openActivityRoutesMap(); assert.deepEqual(groupIds(h), [rows[3].id]);
  assertSafe(h);
});
test('gerente Tampico–Madero, Todas y seleccionado: nunca índice UID propio ni plazas ajenas', async () => {
  const h = harness({ role: 'GERENTE', plaza: 'TAMPICO', email: 'gerente.tampico@fredinero.com' });
  const a = fixture(h, 4, 20000, { plaza: 'TAMPICO' }); const b = fixture(h, 3, 0, { plaza: 'MADERO', timestampOffset: 1000 }); fixture(h, 2, 0, { plaza: 'CHIHUAHUA', timestampOffset: 2000 });
  h.node('activityPlaza').value = ''; await h.window.openActivityRoutesMap();
  assert.deepEqual(queryReads(h).map(read => read.route).sort(), ['activity_summaries/plazas/MADERO', 'activity_summaries/plazas/TAMPICO']);
  assert.equal(h.shallowReads.length, 0); assert.equal(groupIds(h).length, 7); assertSafe(h);
  h.change('activityPlaza', 'MADERO'); await h.window.openActivityRoutesMap(); assert.equal(groupIds(h).length, 3);
  h.change('activityPlaza', 'CHIHUAHUA'); const before = h.reads.length; await h.window.openActivityRoutesMap(); assert.equal(h.reads.length, before); assert.match(h.node('activityRoutesMap').innerHTML, /alcance del gerente/);
});
test('plaza canónica fuera alcance detiene GPS antes de latitud/longitud', async () => {
  const h = harness({ role: 'GERENTE' }); const rows = fixture(h, 1); h.store.gestor_activities[rows[0].id].plaza = 'TAMPICO';
  await h.window.openActivityRoutesMap(); assert.equal(gpsReads(h).length, 0); assert.match(h.node('activityRoutesMap').innerHTML, /plaza.*cambió/); assertSafe(h);
});
for (const changed of ['cerrar', 'filtros', 'logout', 'force']) for (const phase of ['índice', 'GPS', 'coordenadas']) test(`${changed} durante ${phase}: desuscribe pendientes, no siguientes páginas/GPS/publicación tardía`, async () => {
  const entered = deferred(), release = deferred(); let block = true;
  const h = harness({ beforeRead: request => { if (block && (phase === 'índice' ? request.constraints : typeof request === 'string' && (phase === 'GPS' || /\/(latitud|longitud)$/.test(request)))) { entered.resolve(); return release.promise; } } });
  fixture(h, 120, 20000); const opening = h.window.openActivityRoutesMap(); await entered.promise;
  const count = h.reads.length;
  if (changed === 'cerrar') h.window.closeActivityRoutesMap();
  if (changed === 'filtros') h.change('activityType', 'COBRANZA');
  if (changed === 'logout') { h.auth.currentUser = null; h.api.invalidateActivityQueryCache(); }
  let forced;
  if (changed === 'force') { block = false; forced = h.window.openActivityRoutesMap({ force: true }); }
  else { assert.equal(h.active(), 0, 'Lecturas activas se retiran ANTES de resolver respuesta tardía'); }
  release.resolve(); await opening; if (forced) await forced;
  if (changed !== 'force') { assert.equal(h.reads.length, count, 'Sin nuevas lecturas al liberar callbacks tardíos'); assert.equal(groupIds(h).length, 0); }
  else assert.equal(groupIds(h).length, 120);
  assert.ok(h.stopped() > 0); assertSafe(h);
});
test('cancelación shallow admin Todas retira fetch sin comenzar índices', async () => {
  const entered = deferred(), release = deferred();
  const h = harness({ beforeRead: request => { if (request.shallow) { entered.resolve(); return release.promise; } } }); fixture(h); h.node('activityPlaza').value = '';
  const opening = h.window.openActivityRoutesMap(); await entered.promise; h.window.closeActivityRoutesMap(); await opening; release.resolve();
  assert.equal(h.reads.length, 0); assert.equal(h.active(), 0); assertSafe(h);
});
for (const target of ['shallow', 'índice', 'GPS']) test(`error ${target} no certifica vacío ni publica mapa parcial`, async () => {
  const h = harness({ denyShallow: target === 'shallow', denyIndex: target === 'índice', beforeRead: request => { if (target === 'GPS' && typeof request === 'string' && request.endsWith('/longitud')) throw new Error('GPS sintético denegado'); } }); fixture(h); if (target === 'shallow') h.node('activityPlaza').value = '';
  await h.window.openActivityRoutesMap(); assert.equal(groupIds(h).length, 0); assert.equal(h.renderCalls.length, 0); assert.match(h.node('activityRoutesMap').innerHTML, /No se pudieron cargar las ubicaciones/); assertSafe(h);
});
test('caché de mapa máximo3 TTL5min separado por identidad/rol/plaza/criterios; logout invalida', async () => {
  const h = harness(); fixture(h); await h.api.loadActivityRoutesData(); const count = h.reads.length;
  await h.api.loadActivityRoutesData(); assert.equal(h.reads.length, count);
  for (const text of ['bere', 'rd', 'nadie']) { h.node('activityUser').value = text; await h.api.loadActivityRoutesData(); }
  assert.equal(h.api.state().cacheSize, 3); h.advance(300001); await h.api.loadActivityRoutesData(); assert.equal(h.api.state().cacheSize, 1);
  h.auth.currentUser.uid = 'other-synthetic'; await h.api.loadActivityRoutesData(); assert.equal(h.api.state().cacheSize, 1);
  h.api.profile().rol = 'GERENTE'; await h.api.loadActivityRoutesData(); assert.equal(h.api.state().cacheSize, 1);
  h.auth.currentUser = null; h.api.invalidateActivityQueryCache(); assert.equal(h.api.state().cacheSize, 0); assert.equal(h.api.state().pending, 0); assertSafe(h);
});
test('proyección de fichas descarta nested/historia/medios/contacto y force directo recarga índice', async () => {
  const h = harness(); const rows = fixture(h, 4);
  h.store.activity_summaries.plazas.CHIHUAHUA[rows[0].id].historial_expediente = { secret: 'PRIVATE_HISTORY' };
  h.store.activity_summaries.plazas.CHIHUAHUA[rows[0].id].verificacion_domiciliaria = { direccion: 'PRIVATE_ADDRESS', telefono: 'PRIVATE_PHONE' };
  h.store.activity_summaries.plazas.CHIHUAHUA[rows[0].id].firma_base64 = 'PRIVATE_SIGNATURE';
  const records = await h.api.loadActivityRoutesData();
  assert.doesNotMatch(JSON.stringify(records), /PRIVATE_HISTORY|PRIVATE_ADDRESS|PRIVATE_PHONE|PRIVATE_SIGNATURE/);
  assert.doesNotMatch(JSON.stringify(h.usage), /PRIVATE_HISTORY|PRIVATE_ADDRESS|PRIVATE_PHONE|PRIVATE_SIGNATURE/);
  assert.equal(gpsReads(h).length, 0);
  await h.api.loadActivityRoutesData({ force: true }); assert.equal(queryReads(h).length, 2); assertSafe(h);
});
test('cancelar lectura de índice en cola no espera otra operación ajena y nunca inicia SDK', async () => {
  const h = harness(); fixture(h);
  vm.runInContext('_activityLightReads = 6;', h.context);
  const controller = new AbortController();
  const pending = h.api.loadActivityRoutesData({ signal: controller.signal });
  await Promise.resolve(); await Promise.resolve(); controller.abort();
  await assert.rejects(pending, /cancelada/);
  assert.equal(h.reads.length, 0);
  assert.equal(vm.runInContext('_activityLightWaiters.length', h.context), 0);
});
test('fronteras inclusive15–17 y 50+1 exacto con IDs simultáneos; excluye14/18', async () => {
  for (const count of [50, 51, 100, 101]) {
    const h = harness(); const rows = fixture(h, count, 20000, { sameTimestamp: true });
    const start = new Date(`${DAY}T00:00:00`).getTime(), end = new Date(`${END}T23:59:59.999`).getTime();
    const summaries = h.store.activity_summaries.plazas.CHIHUAHUA;
    const edgeRows = [start - 1, start, end, end + 1].map((timestamp, index) => ({ ...rows[0], id: h.api.firebasePushIdBoundary(timestamp, index === 2 ? 'z' : '-'), created_at: timestamp }));
    for (const row of edgeRows) { summaries[row.id] = row; h.store.gestor_activities[row.id] = row; }
    const result = plain(await h.api.loadActivityRoutesData());
    assert.equal(result.length, count + 2); assert.equal(new Set(result.map(row => row.id)).size, count + 2);
    assert.ok(result.some(row => row.id === edgeRows[1].id)); assert.ok(result.some(row => row.id === edgeRows[2].id));
    assert.ok(!result.some(row => row.id === edgeRows[0].id || row.id === edgeRows[3].id)); assertSafe(h);
  }
});
test('gerente Tampico–Madero: cambio canónico a otra plaza permitida no rebasa filtro y evita GPS', async () => {
  const h = harness({ role: 'GERENTE', plaza: 'TAMPICO', email: 'gerente.tampico@fredinero.com' });
  const rows = fixture(h, 1, 0, { plaza: 'TAMPICO' }); h.store.gestor_activities[rows[0].id].plaza = 'MADERO';
  await h.window.openActivityRoutesMap(); assert.equal(gpsReads(h).length, 0); assert.equal(groupIds(h).length, 0); assert.match(h.node('activityRoutesMap').innerHTML, /plaza.*cambió/); assertSafe(h);
});
test('cerrar/reabrir inmediato durante GPS no reutiliza promesa abortada ni autocancela la nueva apertura', async () => {
  const entered = deferred(), release = deferred(); let block = true;
  const h = harness({ beforeRead: request => { if (block && typeof request === 'string') { entered.resolve(); return release.promise; } } }); fixture(h, 4);
  const old = h.window.openActivityRoutesMap(); await entered.promise; h.window.closeActivityRoutesMap(); block = false;
  const fresh = h.window.openActivityRoutesMap(); release.resolve(); await Promise.all([old, fresh]);
  assert.equal(groupIds(h).length, 4); assert.equal(h.node('activityRoutesMapModal').active, true); assertSafe(h);
});
test('contratos estáticos: mapa y refresco no llaman análisis/Buscar/Infinity; filtros/sesión invalidan y UI explica cobertura', () => {
  assert.doesNotMatch(action('openActivityRoutesMap') + action('refreshActivityRoutesMap') + fn('loadActivityRoutesData'), /loadActivityAnalysisData|activityEnsureLightRecords|loadFullActivity|searchActivities|Infinity/);
  assert.match(action('refreshActivityRoutesMap'), /openActivityRoutesMap\(\{ force: true \}\)/);
  assert.match(fn('resetActivityLocationCache'), /resetActivityRoutesCache/);
  assert.match(fn('invalidateActivityQueryCache'), /resetActivityLocationCache/);
  assert.match(html, /id="activityRoutesCoverage" role="status"/);
  assert.match(fn('renderActivityRoutesReport'), /fichas disponibles de los días seleccionados/);
  assert.doesNotMatch(fn('renderActivityRoutesReport'), /todas las actividades que cumplen/);
});
test.after(() => { if (process.env.MAP_BUDGET_OUTPUT) writeFileSync(process.env.MAP_BUDGET_OUTPUT, JSON.stringify({ authorization: 'PREPARAR Y PROBAR OFFLINE; NO PUBLICAR', range: { start: DAY, end: END }, fixtureBudgets: budgets, interpretation: 'Lecturas no dependen de historial exterior; rango de fichas disponibles, no completitud histórica', queryPageLimit: 51, mapCache: { maxEntries: 3, ttlMs: 300000 }, maxConcurrency: 6 }, null, 2) + '\n'); });
