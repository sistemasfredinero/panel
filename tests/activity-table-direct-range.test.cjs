'use strict';
// Código REAL del panel en VM. Firebase/DOM sintéticos; ningún dato ni write real.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
function fn(name) {
  const match = html.match(new RegExp(`^  (?:async )?function ${name}\\([^\\n]*\\) \\{(?:[^\\n]*\\}$|\\n[\\s\\S]*?^  \\})`, 'm'));
  assert.ok(match, `Falta función REAL ${name}`); return match[0];
}
function action(name) {
  const match = html.match(new RegExp(`^  window\\.${name} = (?:async )?function\\([^\\n]*\\) \\{(?:[^\\n]*\\};$|\\n[\\s\\S]*?^  \\};)`, 'm'));
  assert.ok(match, `Falta acción REAL ${name}`); return match[0];
}
function decl(name) {
  const match = html.match(new RegExp(`^  (?:const|let) ${name} = (?:[^\\n]+;|[\\s\\S]*?^  [^\\n]*;)`, 'm'));
  assert.ok(match, name); return match[0];
}
const NAMES = ['normaliseActivityText', 'activityText', 'activityCategory', 'activityCreatedTimestamp', 'firebasePushIdBoundary', 'firebasePushIdTimestamp', 'isStoredActivityRecord', 'matchesActivityUser', 'activityMatchesSelectedActions', 'activityFilterRecordAction', 'currentActivityFilterCriteria', 'activityFilterSignature', 'activityMatchesCriteria', 'activityPageRecordMatches', 'activityPreview', 'activityAnalysisPreview', 'activityRecordPath', 'loadActivityTextPage', 'activityCanManageAll', 'activityIsManagerScope', 'activityIsAdministrative', 'isInManagerActivityScope', 'prospectSectionPlazas', 'consolidateProspectFiles', 'consolidateActivityExportProspects', 'activityQueryContextKey', 'invalidateActivityQueryCache', 'activityEnsureQueryContext', 'activityBoundedRead', 'activityCopyDisplayMetadata', 'activityDisplayLinkedPath', 'buildActivityDisplayItems', 'cancelActivityDirectLoad', 'resetActivityDirectCache', 'activityDirectReadPlazas', 'activityDirectProjectSummary', 'activityDirectUpdateStatus', 'activityGetDirectEntry', 'activityDirectScanRound', 'activityEnsureDirectRecords', 'activityDirectConsolidateRecords', 'activityRoutesSdkRead'];
NAMES.push('estimateDataUsageBytes');
const STATES = ['ACTIVITY_RESULTS_PAGE_SIZE', 'FIREBASE_PUSH_ID_CHARS', 'PANEL_PLAZAS', 'TAMPICO_MADERO_MANAGER_EMAIL', 'ACTIVITY_QUERY_TTL_MS', 'ACTIVITY_SUMMARY_FIELDS', 'ACTIVITY_DIRECT_COVERAGE_MESSAGE', 'ACTIVITY_DIRECT_FIELDS', '_activityDirectEntries', '_activityDirectGeneration', '_activityQueryEntries', '_activityMetadataCache', '_activityQueryGeneration', '_activityQueryContext', '_activityLightReads', '_activityLightWaiters', '_activitySearchRun', '_activityUserDirectory', '_activityPageSession', '_activityAnalysisData', '_activityAnalysisSignature', '_activityAnalysisLoading', '_activityDetailCache', '_activitiesData', '_activitiesFiltered', '_activitiesVisibleCount'];
const DAY = '2026-10-01', BASE = new Date(`${DAY}T10:00:00`).getTime();
function snapshot(value, key = '') {
  return { key, val: () => value == null ? null : value, exists: () => value != null, forEach: callback => {
    for (const [id, row] of Object.entries(value || {}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) if (callback(snapshot(row, id)) === true) break;
  } };
}
function harness({ role = 'ADMINISTRATIVO', plaza = 'CHIHUAHUA', email = 'admin@example.test', deny, delay = 0, beforeRead, realRender = false } = {}) {
  const store = { gestor_activities: {}, activity_summaries: { plazas: {} } };
  const reads = [], restReads = [], usage = [], alerts = [], nodes = {}, events = {}, forbidden = [];
  let time = Date.now(), inFlight = 0, maxInFlight = 0, cancellations = 0, renders = 0;
  const node = id => nodes[id] ||= { value: '', innerHTML: '', textContent: '', style: {}, querySelectorAll: () => [], setAttribute() {} };
  node('activityStartDate').value = DAY; node('activityEndDate').value = DAY;
  const auth = { currentUser: { uid: 'operator-synthetic', email, getIdToken: async () => 'synthetic-token' } };
  const refuse = name => () => { forbidden.push(name); throw Error(`Prohibido ${name}`); };
  function onValue(request, success, failure, options) {
    assert.equal(options.onlyOnce, true);
    const route = request.route || request;
    const reading = { route, ...(request.constraints ? { constraints: plain(request.constraints) } : {}) };
    reads.push(reading);
    inFlight++; maxInFlight = Math.max(inFlight, maxInFlight);
    let active = true, settled = false;
    const timer = setTimeout(async () => {
      try {
        if (beforeRead) await beforeRead(reading, { node, auth });
        if (!active) return;
        if (deny?.(route)) { failure(Error('PERMISSION_DENIED')); return; }
        let value = route.split('/').reduce((obj, key) => obj?.[key], store);
        if (request.constraints) {
          assert.match(route, /^activity_summaries\/plazas\/[^/]+$/);
          const c = request.constraints;
          assert.deepEqual(c.map(item => item.type), ['key', 'start', 'end', 'last']);
          assert.equal(c[3].count, 51);
          // No hoja ni candidato exterior: todos los requests conservan límite inferior.
          assert.equal(c[1].value, api.firebasePushIdBoundary(api.currentActivityFilterCriteria().start, '-'));
          assert.ok(c[2].value <= api.firebasePushIdBoundary(api.currentActivityFilterCriteria().end, 'z'));
          const rows = Object.entries(value || {}).sort(([a], [b]) => a < b ? -1 : 1).filter(([key]) => key >= c[1].value && key <= c[2].value).slice(-51);
          value = rows.length ? Object.fromEntries(rows) : null;
        } else assert.match(route, /^gestor_activities\/[A-Za-z0-9_-]{20}\/plaza$/, `No lectura masiva/canónica ${route}`);
        success(snapshot(value));
      } catch (error) { if (active) failure(error); }
      finally { settled = true; if (active) { active = false; inFlight--; } }
    }, delay);
    return () => { if (active) { active = false; inFlight--; if (!settled) { cancellations++; clearTimeout(timer); } } };
  }
  async function fetch(url, options) {
    const parsed = new URL(url);
    assert.equal(parsed.pathname, '/activity_summaries/plazas.json');
    assert.deepEqual([...parsed.searchParams.keys()].sort(), ['auth', 'shallow']);
    assert.equal(parsed.searchParams.get('shallow'), 'true');
    assert.equal(parsed.searchParams.get('auth'), 'synthetic-token');
    assert.equal(options.cache, 'no-store'); assert.equal(options.credentials, 'omit');
    assert.equal(options.referrerPolicy, 'no-referrer'); assert.equal(options.redirect, 'error');
    restReads.push('activity_summaries/plazas');
    if (deny?.('activity_summaries/plazas')) return { ok: false };
    return { ok: true, json: async () => Object.fromEntries(Object.keys(store.activity_summaries.plazas).map(key => [key, true])) };
  }
  class Clock extends Date { static now() { return time; } }
  const context = vm.createContext({ window: { renderActivities() { renders++; }, showPanelHome() {} }, document: { getElementById: node, addEventListener(name, callback) { (events[name] ||= []).push(callback); } }, database: {}, auth, console, Date: Clock, AbortController, onValue, fetch, setTimeout, clearTimeout, TextEncoder,
    ref: (_, route) => route === undefined ? { toString: () => 'https://synthetic.example.test/' } : route,
    query: (route, ...constraints) => ({ route, constraints }), orderByKey: () => ({ type: 'key' }), startAt: value => ({ type: 'start', value }), endAt: value => ({ type: 'end', value }), limitToLast: count => ({ type: 'last', count }),
    recordPanelDataUsage: (name, data) => usage.push({ name, data: plain(data) }), alert: message => alerts.push(message), resetActivityLocationCache() {}, renderActivityRoutesReport() {},
    updateActivityActionFilterLabel() {}, renderActivityActionFilterOptions() {},
    get: refuse('get'), set: refuse('set'), update: refuse('update'), remove: refuse('remove'), setInterval: refuse('setInterval'), hydrateActivityDisplayMetadata: refuse('hydrateActivityDisplayMetadata'), activityGetLightEntry: refuse('activityGetLightEntry'), activityEnsureLightRecords: refuse('activityEnsureLightRecords'),
  });
  const eventsCode = html.slice(html.indexOf("  document.addEventListener?.('input', event => {", html.indexOf('const ACTIVITY_DIRECT_COVERAGE_MESSAGE')), html.indexOf('  async function activityDirectReadPlazas'));
  vm.runInContext([...STATES.map(decl), ...NAMES.map(fn), `let _activityProfile = ${JSON.stringify({ rol: role, plaza })}; let _selectedActivityActionFilters = new Set();`, eventsCode,
    action('searchActivities'), action('loadMoreActivities'), action('closeActivities'), action('setActivityActionFilter'), action('clearActivityActionFilters'),
    `globalThis.api = { ${NAMES.join(',')}, data: () => _activitiesData, page: () => _activityPageSession, cache: () => _activityDirectEntries, analysis: () => _activityAnalysisData, setAnalysis: x => { _activityAnalysisData = x; _activityAnalysisSignature = activityQueryContextKey() + '|' + activityFilterSignature(currentActivityFilterCriteria()); }, actions: values => { _selectedActivityActionFilters = new Set(values); }, profile: () => _activityProfile };`,
  ].join('\n\n'), context, { filename: 'index.html[REAL-direct-range]' });
  const api = context.api;
  if (realRender) vm.runInContext([`let _activityResponseChartType = '';`, action('renderActivities')].join('\n'), context);
  return { api, window: context.window, store, auth, reads, restReads, usage, alerts, forbidden, node, emit: (name, id) => { for (const callback of events[name] || []) callback({ target: { id } }); }, maxInFlight: () => maxInFlight, cancellations: () => cancellations, renders: () => renders, advance: ms => { time += ms; } };
}
function fixture(h, count, { plaza = 'CHIHUAHUA', at = BASE, same = false, overrides = {}, missingSummary = false } = {}) {
  const rows = [];
  h.store.activity_summaries.plazas[plaza] ||= {};
  for (let i = 0; i < count; i++) {
    const id = same ? h.api.firebasePushIdBoundary(at, '-').slice(0, 8) + i.toString().padStart(12, '0') : h.api.firebasePushIdBoundary(at + i, '-');
    const row = { id, tipo: 'GENERAL', rol: 'GESTOR', plaza, uid: 'employee', nombre_usuario: 'José Díaz', correo_usuario: 'jose@example.test', nombre_contacto: `Cliente ${i}`, gestion_realizada: 'LLAMADA', created_at: at + (same ? 0 : i), ...overrides };
    h.store.gestor_activities[id] = { ...row, historial_expediente: { old: { fecha: at - 86400000 } }, foto_base64: 'data:image/jpeg;base64,' + 'a'.repeat(20000), latitud: 20, longitud: -97 };
    if (!missingSummary) h.store.activity_summaries.plazas[plaza][id] = { ...row };
    rows.push(row);
  }
  return rows;
}
const indexReads = h => h.reads.filter(r => r.constraints).length;
const canonicalReads = h => h.reads.filter(r => !r.constraints).length;
const dataIds = h => Array.from(h.api.data(), r => r.id);
async function drain(h, max = 20) {
  let clicks = 0;
  while (h.api.page()?.hasMore && clicks++ < max) await h.window.loadMoreActivities();
  assert.ok(clicks <= max, 'No historial infinito');
}

test('contrato directo separado de legacy: sólo fichas, metadato interno y sin raíz/usuarios/GPS/medios', () => {
  for (const name of ['activityGetDirectEntry', 'activityDirectScanRound', 'activityEnsureDirectRecords']) assert.doesNotMatch(fn(name), /activityGetLightEntry|activityReadLightRecord|hydrateActivityDisplayMetadata|loadActivityUserDirectory|gestor_photos|\/historial_expediente/);
  assert.match(action('searchActivities'), /activityGetDirectEntry/);
  assert.doesNotMatch(action('searchActivities'), /activityGetLightEntry|invalidateActivityQueryCache/);
  assert.match(fn('loadActivityAnalysisData'), /activityGetLightEntry\(criteria/);
  assert.match(fn('loadActivityTextPage'), /if \(session\.directEntry\)/);
});

test('24,000 registros e índices exteriores no aumentan lecturas frente al mismo rango sin exteriores', async () => {
  const run = async outside => {
    const h = harness(); fixture(h, 123);
    if (outside) fixture(h, 24000, { at: BASE - 10 * 86400000 });
    assert.equal(await h.window.searchActivities(), true);
    assert.equal(h.api.data().length, 50);
    await drain(h);
    assert.equal(h.api.data().length, 123);
    assert.equal(new Set(dataIds(h)).size, 123);
    assert.equal(canonicalReads(h), 0); assert.deepEqual(h.forbidden, []);
    return { reads: indexReads(h), shallow: h.restReads.length, total: h.api.data().length };
  };
  assert.deepEqual(await run(true), await run(false));
});

for (const count of [0, 50, 51, 123]) test(`mismo milisegundo ${count}: páginas hasta 50, frontera +1 sin perder IDs`, async () => {
  const h = harness(); const rows = fixture(h, count, { same: true });
  assert.equal(await h.window.searchActivities(), true);
  assert.ok(h.api.page().directOffset <= 50);
  let previous = h.api.page().directOffset;
  while (h.api.page().hasMore) {
    await h.window.loadMoreActivities();
    const next = h.api.page().directOffset;
    assert.ok(next - previous <= 50); previous = next;
  }
  assert.deepEqual([...dataIds(h)].sort(), rows.map(r => r.id).sort());
  assert.equal(new Set(dataIds(h)).size, count);
  assert.equal(indexReads(h), Math.max(1, Math.ceil(count / 50)));
});

test('0 + Continuar sparse: máximo dos rondas por plaza/clic, repetición no escanea y vacío revisado queda cacheado', async () => {
  const h = harness(); fixture(h, 350, { overrides: { nombre_usuario: 'Otra persona' } });
  h.node('activityUser').value = 'No coincide';
  assert.equal(await h.window.searchActivities(), true);
  assert.equal(h.api.data().length, 0); assert.equal(indexReads(h), 2);
  assert.equal(h.api.page().hasMore, true); assert.equal(h.api.page().scanned, 100);
  assert.match(h.api.page().statusText, /fichas DEL RANGO/);
  await h.window.searchActivities(); assert.equal(indexReads(h), 2);
  await h.window.loadMoreActivities(); assert.equal(indexReads(h), 4); assert.equal(h.api.page().scanned, 200);
  await drain(h); assert.equal(indexReads(h), 7); assert.equal(h.api.page().hasMore, false);
  await h.window.searchActivities(); assert.equal(indexReads(h), 7);
  assert.match(h.api.page().statusText, /Rango de fichas revisado/);
  assert.equal(canonicalReads(h), 0); assert.deepEqual(h.forbidden, []);
});

test('TTL cinco minutos / force / caché máximo tres firmas, no afecta gráficos ni legacy', async () => {
  const h = harness(); fixture(h, 1);
  await h.window.searchActivities(); const entry = h.api.page().directEntry;
  h.api.setAnalysis(['analytical-legacy']);
  await h.window.searchActivities(); assert.equal(indexReads(h), 1);
  h.advance(299999); await h.window.searchActivities(); assert.equal(indexReads(h), 1);
  h.advance(1); await h.window.searchActivities(); assert.equal(indexReads(h), 2);
  assert.notEqual(h.api.page().directEntry, entry);
  await h.window.searchActivities({ force: true }); assert.equal(indexReads(h), 3);
  assert.deepEqual(plain(h.api.analysis()), ['analytical-legacy']);
  for (const value of ['a', 'b', 'c', 'd']) { h.node('activityUser').value = value; await h.window.searchActivities(); }
  assert.equal(h.api.cache().size, 3);
});

test('dedup in-flight de Buscar repetido y Cargar más: sin duplicados ni petición extra', async () => {
  const h = harness({ delay: 3 }); fixture(h, 123);
  const results = await Promise.all([h.window.searchActivities(), h.window.searchActivities(), h.window.searchActivities()]);
  assert.equal(results.at(-1), true); assert.equal(indexReads(h), 1);
  await Promise.all([h.window.loadMoreActivities(), h.window.loadMoreActivities(), h.window.loadMoreActivities()]);
  assert.equal(indexReads(h), 2); assert.equal(h.api.data().length, 100);
  assert.equal(new Set(dataIds(h)).size, 100);
});

test('sesión cambia durante lectura / misma firma en nuevo usuario no comparte caché', async () => {
  const h = harness({ delay: 5 }); fixture(h, 123);
  const pending = h.window.searchActivities();
  h.auth.currentUser = { ...h.auth.currentUser, uid: 'other-session' };
  assert.equal(await pending, false); assert.equal(h.api.page(), null);
  assert.equal(await h.window.searchActivities(), true);
  const initial = indexReads(h);
  h.auth.currentUser = { ...h.auth.currentUser, uid: 'third-session' };
  assert.equal(await h.window.searchActivities(), true); assert.equal(indexReads(h), initial + 1);
});

for (const stop of ['close', 'input', 'change', 'actions']) test(`cancelación real SDK ${stop}: cierre/filtros impide continuación y retira listener`, async () => {
  const h = harness({ delay: 30 }); fixture(h, 123);
  const pending = h.window.searchActivities();
  await new Promise(resolve => setTimeout(resolve, 4));
  if (stop === 'close') h.window.closeActivities();
  else if (stop === 'actions') { h.window.setActivityActionFilter('GENERAL|LLAMADA', true); }
  else { h.node('activityUser').value = 'nuevo'; h.emit(stop, 'activityUser'); }
  assert.equal(await pending, false);
  assert.equal(h.api.page(), null); assert.ok(h.cancellations() >= 1);
  const before = indexReads(h); await h.window.loadMoreActivities(); assert.equal(indexReads(h), before);
});

test('error permisos índice/shallow/plaza canónica no confirma cero ni fallback canónico', async () => {
  for (const config of [
    { deny: route => route === 'activity_summaries/plazas' },
    { deny: route => route.startsWith('activity_summaries/plazas/') },
    { role: 'GERENTE', deny: route => route.endsWith('/plaza') },
  ]) {
    const h = harness(config); fixture(h, 3);
    assert.equal(await h.window.searchActivities(), false);
    assert.equal(h.api.page(), null);
    assert.match(h.node('activitiesTableContainer').innerHTML, /Error/);
    assert.doesNotMatch(h.node('activitiesTableContainer').innerHTML, /No hay actividades que/);
    assert.ok(h.api.cache().size === 0); assert.deepEqual(h.forbidden, []);
  }
});

test('gerente: validar CANÓNICA sólo matches de ficha; obsoleta fuera alcance excluida antes de IDs; sin fuentes exteriores', async () => {
  const h = harness({ role: 'GERENTE', plaza: 'CHIHUAHUA' });
  const rows = fixture(h, 4);
  h.node('activityUser').value = 'José';
  h.store.gestor_activities[rows[0].id].plaza = 'TAMPICO';
  h.store.activity_summaries.plazas.CHIHUAHUA[rows[1].id].nombre_usuario = 'No coincide';
  h.store.activity_summaries.plazas.CHIHUAHUA[rows[1].id].correo_usuario = 'other@example.test';
  h.store.activity_summaries.plazas.CHIHUAHUA[rows[2].id].plaza = 'TAMPICO';
  await h.window.searchActivities();
  assert.deepEqual(dataIds(h), [rows[3].id]);
  assert.equal(canonicalReads(h), 2); assert.equal(h.restReads.length, 0);
  assert.equal(h.api.page().directEntry.seen.has(rows[0].id), false);
  assert.equal(h.api.page().directEntry.seen.has(rows[2].id), false);
  assert.match(h.api.page().statusText, /excluida/);
  h.node('activityPlaza').value = 'TAMPICO'; const before = h.reads.length;
  assert.equal(await h.window.searchActivities(), false); assert.equal(h.reads.length, before);
});

test('cobertura única gerente Tampico–Madero: ambas plazas autorizadas, filtro plaza conserva scope', async () => {
  const h = harness({ role: 'GERENTE', plaza: 'TAMPICO', email: 'gerente.tampico@fredinero.com' });
  fixture(h, 20, { plaza: 'TAMPICO' }); fixture(h, 20, { plaza: 'MADERO', at: BASE + 1000 }); fixture(h, 20, { plaza: 'CHIHUAHUA', at: BASE + 2000 });
  await h.window.searchActivities();
  assert.equal(h.api.data().length, 40); assert.equal(indexReads(h), 2); assert.equal(canonicalReads(h), 40);
  assert.deepEqual(h.restReads, []);
  assert.ok(h.reads.filter(r => r.constraints).every(r => /\/(TAMPICO|MADERO)$/.test(r.route)));
  h.node('activityPlaza').value = 'MADERO'; await h.window.searchActivities(); assert.equal(h.api.data().length, 20);
});

test('all/admin: shallow sólo nombres, plaza fuera catálogo incluida, filtros tipo/rol/usuario/acción sólo ficha; concurrencia <=6', async () => {
  const h = harness({ delay: 1 });
  for (let i = 0; i < 9; i++) fixture(h, 15, { plaza: `PLAZA ${i}`, at: BASE + i * 100, overrides: { tipo: i % 2 ? 'GENERAL' : 'COBRANZA', gestion_realizada: i % 2 ? 'LLAMADA' : 'AVISO EN PUERTA' } });
  h.node('activityType').value = 'GENERAL'; h.node('activityRole').value = 'GESTOR'; h.node('activityUser').value = 'jose'; h.api.actions(['GENERAL|LLAMADA']);
  await h.window.searchActivities(); await drain(h);
  assert.equal(h.api.data().length, 60); assert.equal(indexReads(h), 9); assert.deepEqual(h.restReads, ['activity_summaries/plazas']);
  assert.ok(h.maxInFlight() <= 6); assert.equal(canonicalReads(h), 0);
  assert.ok(h.api.data().every(row => row.tipo === 'GENERAL'));
  assert.doesNotMatch(JSON.stringify(h.usage), /synthetic-token|shallow=true|auth=/);
});

test('dedupe mismo ID en plazas: una coincidencia aunque ficha repetida, ningún usuario cambia el scope', async () => {
  const h = harness(); const [row] = fixture(h, 1);
  h.store.activity_summaries.plazas.TAMPICO = { [row.id]: { ...row, plaza: 'TAMPICO' } };
  h.node('activityUser').value = 'jose'; await h.window.searchActivities();
  assert.equal(h.api.data().length, 1); assert.equal(indexReads(h), 2); assert.equal(canonicalReads(h), 0);
  assert.deepEqual(h.restReads, ['activity_summaries/plazas']);
});

test('specialIDs, fichas incompletas y faltantes: aviso índice pendiente sin histórico fallback ni base64/objetos incrustados', async () => {
  const h = harness(); const [row] = fixture(h, 1);
  fixture(h, 2, { at: BASE + 100, missingSummary: true });
  const summaries = h.store.activity_summaries.plazas.CHIHUAHUA;
  summaries['legacy-nonchronological'] = { ...row, id: 'legacy-nonchronological' };
  const id = h.api.firebasePushIdBoundary(BASE + 10, '-'); summaries[id] = { plaza: 'CHIHUAHUA', nombre_usuario: 'José' };
  Object.assign(summaries[row.id], { id: 'forged-identity', foto_base64: 'data:image/png;base64,SECRET', historial_expediente: { secret: true }, nombre_contacto: 'data:image/png;base64,SECRET', telefono: 'a'.repeat(800), uid: { secret: 'SECRET' } });
  await h.window.searchActivities();
  assert.equal(h.api.data().length, 1); assert.equal(h.api.data()[0].id, row.id);
  assert.equal(h.api.data()[0].nombre_contacto, undefined); assert.equal(h.api.data()[0].uid, undefined);
  assert.doesNotMatch(JSON.stringify(h.api.data()) + JSON.stringify(h.usage), /SECRET|base64|historial_expediente|latitud|longitud/);
  assert.equal(canonicalReads(h), 0); assert.match(h.api.page().statusText, /sin ficha o sin ID cronológico requieren índice pendiente/);
  assert.match(h.api.page().statusText, /incompleta/);
});

test('PROS raíz capturada/seguimiento dentro rango no se omite por actualizado_en posterior; autor local real y captura no cambia canon/legacy', async () => {
  const h = harness();
  const [root] = fixture(h, 1, { at: BASE, overrides: { tipo: 'PROSPECCION', nombre_prospecto: 'Cliente', es_expediente_prospeccion: true, uid: 'CREATOR', nombre_usuario: 'Creador', actualizado_en: BASE + 20 * 86400000 } });
  const [child] = fixture(h, 1, { at: BASE + 2000, overrides: { tipo: 'PROSPECCION', nombre_prospecto: 'Cliente', es_expediente_prospeccion: false, seguimiento_de: root.id, uid: 'FOLLOWER', nombre_usuario: 'Seguidor', actualizado_en: BASE + 30 * 86400000 } });
  const canonical = plain(h.store.gestor_activities);
  await h.window.searchActivities();
  assert.equal(h.api.data().length, 1);
  assert.equal(h.api.data()[0]._display_related_records.length, 2);
  assert.equal(h.api.data()[0]._activity_direct_capture_at, BASE + 2000);
  assert.equal(h.api.activityMatchesCriteria(h.api.data()[0], h.api.currentActivityFilterCriteria()), true);
  assert.equal(h.api.activityMatchesCriteria({ ...h.api.data()[0] }, h.api.currentActivityFilterCriteria()), false, 'legacy sin metadato sigue último movimiento');
  const [item] = h.api.buildActivityDisplayItems(h.api.data());
  assert.equal(item.owner.uid, 'CREATOR'); assert.equal(item.owner.name, 'Creador');
  assert.ok(item.relatedRecords.some(r => r.uid === 'FOLLOWER'));
  assert.equal(Object.keys(h.api.data()[0]).includes('_activity_direct_capture_at'), false);
  assert.deepEqual(plain(h.store.gestor_activities), canonical); assert.equal(canonicalReads(h), 0);
});

test('raíz exterior: autor por confirmar conserva plaza, nunca atribuye seguidor; raíz local en siguiente página recomputa propietario', async () => {
  const h = harness();
  const [root] = fixture(h, 1, { at: BASE, overrides: { tipo: 'PROSPECCION', uid: 'CREATOR', nombre_usuario: 'Creador', nombre_prospecto: 'Cliente', es_expediente_prospeccion: true } });
  fixture(h, 50, { at: BASE + 100, overrides: { tipo: 'PROSPECCION', uid: 'FOLLOWER', nombre_usuario: 'Seguidor', nombre_prospecto: 'Cliente', es_expediente_prospeccion: false, seguimiento_de: root.id } });
  await h.window.searchActivities();
  let [item] = h.api.buildActivityDisplayItems(h.api.data());
  assert.match(item.owner.uid, /^pending-root:/); assert.equal(item.owner.name, 'Autor original por confirmar'); assert.equal(item.owner.plaza, 'CHIHUAHUA');
  assert.equal(item.root_path, `gestor_activities/${root.id}`); assert.equal(canonicalReads(h), 0);
  await h.window.loadMoreActivities();
  [item] = h.api.buildActivityDisplayItems(h.api.data()); assert.equal(item.owner.uid, 'CREATOR'); assert.equal(item.relatedRecords.length, 51);
  assert.equal(canonicalReads(h), 0);
  const outer = harness(); const [exterior] = fixture(outer, 1, { at: BASE - 86400000, overrides: { tipo: 'PROSPECCION', uid: 'CREATOR' } });
  fixture(outer, 1, { overrides: { tipo: 'PROSPECCION', seguimiento_de: exterior.id, nombre_usuario: 'Seguidor' } });
  await outer.window.searchActivities();
  const [unknown] = outer.api.buildActivityDisplayItems(outer.api.data()); assert.equal(unknown.owner.name, 'Autor original por confirmar'); assert.equal(canonicalReads(outer), 0);
});

test('UI vacía REAL: cobertura siempre visible, rango revisado nunca cero histórico definitivo', async () => {
  const h = harness({ realRender: true }); fixture(h, 0);
  await h.window.searchActivities();
  const text = h.node('activitiesTableContainer').innerHTML;
  assert.match(text, /activityCoverageStatus/); assert.match(text, /fecha de captura/); assert.match(text, /no confirma cero actividades históricas/);
  assert.doesNotMatch(text, /No hay actividades que cumplan/);
});

test('fallo posterior a búsqueda exitosa no conserva sesión vieja ni permite continuación', async () => {
  let denied = false;
  const h = harness({ deny: route => denied && route.startsWith('activity_summaries/plazas/') });
  fixture(h, 123); await h.window.searchActivities(); assert.equal(h.api.page().hasMore, true);
  denied = true;
  assert.equal(await h.window.searchActivities({ force: true }), false);
  assert.equal(h.api.page(), null);
  const before = indexReads(h); await h.window.loadMoreActivities(); assert.equal(indexReads(h), before);
});

test('seguimiento con enlace incompleto no convierte actor disponible en creador confirmado', async () => {
  const h = harness();
  fixture(h, 1, { overrides: { tipo: 'PROSPECCION', es_expediente_prospeccion: false, uid: 'FOLLOWER', nombre_usuario: 'Seguidor', nombre_prospecto: 'Cliente' } });
  await h.window.searchActivities();
  const [item] = h.api.buildActivityDisplayItems(h.api.data());
  assert.equal(item.owner.name, 'Autor original por confirmar'); assert.match(item.owner.uid, /^pending-root:/);
  assert.equal(item.owner.plaza, 'CHIHUAHUA'); assert.equal(canonicalReads(h), 0);
});

test('clave dentro del día con fecha real de captura exterior: se excluye sin leer el canónico y sin usar actualizado_en', async () => {
  const h = harness();
  fixture(h, 1, { at: BASE, overrides: { created_at: BASE + 86400000, actualizado_en: BASE } });
  await h.window.searchActivities();
  assert.equal(h.api.data().length, 0);
  assert.equal(indexReads(h), 1);
  assert.equal(canonicalReads(h), 0);
  assert.equal(h.api.page().hasMore, false);
  assert.match(h.api.page().statusText, /sin ficha o sin ID cronológico requieren índice pendiente/);
});

test('diagnóstico mide respuestas del índice aunque no coincidan; cache y continuar sin lecturas registran cero bytes', async () => {
  const h = harness(); fixture(h, 4);
  h.node('activityUser').value = 'Sin coincidencias';
  await h.window.searchActivities();
  assert.equal(h.api.data().length, 0);
  const measured = h.usage.filter(event => event.name === 'PANEL_ACTIVITY_SEARCH_PAGE');
  assert.ok(measured[0].data.estimatedBytes > 100, 'Cuenta las fichas recibidas y descartadas');
  const count = indexReads(h);
  await h.window.searchActivities();
  assert.equal(indexReads(h), count);
  assert.equal(h.usage.filter(event => event.name === 'PANEL_ACTIVITY_SEARCH_PAGE').at(-1).data.estimatedBytes, 0);
  await h.window.loadMoreActivities();
  assert.equal(indexReads(h), count);
  assert.equal(h.usage.filter(event => event.name === 'PANEL_ACTIVITY_SEARCH_PAGE').at(-1).data.estimatedBytes, 0);
});
