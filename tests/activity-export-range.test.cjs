'use strict';

// Ejecutar: node --test tests/activity-export-range.test.cjs
// Único archivo de prueba: código REAL de index.html extraído mediante regex + VM.
// Sin Firebase SDK, datos productivos, red, escrituras, listeners ni polling.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { Blob } = require('node:buffer');
const html = readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const TYPES = ['GENERAL', 'COBRANZA', 'PROSPECCION'];
const DAY = '2026-11-06';
const BASE = new Date(`${DAY}T10:00:00`).getTime();
const FUNCTION_NAMES = [
  'normaliseActivityText', 'activityCategory', 'activityCategoryLabel',
  'activityCreatedTimestamp', 'firebasePushIdBoundary', 'firebasePushIdTimestamp',
  'isStoredActivityRecord', 'matchesActivityUser', 'activityMatchesSelectedActions',
  'activityFilterRecordAction', 'currentActivityFilterCriteria', 'activityFilterSignature',
  'activityMatchesCriteria', 'activityPageRecordMatches', 'activityPreview',
  'activityAnalysisPreview', 'activityRecordPath', 'loadFullActivityRecord',
  'loadActivityTextPage', 'loadActivityUserDirectory', 'resolveActivitySearchSource',
  'activityCanManageAll', 'activityIsManagerScope', 'activityIsAdministrative',
  'isInManagerActivityScope', 'prospectSectionPlazas', 'consolidateProspectFiles',
  'activityExportValue', 'activityExportContextKey', 'setActivityExportProgress',
  'setActivityExportBusy', 'activityExportTextRecord', 'activityExportCsvQ',
  'loadActivityExportRecords', 'downloadActivitiesCsv', 'csvQ', 'formatRecordDateTime',
  'consolidateActivityExportProspects', 'validateActivityExportProfile',
  'activityQueryContextKey', 'invalidateActivityQueryCache', 'activityEnsureQueryContext',
  'activityBoundedRead', 'activityReadShallowKeys', 'activityCachedKeys',
];
const CONSTANT_NAMES = [
  'ACTIVITY_RESULTS_PAGE_SIZE', 'FIREBASE_PUSH_ID_CHARS', 'PANEL_PLAZAS',
  'TAMPICO_MADERO_MANAGER_EMAIL', 'ACTIVITY_QUERY_TTL_MS',
];
function sourceFunction(name) {
  const match = html.match(new RegExp(`^  (?:async )?function ${name}\\([^\\n]*\\) \\{(?:[^\\n]*\\}$|\\n[\\s\\S]*?^  \\})`, 'm'));
  assert.ok(match, `Función real ${name} debe existir en index.html`);
  return match[0];
}
function sourceAction(name) {
  const match = html.match(new RegExp(`^  window\\.${name} = (?:async )?function\\([^\\n]*\\) \\{(?:[^\\n]*\\};$|\\n[\\s\\S]*?^  \\};)`, 'm'));
  assert.ok(match, `Acción real window.${name} debe existir en index.html`);
  return match[0];
}
function sourceConstant(name) {
  const match = html.match(new RegExp(`^  const ${name} = (?:[^\\n]+;|[\\s\\S]*?^  [^\\n]*;)`, 'm'));
  assert.ok(match, `Constante real ${name} debe existir en index.html`);
  return match[0];
}
function sourceAttributes(id) {
  const match = html.match(new RegExp(`<([a-z]+)\\b[^>]*\\bid="${id}"[^>]*>`, 'i'));
  assert.ok(match, `Elemento real #${id}`);
  const attrs = {};
  for (const [, key, quote, value] of match[0].matchAll(/([\w-]+)\s*=\s*(["'])(.*?)\2/g)) attrs[key] = value;
  return { tagName: match[1].toUpperCase(), attributes: attrs };
}
function snapshot(value, key = '') {
  return {
    key,
    exists: () => value !== undefined && value !== null,
    val: () => value == null ? null : plain(value),
    forEach(callback) {
      for (const [childKey, childValue] of Object.entries(value || {}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
        if (callback(snapshot(childValue, childKey)) === true) return true;
      }
      return false;
    },
  };
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function harness({ store = {}, role = 'ADMINISTRATIVO', plaza = 'CHIHUAHUA', email = 'admin@example.test', beforeRead, denyShallow = false } = {}) {
  const nodes = Object.create(null);
  const reads = [], queryReads = [], canonicalReads = [], usage = [], alerts = [];
  const profileReads = [], scopeReads = [], shallowReads = [];
  store.users ||= {};
  store.users['session-synthetic'] ||= { rol: role, plaza };
  const forbidden = [], downloads = [], createdUrls = [], revokedUrls = [], timers = [];
  const blobs = new Map();
  let context, inFlightCanonical = 0, maxInFlightCanonical = 0;
  const deny = name => () => { forbidden.push(name); throw new Error(`Operación prohibida: ${name}`); };
  const node = id => {
    if (nodes[id]) return nodes[id];
    const { tagName, attributes } = sourceAttributes(id);
    return nodes[id] = {
      id, tagName, attributes: { ...attributes }, value: attributes.value || '',
      textContent: '', style: {}, disabled: false,
      setAttribute(key, value) { this.attributes[key] = String(value); },
      getAttribute(key) { return this.attributes[key] ?? null; },
      click() {
        assert.ok(this.attributes.onclick, `#${id} debe tener onclick real`);
        return vm.runInContext(this.attributes.onclick, context, { filename: `index.html#${id}[onclick]` });
      },
    };
  };
  for (const id of ['activityStartDate', 'activityEndDate', 'activityType', 'activityRole', 'activityPlaza', 'activityUser', 'activityExportStatus', ...TYPES.map(type => `activityExport${type}`)]) node(id);
  node('activityStartDate').value = DAY;
  node('activityEndDate').value = DAY;
  for (const id of ['activityType', 'activityRole', 'activityPlaza', 'activityUser']) node(id).value = '';
  const auth = { currentUser: { uid: 'session-synthetic', email, getIdToken: async () => 'synthetic-token' } };
  const createAnchor = () => ({
    tagName: 'A', href: '', download: '', style: {}, appended: false, removed: false,
    click() {
      assert.equal(this.appended, true, 'El link se añade al DOM antes de descargar');
      assert.ok(blobs.has(this.href), 'La URL corresponde a un Blob real');
      assert.ok(TYPES.every(type => node(`activityExport${type}`).disabled), 'Descarga protegida por busy');
      downloads.push({ blob: blobs.get(this.href), href: this.href, filename: this.download, anchor: this });
    },
    remove() { this.removed = true; },
  });
  const get = async request => {
    const route = typeof request === 'string' ? request : request.route;
    assert.ok(route && route !== '/', 'Prohibidas lecturas de raíz RTDB');
    const scopeLeaf = /^gestor_activities\/[^/]+(?:\/[^/]+)?\/plaza$/.test(route);
    const canonical = !scopeLeaf && /^gestor_activities\/[^/]+(?:\/[^/]+)?$/.test(route);
    const profileLeaf = /^users\/[^/]+\/(rol|plaza)$/.test(route);
    const identityLeaf = /^users\/[^/]+\/(nombre_completo|nombre|correo|email)$/.test(route);
    if (typeof request === 'string') {
      assert.ok(route === 'notice_directory/by_uid' || canonical || profileLeaf || identityLeaf || scopeLeaf, `Lectura individual no autorizada en el test: ${route}`);
      if (scopeLeaf) assert.equal(context.api.activityIsManagerScope(), true, 'Sólo gerencia verifica plaza escalar antes de recuperar históricos');
    } else {
      assert.ok(route === 'gestor_activities' || /^activity_summaries\/(plazas|users)\/[^/]+$/.test(route), `Fuente inesperada: ${route}`);
      assert.deepEqual(request.constraints.map(c => c.type), ['key', 'start', 'end', 'last']);
      assert.equal(request.constraints.at(-1).count, 51, 'Siempre 50 + 1, nunca descarga masiva');
    }
    reads.push(plain(request));
    const entry = { route, constraints: request.constraints ? plain(request.constraints) : null, keys: [], count: null };
    if (canonical) {
      canonicalReads.push(entry);
      inFlightCanonical += 1;
      maxInFlightCanonical = Math.max(maxInFlightCanonical, inFlightCanonical);
    } else if (request.constraints) queryReads.push(entry);
    else if (profileLeaf) profileReads.push(entry);
    else if (scopeLeaf) scopeReads.push(entry);
    try {
      if (beforeRead) await beforeRead(request, { node, auth, reads, queryReads, canonicalReads });
      let value = route.split('/').reduce((object, key) => object?.[key], store);
      if (request.constraints) {
        const start = request.constraints.find(c => c.type === 'start').value;
        const end = request.constraints.find(c => c.type === 'end').value;
        const limit = request.constraints.find(c => c.type === 'last').count;
        const rows = Object.entries(value || {}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
          .filter(([key]) => key >= start && key <= end).slice(-limit);
        entry.keys = rows.map(([key]) => key);
        entry.count = rows.length;
        value = rows.length ? Object.fromEntries(rows) : null;
      } else entry.count = value == null ? 0 : 1;
      return snapshot(value);
    } finally { if (canonical) inFlightCanonical -= 1; }
  };
  context = vm.createContext({
    window: { setTimeout(callback, delay) { assert.equal(delay, 1500); timers.push(callback); return timers.length; } },
    document: {
      getElementById: node,
      createElement(tagName) { assert.equal(tagName, 'a'); return createAnchor(); },
      body: { appendChild(anchor) { assert.equal(anchor.tagName, 'A'); anchor.appended = true; } },
    },
    database: {}, auth, console, Blob,
    URL: {
      createObjectURL(blob) {
        assert.ok(blob instanceof Blob, 'No sustitución de Blob: se usa Node Blob real');
        const url = `blob:synthetic/${createdUrls.length + 1}`;
        blobs.set(url, blob); createdUrls.push(url); return url;
      },
      revokeObjectURL(url) { assert.ok(blobs.has(url)); revokedUrls.push(url); },
    },
    alert: message => alerts.push(String(message)),
    recordPanelDataUsage: (name, data) => usage.push({ name, data: plain(data) }),
    ref: (_, route) => { if (route === undefined) return { toString: () => 'https://synthetic.example.test/' }; assert.ok(typeof route === 'string' && route); return route; },
    query: (route, ...constraints) => ({ route, constraints }),
    orderByKey: () => ({ type: 'key' }), startAt: value => ({ type: 'start', value }),
    endAt: value => ({ type: 'end', value }), limitToLast: count => ({ type: 'last', count }),
    get,
    set: deny('RTDB.set'), update: deny('RTDB.update'), remove: deny('RTDB.remove'), push: deny('RTDB.push'),
    onValue: deny('RTDB.onValue'), onChildAdded: deny('RTDB.onChildAdded'),
    onChildChanged: deny('RTDB.onChildChanged'), onChildRemoved: deny('RTDB.onChildRemoved'),
    onDisconnect: deny('RTDB.onDisconnect'), runTransaction: deny('RTDB.runTransaction'),
    fetch: async (url, options) => {
      const parsed = new URL(url);
      assert.equal(parsed.origin, 'https://synthetic.example.test');
      assert.deepEqual([...parsed.searchParams.keys()].sort(), ['auth', 'shallow']);
      assert.equal(parsed.searchParams.get('shallow'), 'true');
      assert.equal(parsed.searchParams.get('auth'), 'synthetic-token');
      assert.equal(options.method, 'GET'); assert.equal(options.cache, 'no-store');
      assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
      assert.equal(options.referrerPolicy, 'no-referrer');
      const route = decodeURIComponent(parsed.pathname.slice(1).replace(/\.json$/, ''));
      assert.ok(/^gestor_activities(?:\/[^/]+){0,2}$/.test(route) || route === 'users', 'Sólo claves de cobertura, hojas históricas o identidad');
      shallowReads.push(route);
      if (beforeRead) await beforeRead({ route, shallow: true }, { node, auth, reads, queryReads, canonicalReads });
      if (denyShallow) return { ok: false, json: async () => ({ error: 'Permisos sintéticos denegados' }) };
      const value = route.split('/').reduce((object, key) => object?.[key], store);
      return { ok: true, json: async () => value == null ? null : Object.fromEntries(Object.keys(value).map(key => [key, true])) };
    }, XMLHttpRequest: deny('XMLHttpRequest'), WebSocket: deny('WebSocket'),
    setInterval: deny('setInterval'), setTimeout: deny('global.setTimeout'),
    loadFullActivityRecords: deny('loadFullActivityRecords: hidratación masiva/CSV parcial'),
  });
  vm.runInContext([
    ...CONSTANT_NAMES.map(sourceConstant), ...FUNCTION_NAMES.map(sourceFunction),
    `let _activityProfile = ${JSON.stringify({ rol: role, plaza, managedPlazas: ['TAMPICO', 'MADERO'], plazas_cobertura: ['TAMPICO', 'MADERO'] })};`,
    'let _activityUserDirectory = null, _selectedActivityActionFilters = new Set(), _activityExportInFlight = false;',
    'const _activityQueryEntries = new Map(), _activityMetadataCache = new Map(), _activityLightWaiters = [];',
    'let _activityQueryGeneration = 0, _activityQueryContext = "", _activityLightReads = 0;',
    'let _activityPageSession = null, _activityAnalysisData = null, _activityAnalysisSignature = "", _activityAnalysisLoading = null;',
    'const _activityDetailCache = new Map();',
    // No se declaran _activitiesData/_activitiesFiltered/lista visible. Estado de caché aislado.
    sourceAction('exportActivitiesCsv'),
    `globalThis.api = { ${FUNCTION_NAMES.join(', ')},
      setActions: values => { _selectedActivityActionFilters = new Set(values); },
      replaceProfile: value => { _activityProfile = value; },
      profile: () => _activityProfile, busy: () => _activityExportInFlight,
      seedDetailCache: (route, value) => { _activityDetailCache.set(route, value); },
    };`,
  ].join('\n\n'), context, { filename: 'index.html[export-real-extracted]' });
  return {
    api: context.api, window: context.window, context, node, nodes, auth, store,
    reads, queryReads, canonicalReads, profileReads, scopeReads, shallowReads, usage, alerts, forbidden, downloads,
    createdUrls, revokedUrls, timers,
    maxCanonical: () => maxInFlightCanonical,
  };
}
function put(store, route, value) {
  const keys = route.split('/');
  let parent = store;
  for (const key of keys.slice(0, -1)) parent = parent[key] ||= {};
  parent[keys.at(-1)] = route === 'users' ? { ...parent.users, ...value } : value;
}
function record(h, index, type = 'GENERAL', extra = {}) {
  const created_at = BASE + index;
  const id = h.api.firebasePushIdBoundary(created_at, '-');
  return {
    id, user_uid: 'employee-synthetic', uid: 'employee-synthetic',
    nombre_usuario: 'José Díaz', correo_usuario: 'jose.diaz@example.test',
    rol: 'GESTOR', plaza: 'CHIHUAHUA', tipo: type,
    gestion_realizada: type === 'COBRANZA' ? 'PROMESA DE PAGO' : 'LLAMADA',
    ...(type === 'PROSPECCION' ? { nombre_prospecto: `Prospecto ${index}`, tipo_accion: 'LLAMADA TELEFONICA' } : {}),
    created_at, comentarios: `Texto canónico íntegro ${index}`,
    campo_solo_canonico: `Detalle ${index}`, ...extra,
  };
}
// Índices ligeros sin comentarios, montos, ubicación ni datos exclusivos del canónico.
function indexRecord(value) {
  const keys = [
    'id', 'uid', 'user_uid', 'nombre_usuario', 'correo_usuario', 'rol', 'plaza', 'tipo',
    'created_at', 'timestamp', 'actualizado_en', 'gestion_realizada', 'tipo_accion',
    'nombre_prospecto', 'expediente_prospeccion_id', 'prospecto_raiz_id',
    'seguimiento_de', 'es_expediente_prospeccion', 'estado_expediente',
    'tiene_evidencia', 'se_agenda_cita',
  ];
  return Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, value[key]]));
}
function install(h, rows, source = 'gestor_activities') {
  const canonical = Object.fromEntries(rows.map(row => [row.id, row]));
  put(h.store, 'gestor_activities', canonical);
  if (source !== 'gestor_activities') put(h.store, source, Object.fromEntries(rows.map(row => [row.id, indexRecord(row)])));
  return canonical;
}
function criteria(h, type = 'GENERAL') {
  return { ...h.api.currentActivityFilterCriteria(), type };
}
function parseCsv(text) {
  text = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], value = '', quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (!quoted && char === ',') { row.push(value); value = ''; }
    else if (!quoted && char === '\n') { row.push(value); rows.push(row); row = []; value = ''; }
    else value += char;
  }
  assert.equal(quoted, false, 'CSV no debe terminar con comillas abiertas');
  row.push(value); rows.push(row);
  assert.ok(rows.every(item => item.length === rows[0].length), 'Todas las filas conservan todas las columnas');
  return { header: rows[0], rows: rows.slice(1), cell: (rowIndex, label) => rows[rowIndex + 1][rows[0].indexOf(label)] };
}
async function csvDownload(h, type, count) {
  assert.equal(h.alerts.length, 0, `Exportación completa sin alertas: ${h.alerts.join(' | ')}`);
  assert.equal(h.downloads.length, 1, 'Exactamente un archivo completo');
  const download = h.downloads[0];
  assert.equal(download.filename, `actividades_${type.toLowerCase()}_${DAY}_a_${DAY}.csv`);
  assert.equal(download.blob.type, 'text/csv;charset=utf-8;');
  const bytes = Buffer.from(await download.blob.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 3)], [0xEF, 0xBB, 0xBF], 'CSV UTF-8 con BOM');
  const parsed = parseCsv(await download.blob.text());
  assert.equal(parsed.rows.length, count, 'CSV contiene todas las coincidencias del rango');
  assert.equal(download.anchor.removed, true, 'El enlace temporal se limpia');
  assert.equal(h.api.busy(), false);
  for (const exportType of TYPES) {
    assert.equal(h.node(`activityExport${exportType}`).disabled, false);
    assert.equal(h.node(`activityExport${exportType}`).getAttribute('aria-busy'), 'false');
  }
  assert.match(h.node('activityExportStatus').textContent, new RegExp(`Exportación completa: ${count} registro`));
  assert.equal(h.timers.length, 1, 'Sólo temporizador de limpieza URL, no polling');
  h.timers[0]();
  assert.deepEqual(h.revokedUrls, h.createdUrls);
  assert.deepEqual(h.forbidden, []);
  return parsed;
}
function assertNoDownload(h, alertPattern) {
  assert.equal(h.downloads.length, 0, 'No debe descargarse CSV vacío, cancelado ni parcial');
  assert.equal(h.createdUrls.length, 0, 'Tampoco se construye Blob URL antes de completar');
  if (alertPattern) assert.ok(h.alerts.some(message => alertPattern.test(message)), `Alerta esperada ${alertPattern}: ${h.alerts.join(' | ')}`);
  assert.equal(h.api.busy(), false, 'Se libera exclusión tras error/cancelación');
  for (const type of TYPES) assert.equal(h.node(`activityExport${type}`).disabled, false);
  assert.deepEqual(h.forbidden, []);
}
function blockReads(predicate) {
  const entered = deferred(), release = deferred();
  return {
    entered: entered.promise, release: release.resolve,
    beforeRead: async request => {
      if (predicate(request)) { entered.resolve(); await release.promise; }
    },
  };
}
const routeOf = request => typeof request === 'string' ? request : request.route;

test('frontdoor HTML: los tres onclick reales invocan window.exportActivitiesCsv y las funciones se extraen sin lista visible', async () => {
  const h = harness();
  for (const type of TYPES) {
    const button = h.node(`activityExport${type}`);
    assert.equal(button.tagName, 'BUTTON');
    assert.equal(button.getAttribute('onclick'), `window.exportActivitiesCsv('${type}')`);
  }
  assert.equal(h.node('activityExportStatus').getAttribute('role'), 'status');
  assert.equal(h.node('activityExportStatus').getAttribute('aria-live'), 'polite');
  for (const name of ['_activitiesFiltered', '_activitiesData', '_activitiesVisibleCount']) {
    assert.equal(vm.runInContext(`typeof ${name}`, h.context), 'undefined');
  }
  assert.equal(vm.runInContext('_activityPageSession', h.context), null, 'Export nunca utiliza sesión de tabla ni caché visible');
  install(h, [record(h, 0)]);
  await h.node('activityExportGENERAL').click();
  await csvDownload(h, 'GENERAL', 1);
});

test('helpers reales: busy/aria-busy, progreso y clave de contexto capturan auth/perfil/todos los filtros', () => {
  const h = harness();
  h.api.setActivityExportBusy(true);
  for (const type of TYPES) {
    assert.equal(h.node(`activityExport${type}`).disabled, true);
    assert.equal(h.node(`activityExport${type}`).getAttribute('aria-busy'), 'true');
  }
  h.api.setActivityExportProgress('Texto de progreso exacto');
  assert.equal(h.node('activityExportStatus').textContent, 'Texto de progreso exacto');
  const initial = h.api.activityExportContextKey();
  for (const [id, value] of [['activityType', 'GENERAL'], ['activityRole', 'GESTOR'], ['activityPlaza', 'CHIHUAHUA'], ['activityUser', 'José'], ['activityStartDate', '2026-11-05'], ['activityEndDate', '2026-11-07']]) {
    const old = h.node(id).value;
    h.node(id).value = value;
    assert.notEqual(h.api.activityExportContextKey(), initial, id);
    h.node(id).value = old;
  }
  h.api.setActions(['GENERAL|LLAMADA', 'COBRANZA|PROMESA DE PAGO']);
  const actions = h.api.activityExportContextKey();
  assert.notEqual(actions, initial);
  h.api.setActions(['COBRANZA|PROMESA DE PAGO', 'GENERAL|LLAMADA']);
  assert.equal(h.api.activityExportContextKey(), actions, 'Orden de selección no cambia criterios');
  h.api.setActions([]);
  h.auth.currentUser.uid = 'other'; assert.notEqual(h.api.activityExportContextKey(), initial);
  h.auth.currentUser.uid = 'session-synthetic';
  h.auth.currentUser.email = 'other@example.test'; assert.notEqual(h.api.activityExportContextKey(), initial);
  h.auth.currentUser.email = 'admin@example.test';
  h.api.profile().plaza = 'TAMPICO'; assert.notEqual(h.api.activityExportContextKey(), initial);
  h.api.setActivityExportBusy(false);
});

for (const type of TYPES) for (const count of [51, 1007]) for (const indexed of [false, true]) {
  test(`${type}: ${count} coincidencias, fuente ${indexed ? 'indexada' : 'directText'} supera 50/1000 sin recorte ni IDs alterados`, async () => {
    const h = harness();
    const source = indexed ? 'activity_summaries/plazas/CHIHUAHUA' : 'gestor_activities';
    if (indexed) h.node('activityPlaza').value = 'CHIHUAHUA';
    const rows = Array.from({ length: count }, (_, index) => record(h, index, type));
    install(h, rows, source);
    await h.node(`activityExport${type}`).click();
    const csv = await csvDownload(h, type, count);
    assert.deepEqual(csv.rows.map(row => row[csv.header.indexOf('ID de actividad')]).sort(), rows.map(row => row.id).sort());
    assert.equal(new Set(csv.rows.map(row => row[0])).size, count, 'Sin duplicar frontera inclusiva');
    assert.ok(csv.rows.every(row => row[csv.header.indexOf('campo_solo_canonico')].startsWith('Detalle ')), 'No se exporta sólo resumen');
    assert.ok(h.queryReads.length > 1);
    assert.ok(h.queryReads.every(read => read.route === source && read.count <= 51));
    assert.equal(new Set(h.queryReads.flatMap(read => read.keys)).size, count, 'Se escanea todo el rango');
    assert.equal(h.canonicalReads.length, indexed ? count : 0, 'get canónico individual exclusivamente para índices; directText reutiliza lo descargado');
    assert.equal(new Set(h.canonicalReads.map(read => read.route)).size, indexed ? count : 0);
    assert.ok(h.maxCanonical() <= 8, 'Máximo ocho lecturas canónicas concurrentes');
    assert.ok(h.usage.some(entry => entry.name === 'PANEL_ACTIVITY_EXPORT_RANGE'));
    assert.equal(h.usage.filter(entry => entry.name === 'PANEL_ACTIVITY_EXPORT_TEXT').length, indexed ? count : 0);
  });
}

for (const count of [50, 51, 52, 101]) {
  test(`loadActivityTextPage real: frontera ${count}, 50+1 inclusivo y ensureActive opcional`, async () => {
    const h = harness();
    const rows = Array.from({ length: count }, (_, index) => record(h, index));
    install(h, rows);
    const selected = criteria(h);
    const session = { start: selected.start, end: selected.end, sourcePath: 'gestor_activities', cursorKey: h.api.firebasePushIdBoundary(selected.end, 'z'), seen: new Set(), pendingMatches: [] };
    const result = [];
    const sizes = [];
    do {
      const next = await h.api.loadActivityTextPage(session, h.api.activityPreview, selected);
      result.push(...next.page); sizes.push(next.page.length);
    } while (session.hasMore);
    assert.equal(sizes[0], 50);
    assert.equal(result.length, count);
    assert.deepEqual(result.map(item => item.id).sort(), rows.map(item => item.id).sort());
    assert.equal(new Set(result.map(item => item.id)).size, count);
    if (count > 50) assert.ok(sizes.length > 1);
    assert.ok(h.queryReads.every(read => read.constraints.at(-1).count === 51));
    for (let index = 1; index < h.queryReads.length; index += 1) {
      const previous = h.queryReads[index - 1];
      const current = h.queryReads[index];
      assert.equal(current.constraints.find(item => item.type === 'end').value, previous.keys[0]);
      assert.ok(current.keys.includes(previous.keys[0]), 'Frontera compartida leída y deduplicada');
    }
  });
}

for (const matches of [0, 1]) test(`paginación compatibility ${matches} match(es)/2207: máximo2 queries por acción, cursor sin reinicio y rango completo al continuar`, async () => {
  const h = harness();
  const rows = Array.from({ length: 2207 }, (_, index) => record(h, index));
  if (matches) rows[0].rol = 'OBJETIVO';
  install(h, rows); h.node('activityRole').value = 'OBJETIVO';
  const selected = criteria(h);
  const session = { start: selected.start, end: selected.end, sourcePath: 'gestor_activities', cursorKey: h.api.firebasePushIdBoundary(selected.end, 'z'), seen: new Set(), pendingMatches: [] };
  const results = [];
  let actions = 0;
  do {
    const before = h.queryReads.length, previousCursor = session.cursorKey;
    const next = await h.api.loadActivityTextPage(session, h.api.activityPreview, selected);
    assert.ok(h.queryReads.length - before <= 2);
    assert.ok(next.scannedBatches <= 2);
    if (actions === 0) {
      assert.equal(next.page.length, 0); assert.equal(session.hasMore, true);
      assert.equal(session.partial, true);
      assert.match(session.statusText, /Verificación pendiente.*sin coincidencias en la parte revisada/);
      assert.equal(session.scanned, 101, 'Dos queries51 con frontera inclusiva deduplicada');
    }
    assert.notEqual(session.cursorKey, previousCursor);
    results.push(...next.page);
    assert.ok(++actions <= 23);
  } while (session.hasMore);
  assert.deepEqual(results.map(row => row.id), matches ? [rows[0].id] : []);
  assert.equal(session.seen.size, rows.length); assert.equal(session.partial, false);
  assert.equal(session.statusText, ''); assert.deepEqual(h.forbidden, []);
});

for (const type of TYPES) {
  test(`${type}: filtro selectivo recorre 1307 entradas con muchas no coincidencias; rol/plaza/userSearch/actions/rango, hidrata sólo siete`, async () => {
    const h = harness();
    const source = 'activity_summaries/plazas/CHIHUAHUA';
    h.node('activityRole').value = ' gestor ';
    h.node('activityPlaza').value = ' chihuáhua ';
    h.node('activityUser').value = 'jose diaz, correo.seleccionado';
    const action = type === 'GENERAL' ? 'LLAMADA' : type === 'COBRANZA' ? 'PROMESA DE PAGO' : 'LLAMADA TELEFONICA';
    h.api.setActions([`${type}|${action}`]);
    put(h.store, 'users', { first: { nombre_completo: 'José Díaz' }, second: { nombre_completo: 'José Díaz' } });
    const expected = [];
    const rows = Array.from({ length: 1307 }, (_, index) => {
      const selected = index % 211 === 0;
      const base = record(h, index, type, { gestion_realizada: action });
      if (selected) { expected.push(base.id); return base; }
      const gate = index % 6;
      if (gate === 0) base.rol = 'CANJES';
      if (gate === 1) base.plaza = 'TAMPICO';
      if (gate === 2) { base.nombre_usuario = 'Otra persona'; base.correo_usuario = 'otra@example.test'; }
      if (gate === 3) { base.gestion_realizada = 'OTRA ACCION'; base.tipo_accion = 'OTRA ACCION'; }
      if (gate === 4) { base.tipo = type === 'GENERAL' ? 'COBRANZA' : 'GENERAL'; delete base.nombre_prospecto; }
      if (gate === 5) {
        base.created_at = new Date('2026-11-07T10:00:00').getTime();
        if (type === 'PROSPECCION') base.actualizado_en = base.created_at;
      }
      return base;
    });
    // Fuera del rango por clave: la consulta debe excluirlo antes de filtrar.
    rows.push(record(h, 2000, type, { id: h.api.firebasePushIdBoundary(new Date('2026-11-05T10:00:00').getTime(), '-'), created_at: new Date('2026-11-05T10:00:00').getTime() }));
    install(h, rows, source);
    await h.node(`activityExport${type}`).click();
    const csv = await csvDownload(h, type, expected.length);
    assert.equal(expected.length, 7);
    assert.deepEqual(csv.rows.map(row => row[0]).sort(), expected.sort());
    assert.ok(h.queryReads.length >= 26, 'No se detiene tras la primera página sin coincidencias');
    assert.equal(new Set(h.queryReads.flatMap(read => read.keys)).size, 1307);
    assert.deepEqual(h.canonicalReads.map(read => read.route).sort(), expected.map(id => `gestor_activities/${id}`).sort());
    assert.equal(h.reads.filter(read => read === 'users').length, 0, 'No descarga perfiles completos ni métricas');
    assert.equal(h.reads.filter(read => read === 'notice_directory/by_uid').length, 1);
    assert.ok(h.queryReads.every(read => read.route === source));
  });
}

test('userSearch de un único perfil usa índice por UID, combina palabras con acentos y términos OR separados por coma', async () => {
  const h = harness();
  h.node('activityUser').value = 'nadie existente, jose diaz';
  h.node('activityPlaza').value = 'CHIHUAHUA';
  h.node('activityRole').value = 'GESTOR';
  h.api.setActions(['GENERAL|LLAMADA']);
  put(h.store, 'users', { 'employee-synthetic': { nombre_completo: 'José Díaz', correo: 'jose.diaz@example.test' }, other: { nombre_completo: 'Otra persona' } });
  const good = record(h, 0);
  const bad = record(h, 1, 'GENERAL', { nombre_usuario: 'José otra persona', correo_usuario: 'otro@example.test' });
  install(h, [good, bad], 'activity_summaries/users/employee-synthetic');
  await h.node('activityExportGENERAL').click();
  const csv = await csvDownload(h, 'GENERAL', 1);
  assert.equal(csv.cell(0, 'ID de actividad'), good.id);
  assert.ok(h.queryReads.every(read => read.route === 'activity_summaries/users/employee-synthetic'));
  assert.deepEqual(h.canonicalReads.map(read => read.route), [`gestor_activities/${good.id}`]);
});

for (const type of TYPES) {
  test(`${type}: sin coincidencias en 1203 entradas no hidrata ningún registro ni consulta medios`, async () => {
    const h = harness();
    h.node('activityPlaza').value = 'CHIHUAHUA';
    h.node('activityRole').value = 'LIDER A';
    install(h, Array.from({ length: 1203 }, (_, index) => record(h, index, type)), 'activity_summaries/plazas/CHIHUAHUA');
    await h.node(`activityExport${type}`).click();
    assertNoDownload(h, /No hay registros/);
    assert.equal(h.canonicalReads.length, 0);
    assert.ok(h.queryReads.length >= 24);
    assert.equal(new Set(h.queryReads.flatMap(read => read.keys)).size, 1203);
    assert.match(h.node('activityExportStatus').textContent, /No hay registros/);
    assert.deepEqual(h.profileReads.map(read => read.route).sort(), ['users/session-synthetic/plaza', 'users/session-synthetic/rol']);
    assert.ok(h.queryReads.every(read => read.route === 'activity_summaries/plazas/CHIHUAHUA'));
  });
}

test('GERENTE: sólo su plaza normalizada; coberturas históricas y UID propio no abren otra sucursal', async () => {
  const h = harness({ role: 'GERENTE', plaza: ' chihuáhua ' });
  const good = record(h, 0);
  const foreign = record(h, 1, 'GENERAL', { plaza: 'TAMPICO', user_uid: 'session-synthetic' });
  install(h, [good, foreign], 'activity_summaries/plazas/CHIHUAHUA');
  h.node('activityUser').value = 'jose diaz';
  await h.node('activityExportGENERAL').click();
  const csv = await csvDownload(h, 'GENERAL', 1);
  assert.equal(csv.cell(0, 'ID de actividad'), good.id);
  assert.ok(h.queryReads.every(read => read.route === 'activity_summaries/plazas/CHIHUAHUA'));
  assert.deepEqual(h.canonicalReads.map(read => read.route), [`gestor_activities/${good.id}`]);
  assert.equal(h.reads.filter(read => read === 'users').length, 0, 'Gerente no consulta directorio general');
  const blocked = harness({ role: 'GERENTE', plaza: 'CHIHUAHUA' });
  blocked.node('activityPlaza').value = 'TAMPICO';
  await blocked.node('activityExportGENERAL').click();
  assertNoDownload(blocked, /alcance del gerente/);
  assert.equal(blocked.reads.length, 2, 'Sólo valida rol/plaza actuales del usuario autenticado');
  assert.equal(blocked.queryReads.length, 0);
  assert.equal(blocked.canonicalReads.length, 0);
});

for (const plaza of ['TAMPICO', 'MADERO']) {
  test(`excepción Tampico–Madero: únicamente correo autorizado permite exportar ${plaza}`, async () => {
    const h = harness({ role: 'GERENTE', plaza: 'TAMPICO', email: 'gerente.tampico@fredinero.com' });
    h.node('activityPlaza').value = plaza;
    const good = record(h, 0, 'GENERAL', { plaza });
    const other = record(h, 1, 'GENERAL', { plaza: 'CHIHUAHUA' });
    install(h, [good, other], `activity_summaries/plazas/${plaza}`);
    await h.node('activityExportGENERAL').click();
    const csv = await csvDownload(h, 'GENERAL', 1);
    assert.equal(csv.cell(0, 'Plaza'), plaza);
    assert.deepEqual(h.canonicalReads.map(read => read.route), [`gestor_activities/${good.id}`]);
    const unauthorized = harness({ role: 'GERENTE', plaza: plaza === 'MADERO' ? 'TAMPICO' : 'CHIHUAHUA', email: 'otra.gerencia@example.test' });
    unauthorized.node('activityPlaza').value = plaza;
    await unauthorized.node('activityExportGENERAL').click();
    assertNoDownload(unauthorized, /alcance/);
    assert.equal(unauthorized.reads.length, 2, 'Sólo lecturas escalares del perfil autenticado');
    assert.equal(unauthorized.queryReads.length, 0);
    assert.equal(unauthorized.canonicalReads.length, 0);
  });
}

test('Soporte mantiene alcance global aun con perfil GERENTE; usa plaza seleccionada sin heredar restricciones del gerente', async () => {
  const h = harness({ role: 'GERENTE', plaza: 'TAMPICO', email: 'soporte@fredinero.com' });
  h.node('activityPlaza').value = 'CHIHUAHUA';
  install(h, [record(h, 0)], 'activity_summaries/plazas/CHIHUAHUA');
  await h.node('activityExportGENERAL').click();
  await csvDownload(h, 'GENERAL', 1);
});

for (const indexed of [false, true]) {
  test(`PROSPECCION consolidada raíz+hijo: path canónico raíz correcto, historia/campos hijo íntegros y ${indexed ? 'dos lecturas individuales' : 'directText sin relectura'}`, async () => {
    const h = harness();
    const source = indexed ? 'activity_summaries/plazas/CHIHUAHUA' : 'gestor_activities';
    if (indexed) h.node('activityPlaza').value = 'CHIHUAHUA';
    const root = record(h, 0, 'PROSPECCION', { es_expediente_prospeccion: true, estado_expediente: 'PENDIENTE_ONBOARDING', actualizado_en: BASE + 100, campo_solo_raiz: 'CANONICO RAIZ', observaciones: 'Observación antigua', historial_expediente: { inicio: { fecha: BASE, texto: 'Historial raíz completo' }, compartida: { fecha: BASE, texto: 'Antigua' } } });
    const child = record(h, 10, 'PROSPECCION', { expediente_prospeccion_id: root.id, prospecto_raiz_id: root.id, seguimiento_de: root.id, actualizado_en: BASE + 200, campo_solo_canonico: 'CANONICO HIJO CONSERVADO', campo_solo_hijo: 'Seguimiento íntegro', observaciones: 'Observación más reciente del hijo', historial_expediente: { seguimiento: { fecha: BASE + 200 }, compartida: { fecha: BASE + 200, texto: 'Última gana' } } });
    install(h, [root, child], source);
    await h.node('activityExportPROSPECCION').click();
    const csv = await csvDownload(h, 'PROSPECCION', 1);
    assert.equal(csv.cell(0, 'ID de actividad'), root.id);
    assert.equal(csv.cell(0, 'ID de prospecto raíz'), root.id);
    assert.equal(csv.cell(0, '_activity_path'), `gestor_activities/${root.id}`);
    assert.equal(csv.cell(0, 'campo_solo_raiz'), 'CANONICO RAIZ');
    assert.equal(csv.cell(0, 'campo_solo_canonico'), 'CANONICO HIJO CONSERVADO');
    assert.equal(csv.cell(0, 'campo_solo_hijo'), 'Seguimiento íntegro');
    assert.equal(csv.cell(0, 'Observaciones'), 'Observación más reciente del hijo');
    assert.equal(csv.cell(0, '_expediente_registros_consolidados'), '2');
    assert.equal(csv.cell(0, '_expediente_ultimo_movimiento'), String(BASE + 200));
    assert.match(csv.cell(0, 'historial_expediente'), /Historial raíz completo/);
    const history = JSON.parse(csv.cell(0, 'historial_expediente'));
    assert.deepEqual(Object.keys(history).sort(), ['compartida', 'inicio', 'seguimiento']);
    assert.equal(history.compartida.texto, 'Última gana');
    assert.deepEqual(h.canonicalReads.map(read => read.route).sort(), indexed ? [root, child].map(row => `gestor_activities/${row.id}`).sort() : []);
  });
}

for (const failure of ['missing', 'rejected']) {
  test(`índice: ${failure} en noveno canónico no descarga CSV parcial después de preparar ocho`, async () => {
    let badPath;
    const h = harness({ beforeRead: request => {
      if (failure === 'rejected' && routeOf(request) === badPath) throw new Error('Fallo de lectura sintético');
    } });
    h.node('activityPlaza').value = 'CHIHUAHUA';
    const rows = Array.from({ length: 9 }, (_, index) => record(h, index));
    const canonical = install(h, rows, 'activity_summaries/plazas/CHIHUAHUA');
    badPath = `gestor_activities/${rows[0].id}`;
    if (failure === 'missing') delete canonical[rows[0].id];
    await h.node('activityExportGENERAL').click();
    assertNoDownload(h, failure === 'missing' ? /registro ya no está disponible.*no se descargó un archivo parcial/ : /Fallo de lectura sintético/);
    assert.equal(h.canonicalReads.length, 9);
    assert.equal(h.usage.filter(entry => entry.name === 'PANEL_ACTIVITY_EXPORT_TEXT').reduce((sum, entry) => sum + entry.data.records, 0), 8);
    assert.match(h.node('activityExportStatus').textContent, /No se descargó un archivo parcial/);
  });
}

for (const changed of ['role', 'plaza', 'user', 'action', 'date', 'type']) {
  test(`canónico cambió ${changed} respecto al índice: bloquea archivo completo, no filtra silenciosamente`, async () => {
    const h = harness();
    h.node('activityRole').value = 'GESTOR'; h.node('activityPlaza').value = 'CHIHUAHUA';
    h.node('activityUser').value = 'jose diaz'; h.api.setActions(['GENERAL|LLAMADA']);
    const row = record(h, 0);
    const canonical = install(h, [row], 'activity_summaries/plazas/CHIHUAHUA');
    // Directorio vacío fuerza índice de plaza; resumen original no cambia.
    if (changed === 'role') canonical[row.id].rol = 'CANJES';
    if (changed === 'plaza') canonical[row.id].plaza = 'TAMPICO';
    if (changed === 'user') { canonical[row.id].nombre_usuario = 'Otra persona'; canonical[row.id].correo_usuario = 'otro@example.test'; }
    if (changed === 'action') canonical[row.id].gestion_realizada = 'OTRA ACCION';
    if (changed === 'date') canonical[row.id].created_at = new Date('2026-11-07T10:00:00').getTime();
    if (changed === 'type') canonical[row.id].tipo = 'COBRANZA';
    await h.node('activityExportGENERAL').click();
    assertNoDownload(h, /registro cambió.*no se descargó un archivo parcial/);
    assert.equal(h.canonicalReads.length, 1);
  });
}

test('doble clic y otro tipo durante await quedan bloqueados; busy se restaura y después permite una nueva exportación', async () => {
  const block = blockReads(request => !!request.constraints);
  const h = harness({ beforeRead: block.beforeRead });
  install(h, [record(h, 0), record(h, 1, 'COBRANZA')]);
  const first = h.node('activityExportGENERAL').click();
  await block.entered;
  assert.equal(h.api.busy(), true);
  for (const type of TYPES) {
    assert.equal(h.node(`activityExport${type}`).disabled, true);
    assert.equal(h.node(`activityExport${type}`).getAttribute('aria-busy'), 'true');
  }
  await h.window.exportActivitiesCsv('GENERAL');
  await h.window.exportActivitiesCsv('COBRANZA');
  assert.equal(h.queryReads.length, 1);
  block.release(); await first;
  await csvDownload(h, 'GENERAL', 1);
  await h.window.exportActivitiesCsv('COBRANZA');
  assert.equal(h.downloads.length, 2, 'Exclusión no queda trabada');
  assert.equal(parseCsv(await h.downloads[1].blob.text()).rows.length, 1);
});

const MUTATIONS = [
  ['inicio', h => { h.node('activityStartDate').value = '2026-11-05'; }],
  ['fin', h => { h.node('activityEndDate').value = '2026-11-07'; }],
  ['tipo', h => { h.node('activityType').value = 'COBRANZA'; }],
  ['rol', h => { h.node('activityRole').value = 'CANJES'; }],
  ['plaza', h => { h.node('activityPlaza').value = 'TAMPICO'; }],
  ['userSearch', h => { h.node('activityUser').value = 'Otra persona'; }],
  ['actions', h => { h.api.setActions(['GENERAL|OTRA ACCION']); }],
  ['auth.uid', h => { h.auth.currentUser.uid = 'other-user'; }],
  ['auth.email', h => { h.auth.currentUser.email = 'other@example.test'; }],
  ['logout', h => { h.auth.currentUser = null; }],
  ['perfil/plaza', h => { h.api.profile().plaza = 'TAMPICO'; }],
  ['perfil/rol', h => { h.api.profile().rol = 'GERENTE'; }],
  ['perfil ausente', h => { h.api.replaceProfile(null); }],
];
for (const [label, mutate] of MUTATIONS) {
  test(`cancelación durante await de primera query: cambio ${label} impide la siguiente query, hidratación y descarga`, async () => {
    const block = blockReads(request => !!request.constraints);
    const h = harness({ beforeRead: block.beforeRead });
    h.node('activityPlaza').value = 'CHIHUAHUA';
    h.node('activityRole').value = 'LIDER A';
    install(h, Array.from({ length: 107 }, (_, index) => record(h, index)), 'activity_summaries/plazas/CHIHUAHUA');
    const exporting = h.node('activityExportGENERAL').click();
    await block.entered;
    mutate(h); block.release(); await exporting;
    assertNoDownload(h, /sesión o los filtros cambiaron.*cancelada/i);
    assert.equal(h.queryReads.length, 1, 'ensureActive real de loadActivityTextPage cancela dentro del barrido selectivo');
    assert.equal(h.canonicalReads.length, 0);
    assert.ok(h.usage.every(entry => entry.name === 'PANEL_ACTIVITY_LIGHT_METADATA'), 'No se considera exportación válida; sólo metadatos previos');
  });
}

test('cancelación durante await del directorio de usuarios: no llega a consultar índice ni canónicos', async () => {
  const block = blockReads(request => request === 'notice_directory/by_uid');
  const h = harness({ beforeRead: block.beforeRead });
  h.node('activityUser').value = 'jose diaz';
  put(h.store, 'users', { person: { nombre_completo: 'José Díaz' } });
  const exporting = h.node('activityExportGENERAL').click();
  await block.entered;
  h.auth.currentUser = null;
  block.release(); await exporting;
  assertNoDownload(h, /cancelada/);
  assert.deepEqual(h.reads, ['users/session-synthetic/rol', 'users/session-synthetic/plaza', 'notice_directory/by_uid']);
});

for (const label of ['filtro', 'auth']) {
  test(`cancelación durante await de lote canónico por ${label}: como máximo ocho en curso, ningún lote siguiente ni CSV`, async () => {
    const block = blockReads(request => typeof request === 'string' && request.startsWith('gestor_activities/'));
    const h = harness({ beforeRead: block.beforeRead });
    h.node('activityPlaza').value = 'CHIHUAHUA';
    install(h, Array.from({ length: 17 }, (_, index) => record(h, index)), 'activity_summaries/plazas/CHIHUAHUA');
    const exporting = h.node('activityExportGENERAL').click();
    await block.entered;
    assert.equal(h.canonicalReads.length, 8);
    if (label === 'filtro') h.api.setActions(['GENERAL|OTRA ACCION']);
    else h.auth.currentUser.uid = 'other-user';
    block.release(); await exporting;
    assertNoDownload(h, /cancelada/);
    assert.equal(h.canonicalReads.length, 8);
    assert.equal(h.maxCanonical(), 8);
  });
}

const INVALID_CASES = [
  ['inicio vacío', h => { h.node('activityStartDate').value = ''; }, 'GENERAL', /rango válido/],
  ['fin vacío', h => { h.node('activityEndDate').value = ''; }, 'GENERAL', /rango válido/],
  ['inicio NaN', h => { h.node('activityStartDate').value = 'not-a-date'; }, 'GENERAL', /rango válido/],
  ['fin NaN', h => { h.node('activityEndDate').value = 'not-a-date'; }, 'GENERAL', /rango válido/],
  ['rango invertido', h => { h.node('activityStartDate').value = '2026-11-07'; }, 'GENERAL', /rango válido/],
  ['tipo inválido', () => {}, 'TODAS', /tipo válido/],
  ['tipo vacío', () => {}, '', /tipo válido/],
  ['tipo contradictorio', h => { h.node('activityType').value = 'COBRANZA'; }, 'GENERAL', /filtro Tipo no incluye General/],
  ['sin auth', h => { h.auth.currentUser = null; }, 'GENERAL', /Inicia sesión/],
  ['sin UID', h => { h.auth.currentUser.uid = ''; }, 'GENERAL', /Inicia sesión/],
  ['sin perfil', h => { h.api.replaceProfile(null); }, 'GENERAL', /Inicia sesión/],
  ['perfil vacío', h => { h.api.replaceProfile({}); }, 'GENERAL', /Inicia sesión/],
];
for (const [label, prepare, type, pattern] of INVALID_CASES) {
  test(`entrada inválida: ${label}, no hay consultas ni archivo`, async () => {
    const h = harness(); prepare(h);
    await h.window.exportActivitiesCsv(type);
    assertNoDownload(h, pattern);
    assert.equal(h.reads.length, 0);
  });
}

test('rango válido vacío: una query acotada, ningún CSV ni canónico', async () => {
  const h = harness();
  await h.node('activityExportGENERAL').click();
  assertNoDownload(h, /No hay registros de General en todo el rango/);
  assert.equal(h.queryReads.length, 1);
  assert.equal(h.queryReads[0].count, 0);
  assert.equal(h.canonicalReads.length, 0);
});

const COMMON_HEADERS = [
  'ID de actividad', 'UID', 'UID de usuario', 'Nombre de usuario', 'Correo de usuario', 'Rol', 'Plaza',
  'Tipo de actividad', 'Fecha y hora de registro', 'Marca de tiempo de creación', 'Marca de tiempo',
  'Latitud', 'Longitud', 'Tiene evidencia', 'Ruta de evidencia', 'Editable',
];
const SPECIFIC_HEADERS = {
  GENERAL: ['Se atiende a', 'Número de distribuidora', 'Nombre', 'Gestión realizada', 'Comentarios o motivos', 'Motivo', 'Tiene evidencia'],
  COBRANZA: ['Se atiende a', 'Número de cliente', 'Nombre', 'Gestión realizada', 'Comentarios', 'Monto depositado', 'Folio de recibo o comprobante', 'Fecha de promesa', 'Hora de promesa'],
  PROSPECCION: ['Nombre completo del prospecto', 'Dirección', 'Teléfono', 'Referido interno', 'Tipo de Prospección', 'Origen de prospección', 'Otro origen de prospección', 'Tipo de acción', 'Se agenda cita', 'Fecha de cita', 'Hora de cita', 'Marca de tiempo de cita', 'Estado de cita', 'Responsable de cita', 'Gerente de cita', 'Motivos de no cita', 'Observaciones', 'Etapa del expediente', 'Tipo de cierre', 'Motivo de cierre', 'Cierre registrado por', 'Marca de tiempo del cierre', 'Hilo de prospecto', 'ID de prospecto raíz', 'Seguimiento de', 'Número de seguimiento', 'Es seguimiento', 'Cambió de opinión'],
};
for (const type of TYPES) {
  test(`${type}: CSV conserva columnas completas, extras ordenados, comas/comillas/saltos/acentos, fórmula segura e IDs/números exactos`, async () => {
    const h = harness();
    h.node('activityPlaza').value = 'CHIHUAHUA';
    const rich = record(h, 0, type, {
      nombre_contacto: 'José, "El Güero"\nChihuahua',
      ...(type === 'PROSPECCION' ? { nombre_prospecto: 'María, "López"\nPeña' } : {}),
      comentarios: '=HYPERLINK("https://example.invalid","clic")', observaciones: '\t@SUM(1,2)',
      monto: -125.75, latitud: -28.635, longitud: -106.088, numero_cliente: '000042',
      telefono: '+526140000000', editable: false, tiene_evidencia: true,
      lista_extra: ['uno', 'dos'], objeto_extra: { texto: 'acción,\n"sí"' },
      zz_extra: 'Última columna', aa_extra: '+SUM(1,2)',
    });
    const empty = record(h, 1, type, { tiene_evidencia: false });
    delete empty.campo_solo_canonico;
    install(h, [rich, empty], 'activity_summaries/plazas/CHIHUAHUA');
    await h.node(`activityExport${type}`).click();
    const csv = await csvDownload(h, type, 2);
    const fixed = [...COMMON_HEADERS, ...SPECIFIC_HEADERS[type]];
    assert.deepEqual(csv.header.slice(0, fixed.length), fixed, 'No reduce el reporte a campos del preview');
    const extras = csv.header.slice(fixed.length);
    assert.deepEqual(extras, [...extras].sort());
    assert.ok(extras.includes('campo_solo_canonico'));
    const richIndex = csv.rows.findIndex(row => row[0] === rich.id);
    const emptyIndex = csv.rows.findIndex(row => row[0] === empty.id);
    assert.ok(richIndex >= 0 && emptyIndex >= 0, 'Firebase IDs exactos, sin apóstrofo');
    assert.equal(csv.cell(richIndex, 'Latitud'), '-28.635');
    assert.equal(csv.cell(richIndex, 'Longitud'), '-106.088');
    assert.equal(csv.cell(emptyIndex, 'Latitud'), '', 'Faltante no se fuerza a 0/undefined/null');
    assert.equal(csv.cell(emptyIndex, 'Longitud'), '');
    const amountColumn = type === 'COBRANZA' ? 'Monto depositado' : 'monto';
    assert.equal(csv.cell(richIndex, amountColumn), '-125.75');
    assert.equal(csv.cell(emptyIndex, amountColumn), '');
    assert.equal(csv.cell(richIndex, 'aa_extra'), "'+SUM(1,2)");
    const commentColumn = type === 'GENERAL' ? 'Comentarios o motivos' : type === 'COBRANZA' ? 'Comentarios' : 'comentarios';
    assert.equal(csv.cell(richIndex, commentColumn), `'${rich.comentarios}`);
    const observationColumn = type === 'PROSPECCION' ? 'Observaciones' : 'observaciones';
    assert.equal(csv.cell(richIndex, observationColumn), "'\t@SUM(1,2)");
    assert.equal(csv.cell(richIndex, type === 'PROSPECCION' ? 'Nombre completo del prospecto' : 'Nombre'), type === 'PROSPECCION' ? rich.nombre_prospecto : rich.nombre_contacto);
    assert.equal(csv.cell(richIndex, 'Editable'), 'No');
    assert.equal(csv.cell(richIndex, 'Tiene evidencia'), 'Sí');
    assert.equal(csv.cell(richIndex, 'Ruta de evidencia'), `gestor_photos/${rich.id}/foto_base64`);
    assert.equal(csv.cell(emptyIndex, 'Ruta de evidencia'), '');
    assert.equal(csv.cell(richIndex, 'lista_extra'), 'uno | dos');
    assert.deepEqual(JSON.parse(csv.cell(richIndex, 'objeto_extra')), rich.objeto_extra);
    assert.equal(csv.cell(richIndex, 'Fecha y hora de registro'), '06/11/2026 10:00');
    assert.ok(h.reads.every(read => !/gestor_photos|storage|media/.test(routeOf(read))), 'Ruta textual no implica lectura de evidencia');
  });
}

test('activityExportCsvQ real: fórmulas neutralizadas, números simples y push IDs preservados, valores ausentes vacíos', () => {
  const h = harness();
  const quote = value => `"${String(value).replace(/"/g, '""')}"`;
  for (const value of ['=1+1', '+SUM(A1)', '@SUM(A1)', '-not-a-push-id', ' \t=CMD()', '\n-ABC', '+52-614']) {
    assert.equal(h.api.activityExportCsvQ(value), quote(`'${value}`), value);
  }
  for (const value of [0, 125.5, -125.75, '-106.088', '+526140000000', '000042', h.api.firebasePushIdBoundary(BASE, '-'), 'Árbol, "sí"\nmañana']) {
    assert.equal(h.api.activityExportCsvQ(value), quote(value), String(value));
  }
  assert.equal(h.api.activityExportCsvQ(undefined), '""');
  assert.equal(h.api.activityExportCsvQ(null), '""');
});

test('activityExportTextRecord real: saneamiento recursivo sin mutar fuente, elimina base64/dataURL y medios inline imagen/audio/video', () => {
  const h = harness();
  const value = {
    texto: 'José, información íntegra', foto_base64: 'PRIVATE', firmaBase64: 'PRIVATE',
    data_url: 'PRIVATE', imagenDataURL: 'PRIVATE',
    nested: { foto: 'data:image/png;base64,PRIVATE', audio: 'data:audio/ogg;base64,PRIVATE', video: 'data:video/mp4;base64,PRIVATE', cantidad: 0, activo: false },
    lista: ['texto', { adjunto: 'DATA:IMAGE/JPEG;base64,PRIVATE' }, null],
    ruta_evidencia: 'gestor_photos/id/foto_base64',
    ...JSON.parse('{"__proto__":{"polluted":true},"constructor":"PRIVATE","prototype":"PRIVATE"}'),
  };
  const before = JSON.stringify(value);
  assert.deepEqual(plain(h.api.activityExportTextRecord(value)), {
    texto: value.texto, nested: { foto: '', audio: '', video: '', cantidad: 0, activo: false },
    lista: ['texto', { adjunto: '' }, null], ruta_evidencia: value.ruta_evidencia,
  });
  assert.equal(JSON.stringify(value), before, 'No muta registro original');
  assert.equal({}.polluted, undefined);
  assert.equal(h.reads.length, 0);
});

test('sin medios inline PDF: application/pdf;base64 debe eliminarse igual que imagen/audio/video, también anidado', () => {
  const h = harness();
  const pdf = 'data:application/pdf;base64,JVBERi0xLjQK_PRIVATE';
  assert.deepEqual(plain(h.api.activityExportTextRecord({ adjunto: pdf, nested: [{ documento: pdf }] })), {
    adjunto: '', nested: [{ documento: '' }],
  }, 'El MIME application/pdf no tiene una barra adicional después de pdf');
});

for (const indexed of [false, true]) {
  test(`exportación ${indexed ? 'indexada' : 'directa'} excluye medios inline del CSV íntegro y no lee gestor_photos`, async () => {
    const h = harness();
    if (indexed) h.node('activityPlaza').value = 'CHIHUAHUA';
    const row = record(h, 0, 'GENERAL', {
      tiene_evidencia: true, foto_base64: 'PRIVATE_IMAGE', firma_data_url: 'PRIVATE_SIGNATURE',
      adjunto: 'data:image/png;base64,PRIVATE_IMAGE',
      datos_extra: { audio: 'data:audio/ogg;base64,PRIVATE_AUDIO', video: 'data:video/mp4;base64,PRIVATE_VIDEO' },
    });
    install(h, [row], indexed ? 'activity_summaries/plazas/CHIHUAHUA' : 'gestor_activities');
    await h.node('activityExportGENERAL').click();
    const csv = await csvDownload(h, 'GENERAL', 1);
    const text = await h.downloads[0].blob.text();
    assert.doesNotMatch(text, /PRIVATE_|data:(image|audio|video)\//i);
    assert.ok(!csv.header.includes('foto_base64') && !csv.header.includes('firma_data_url'));
    assert.equal(csv.cell(0, 'adjunto'), '');
    assert.deepEqual(JSON.parse(csv.cell(0, 'datos_extra')), { audio: '', video: '' });
    assert.equal(h.canonicalReads.length, indexed ? 1 : 0);
    assert.ok(h.reads.every(read => !routeOf(read).startsWith('gestor_photos')));
  });
}

for (const indexed of [false, true]) {
  test(`clave Firebase prevalece sobre campo id legado contradictorio en ${indexed ? 'índice + canónico' : 'directText'}`, async () => {
    const h = harness();
    if (indexed) h.node('activityPlaza').value = 'CHIHUAHUA';
    const row = record(h, 0);
    const actualId = row.id;
    const wrongId = h.api.firebasePushIdBoundary(BASE + 900, '-');
    install(h, [row], indexed ? 'activity_summaries/plazas/CHIHUAHUA' : 'gestor_activities');
    h.store.gestor_activities[actualId].id = wrongId;
    if (indexed) h.store.activity_summaries.plazas.CHIHUAHUA[actualId].id = wrongId;
    await h.node('activityExportGENERAL').click();
    const csv = await csvDownload(h, 'GENERAL', 1);
    assert.equal(csv.cell(0, 'ID de actividad'), actualId);
    assert.equal(csv.cell(0, '_activity_path'), `gestor_activities/${actualId}`);
    assert.deepEqual(h.canonicalReads.map(read => read.route), indexed ? [`gestor_activities/${actualId}`] : []);
    assert.ok(!h.canonicalReads.some(read => read.route.endsWith(`/${wrongId}`)));
  });
}

for (const cachedButMissing of [false, true]) {
  test(`índice obliga get fresco sin caché de detalle: ${cachedButMissing ? 'canónico desaparecido bloquea incluso si estaba cacheado' : 'CSV refleja datos canónicos actuales'}`, async () => {
    const h = harness();
    h.node('activityPlaza').value = 'CHIHUAHUA';
    const row = record(h, 0, 'GENERAL', { comentarios: 'Canónico fresco actual' });
    const canonical = install(h, [row], 'activity_summaries/plazas/CHIHUAHUA');
    h.api.seedDetailCache(`gestor_activities/${row.id}`, { ...row, comentarios: 'NO USAR CACHE OBSOLETA', campo_solo_canonico: 'NO USAR CACHE' });
    if (cachedButMissing) delete canonical[row.id];
    await h.node('activityExportGENERAL').click();
    if (cachedButMissing) assertNoDownload(h, /registro ya no está disponible/);
    else {
      const csv = await csvDownload(h, 'GENERAL', 1);
      assert.equal(csv.cell(0, 'Comentarios o motivos'), 'Canónico fresco actual');
      assert.doesNotMatch(await h.downloads[0].blob.text(), /NO USAR CACHE/);
    }
    assert.deepEqual(h.canonicalReads.map(read => read.route), [`gestor_activities/${row.id}`]);
  });
}

for (const changed of ['rol', 'plaza', 'rol ausente', 'plaza ausente', 'perfil eliminado']) {
  test(`validación real users/authUID/{rol,plaza}: ${changed} remoto bloquea antes de fuente/rango/canónicos`, async () => {
    const h = harness();
    install(h, [record(h, 0)]);
    const profile = h.store.users['session-synthetic'];
    if (changed === 'rol') profile.rol = 'GERENTE';
    if (changed === 'plaza') profile.plaza = 'TAMPICO';
    if (changed === 'rol ausente') delete profile.rol;
    if (changed === 'plaza ausente') delete profile.plaza;
    if (changed === 'perfil eliminado') delete h.store.users['session-synthetic'];
    await h.node('activityExportGENERAL').click();
    assertNoDownload(h, /perfil o su alcance cambió/);
    assert.deepEqual(h.reads, ['users/session-synthetic/rol', 'users/session-synthetic/plaza']);
    assert.equal(h.queryReads.length, 0);
    assert.equal(h.canonicalReads.length, 0);
  });
}

test('validación escalar permite rol/plaza equivalentes normalizados, sin leer perfil completo ni registrar listeners', async () => {
  const h = harness({ role: 'GERENTE', plaza: ' chihuáhua ' });
  h.store.users['session-synthetic'] = { rol: ' gerente ', plaza: 'CHIHUAHUA', dato_privado: 'NO LEER PERFIL COMPLETO' };
  install(h, [record(h, 0)], 'activity_summaries/plazas/CHIHUAHUA');
  await h.node('activityExportGENERAL').click();
  await csvDownload(h, 'GENERAL', 1);
  assert.deepEqual(h.profileReads.map(read => read.route), ['users/session-synthetic/rol', 'users/session-synthetic/plaza']);
  assert.ok(!h.reads.some(read => read === 'users/session-synthetic'));
  assert.deepEqual(h.forbidden, []);
});

for (const label of ['auth', 'filtro']) {
  test(`cambio de ${label} durante await de validación escalar cancela antes de directorio/rango/canónico`, async () => {
    const block = blockReads(request => /^users\/session-synthetic\/(rol|plaza)$/.test(routeOf(request)));
    const h = harness({ beforeRead: block.beforeRead });
    install(h, [record(h, 0)]);
    const exporting = h.node('activityExportGENERAL').click();
    await block.entered;
    if (label === 'auth') h.auth.currentUser = null;
    else h.node('activityPlaza').value = 'TAMPICO';
    block.release(); await exporting;
    assertNoDownload(h, /sesión o los filtros cambiaron.*cancelada/i);
    assert.equal(h.queryReads.length, 0);
    assert.equal(h.canonicalReads.length, 0);
    assert.equal(h.profileReads.length, 2);
  });
}

for (const indexed of [false, true]) {
  test(`consolidación export-only normaliza alias PROSPECTO y seguimiento_de; ${indexed ? 'índice' : 'directa'} conserva historial/arrays objetos como JSON`, async () => {
    const h = harness();
    if (indexed) h.node('activityPlaza').value = 'CHIHUAHUA';
    const root = record(h, 0, 'PROSPECCION', { es_expediente_prospeccion: true, actualizado_en: BASE + 100, historial_expediente: { inicio: { fecha: BASE } }, solo_raiz: 'Conservado' });
    const child = record(h, 1, 'PROSPECTO', {
      seguimiento_de: root.id, actualizado_en: BASE + 200, observaciones: 'Actualizado desde hijo alias',
      historial_expediente: { avance: { fecha: BASE + 200 } },
      array_objetos: [{ texto: 'Crédito, "sí"\nacción', monto: 0 }, { estado: false }],
    });
    install(h, [root, child], indexed ? 'activity_summaries/plazas/CHIHUAHUA' : 'gestor_activities');
    await h.node('activityExportPROSPECCION').click();
    const csv = await csvDownload(h, 'PROSPECCION', 1);
    assert.equal(csv.cell(0, 'ID de actividad'), root.id);
    assert.equal(csv.cell(0, 'Tipo de actividad'), 'PROSPECCION');
    assert.equal(csv.cell(0, 'Seguimiento de'), root.id);
    assert.equal(csv.cell(0, 'Observaciones'), 'Actualizado desde hijo alias');
    assert.equal(csv.cell(0, 'solo_raiz'), 'Conservado');
    assert.deepEqual(JSON.parse(csv.cell(0, 'array_objetos')), child.array_objetos);
    assert.deepEqual(Object.keys(JSON.parse(csv.cell(0, 'historial_expediente'))).sort(), ['avance', 'inicio']);
    assert.deepEqual(h.canonicalReads.map(read => read.route).sort(), indexed ? [root, child].map(row => `gestor_activities/${row.id}`).sort() : []);
  });
}

test('hijo técnico coincidente desaparecido no permite exportar sólo raíz ni un expediente parcialmente consolidado', async () => {
  const h = harness();
  h.node('activityPlaza').value = 'CHIHUAHUA';
  const root = record(h, 0, 'PROSPECCION', { es_expediente_prospeccion: true });
  const child = record(h, 1, 'PROSPECCION', { seguimiento_de: root.id });
  const canonical = install(h, [root, child], 'activity_summaries/plazas/CHIHUAHUA');
  delete canonical[child.id];
  await h.node('activityExportPROSPECCION').click();
  assertNoDownload(h, /registro ya no está disponible.*no se descargó un archivo parcial/);
  assert.deepEqual(h.canonicalReads.map(read => read.route).sort(), [root, child].map(row => `gestor_activities/${row.id}`).sort());
});

test('consolidación no amplía rango a raíces/seguimientos históricos excluidos de la búsqueda', async () => {
  const h = harness();
  h.node('activityPlaza').value = 'CHIHUAHUA';
  const oldTime = new Date('2026-11-05T10:00:00').getTime();
  const root = record(h, 0, 'PROSPECCION', { id: h.api.firebasePushIdBoundary(oldTime, '-'), created_at: oldTime, es_expediente_prospeccion: true, solo_historico: 'FUERA DE RANGO' });
  const child = record(h, 1, 'PROSPECCION', { seguimiento_de: root.id, observaciones: 'Única coincidencia de la búsqueda' });
  install(h, [root, child], 'activity_summaries/plazas/CHIHUAHUA');
  await h.node('activityExportPROSPECCION').click();
  const csv = await csvDownload(h, 'PROSPECCION', 1);
  assert.equal(csv.cell(0, 'ID de actividad'), child.id);
  assert.equal(csv.cell(0, 'ID de prospecto raíz'), root.id);
  assert.equal(csv.cell(0, 'Observaciones'), child.observaciones);
  assert.ok(!csv.header.includes('solo_historico'));
  assert.deepEqual(h.canonicalReads.map(read => read.route), [`gestor_activities/${child.id}`]);
  assert.deepEqual(h.queryReads.flatMap(read => read.keys), [child.id]);
});

for (const type of TYPES) {
  test(`${type}: límites inclusivos exactos de fecha, wildcard/múltiples acciones sin fuga de otra categoría`, async () => {
    const h = harness();
    h.node('activityPlaza').value = 'CHIHUAHUA';
    h.node('activityType').value = type;
    const start = new Date(`${DAY}T00:00:00`).getTime();
    const end = new Date(`${DAY}T23:59:59.999`).getTime();
    const first = record(h, 0, type, { id: h.api.firebasePushIdBoundary(start, '-'), created_at: start, gestion_realizada: 'ACCION UNO' });
    const last = record(h, 1, type, { id: h.api.firebasePushIdBoundary(end, 'z'), created_at: end, gestion_realizada: 'ACCION DOS' });
    const before = record(h, 2, type, { id: h.api.firebasePushIdBoundary(start - 1, '-'), created_at: start - 1 });
    const after = record(h, 3, type, { id: h.api.firebasePushIdBoundary(end + 1, '-'), created_at: end + 1 });
    const different = record(h, 4, type === 'GENERAL' ? 'COBRANZA' : 'GENERAL');
    h.api.setActions(type === 'PROSPECCION' ? ['PROSPECCION|*'] : [`${type}|ACCION UNO`, `${type}|ACCION DOS`]);
    install(h, [first, last, before, after, different], 'activity_summaries/plazas/CHIHUAHUA');
    await h.node(`activityExport${type}`).click();
    const csv = await csvDownload(h, type, 2);
    assert.deepEqual(csv.rows.map(row => row[0]).sort(), [first.id, last.id].sort());
    assert.deepEqual(h.canonicalReads.map(read => read.route).sort(), [first, last].map(row => `gestor_activities/${row.id}`).sort());
    assert.equal(h.queryReads[0].constraints.find(item => item.type === 'start').value, first.id);
    assert.equal(h.queryReads[0].constraints.find(item => item.type === 'end').value, last.id);
    assert.ok(!h.queryReads.flatMap(read => read.keys).includes(before.id));
    assert.ok(!h.queryReads.flatMap(read => read.keys).includes(after.id));
  });
}

// Cobertura canónica no es sinónimo de índice completo: estas pruebas no admiten
// un éxito parcial ni el mensaje «No hay registros» cuando existe una coincidencia.
for (const type of TYPES) for (const indexState of ['ausente', 'parcial']) {
  test(`${type}: índice de plaza ${indexState} recupera las 57 coincidencias canónicas frescas, sin caché ni recorte50`, async () => {
    const h = harness();
    h.node('activityPlaza').value = 'CHIHUAHUA';
    const source = 'activity_summaries/plazas/CHIHUAHUA';
    const expected = Array.from({ length: 57 }, (_, index) => record(h, index, type, {
      comentarios: `FRESCO ${index}`, observaciones: `OBSERVACION FRESCA ${index}`,
      detalle_recuperado: { estado: 'vigente', numero: index },
    }));
    const foreign = record(h, 70, type, { plaza: 'TAMPICO', campo_solo_canonico: 'NO EXPORTAR OTRA PLAZA' });
    const otherType = record(h, 71, type === 'GENERAL' ? 'COBRANZA' : 'GENERAL');
    install(h, [...expected, foreign, otherType]);
    if (indexState === 'parcial') put(h.store, source, Object.fromEntries(expected.slice(0, 2).map(row => [row.id, indexRecord(row)])));
    for (const row of expected) h.api.seedDetailCache(`gestor_activities/${row.id}`, { ...row, campo_solo_canonico: 'NO USAR CACHE', comentarios: 'OBSOLETO' });
    await h.node(`activityExport${type}`).click();
    const csv = await csvDownload(h, type, expected.length);
    assert.deepEqual(csv.rows.map(row => row[0]).sort(), expected.map(row => row.id).sort());
    for (const [index, row] of expected.entries()) {
      const position = csv.rows.findIndex(cells => cells[0] === row.id);
      assert.equal(csv.cell(position, 'campo_solo_canonico'), `Detalle ${index}`);
      assert.deepEqual(JSON.parse(csv.cell(position, 'detalle_recuperado')), row.detalle_recuperado);
    }
    assert.doesNotMatch(await h.downloads[0].blob.text(), /NO USAR CACHE|OBSOLETO|NO EXPORTAR OTRA PLAZA/);
    assert.deepEqual(h.shallowReads, ['gestor_activities']);
    assert.ok(h.queryReads.every(read => read.route === source && read.count <= 51));
    assert.equal(new Set(h.canonicalReads.map(read => read.route)).size, h.canonicalReads.length, 'Históricos recuperados no se hidratan dos veces');
    assert.ok(expected.every(row => h.canonicalReads.some(read => read.route === `gestor_activities/${row.id}`)));
    assert.ok(h.maxCanonical() <= 8);
  });
}

test('índice por UID parcial: recupera coincidencias canónicas sin ampliar userSearch, rol, plaza ni acciones', async () => {
  const h = harness();
  h.node('activityUser').value = 'jose diaz'; h.node('activityRole').value = 'GESTOR';
  h.node('activityPlaza').value = 'CHIHUAHUA'; h.api.setActions(['GENERAL|LLAMADA']);
  put(h.store, 'users/employee-synthetic', { nombre_completo: 'José Díaz', correo: 'jose.diaz@example.test' });
  const expected = [record(h, 0), record(h, 1)];
  const rejected = [
    record(h, 2, 'GENERAL', { nombre_usuario: 'Otra persona', correo_usuario: 'otra@example.test' }),
    record(h, 3, 'GENERAL', { rol: 'CANJES' }),
    record(h, 4, 'GENERAL', { plaza: 'TAMPICO' }),
    record(h, 5, 'GENERAL', { gestion_realizada: 'OTRA ACCION' }),
    record(h, 6, 'COBRANZA'),
  ];
  install(h, [...expected, ...rejected]);
  put(h.store, 'activity_summaries/users/employee-synthetic', { [expected[0].id]: indexRecord(expected[0]) });
  await h.node('activityExportGENERAL').click();
  const csv = await csvDownload(h, 'GENERAL', expected.length);
  assert.deepEqual(csv.rows.map(row => row[0]).sort(), expected.map(row => row.id).sort());
  assert.ok(h.queryReads.every(read => read.route === 'activity_summaries/users/employee-synthetic'));
  assert.equal(h.shallowReads.filter(route => route === 'gestor_activities').length, 1);
  assert.ok(!h.reads.includes('users'), 'Directorio sólo proyección protegida y hojas de identidad');
});

for (const indexState of ['ausente', 'parcial']) {
  test(`GERENTE: índice ${indexState} recupera sólo su plaza; fuera de alcance se lee únicamente la plaza escalar`, async () => {
    const h = harness({ role: 'GERENTE', plaza: 'CHIHUAHUA', email: 'gerente.chihuahua@example.test' });
    const expected = [record(h, 0), record(h, 1, 'GENERAL', { id: 'old-1', created_at: BASE })];
    const rejected = [
      record(h, 2, 'GENERAL', { plaza: 'TAMPICO', user_uid: 'session-synthetic' }),
      record(h, 3, 'GENERAL', { plaza: 'PLAZA HISTORICA' }),
      record(h, 4, 'GENERAL', { plaza: '' }),
    ];
    install(h, [...expected, ...rejected]);
    if (indexState === 'parcial') put(h.store, 'activity_summaries/plazas/CHIHUAHUA', { [expected[0].id]: indexRecord(expected[0]) });
    await h.node('activityExportGENERAL').click();
    const csv = await csvDownload(h, 'GENERAL', expected.length);
    assert.deepEqual(csv.rows.map(row => row[0]).sort(), expected.map(row => row.id).sort());
    assert.deepEqual(h.canonicalReads.map(read => read.route).sort(), expected.map(row => `gestor_activities/${row.id}`).sort());
    for (const row of rejected) {
      assert.ok(h.scopeReads.some(read => read.route === `gestor_activities/${row.id}/plaza`));
      assert.ok(!h.canonicalReads.some(read => read.route === `gestor_activities/${row.id}`), 'No hidrata canónicos ajenos ni los propios trasladados');
    }
    assert.ok(h.queryReads.every(read => read.route === 'activity_summaries/plazas/CHIHUAHUA'));
    assert.deepEqual(h.shallowReads, ['gestor_activities', 'gestor_activities/old-1'], 'La clave no-push se distingue de un contenedor sólo mediante metadatos');
  });
}

for (const indexState of ['ausente', 'parcial']) {
  test(`cobertura shallow denegada con índice ${indexState}: error visible antes de query, nunca CSV vacío/parcial ni cero silencioso`, async () => {
    const h = harness({ denyShallow: true }); h.node('activityPlaza').value = 'CHIHUAHUA';
    const rows = [record(h, 0), record(h, 1)]; install(h, rows);
    if (indexState === 'parcial') put(h.store, 'activity_summaries/plazas/CHIHUAHUA', { [rows[0].id]: indexRecord(rows[0]) });
    await h.node('activityExportGENERAL').click();
    assertNoDownload(h, /No se pudo verificar la cobertura histórica/);
    assert.match(h.node('activityExportStatus').textContent, /Exportación no completada.*No se descargó un archivo parcial/);
    assert.ok(h.alerts.every(message => !/No hay registros/.test(message)));
    assert.deepEqual(h.shallowReads, ['gestor_activities']);
    assert.equal(h.queryReads.length, 0); assert.equal(h.canonicalReads.length, 0);
  });
}

test('exportación vuelve a enumerar cobertura aunque Buscar tenga claves cacheadas; incluye un canónico nuevo no indexado y texto fresco', async () => {
  const h = harness(); h.node('activityPlaza').value = 'CHIHUAHUA';
  const indexed = record(h, 0); install(h, [indexed], 'activity_summaries/plazas/CHIHUAHUA');
  await h.api.activityCachedKeys('gestor_activities', () => {});
  const recovered = record(h, 1, 'GENERAL', { comentarios: 'TEXTO NUEVO FRESCO', campo_solo_canonico: 'CANONICO NUEVO' });
  put(h.store, `gestor_activities/${recovered.id}`, recovered);
  h.api.seedDetailCache(`gestor_activities/${recovered.id}`, { ...recovered, comentarios: 'CACHE OBSOLETA' });
  await h.node('activityExportGENERAL').click();
  const csv = await csvDownload(h, 'GENERAL', 2);
  assert.deepEqual(csv.rows.map(row => row[0]).sort(), [indexed.id, recovered.id].sort());
  const position = csv.rows.findIndex(row => row[0] === recovered.id);
  assert.equal(csv.cell(position, 'Comentarios o motivos'), 'TEXTO NUEVO FRESCO');
  assert.equal(csv.cell(position, 'campo_solo_canonico'), 'CANONICO NUEVO');
  assert.deepEqual(h.shallowReads, ['gestor_activities', 'gestor_activities'], 'Export no reutiliza la promesa/TTL de Buscar');
  assert.deepEqual(h.canonicalReads.map(read => read.route).sort(), [indexed, recovered].map(row => `gestor_activities/${row.id}`).sort());
});

for (const failure of ['rejected', 'disappeared']) {
  test(`canónico omitido del índice ${failure}: no exporta sólo la coincidencia indexada ni oculta el fallo como cero`, async () => {
    let recoveryPath;
    const h = harness({ beforeRead: request => {
      if (failure === 'rejected' && request === recoveryPath) throw new Error('Recuperación histórica sintética denegada');
      // Las claves ya fueron enumeradas; desaparece justo antes de su get fresco.
      if (failure === 'disappeared' && request === recoveryPath) delete h.store.gestor_activities[recoveryPath.split('/')[1]];
    } });
    h.node('activityPlaza').value = 'CHIHUAHUA';
    const indexed = record(h, 0), recovered = record(h, 1); recoveryPath = `gestor_activities/${recovered.id}`;
    install(h, [indexed, recovered]);
    put(h.store, 'activity_summaries/plazas/CHIHUAHUA', { [indexed.id]: indexRecord(indexed) });
    await h.node('activityExportGENERAL').click();
    assertNoDownload(h, failure === 'rejected' ? /Recuperación histórica sintética denegada/ : /registro ya no está disponible/);
    assert.match(h.node('activityExportStatus').textContent, /No se descargó un archivo parcial/);
    assert.ok(h.alerts.every(message => !/No hay registros/.test(message)));
    assert.ok(h.canonicalReads.some(read => read.route === recoveryPath));
  });
}

for (const type of TYPES) for (const indexed of [true, false]) {
  test(`${type}: ID no-push histórico con fecha almacenada real, fuente ${indexed ? 'índice ausente' : 'directText'}, exige CSV íntegro o error de cobertura explícito`, async () => {
    const h = harness(); if (indexed) h.node('activityPlaza').value = 'CHIHUAHUA';
    const historical = record(h, 0, type, { id: 'old-1', created_at: BASE, campo_solo_canonico: 'HISTORICO FRESCO INTEGRO' });
    const outside = record(h, 1, type, { id: 'old-2', created_at: new Date('2026-11-05T10:00:00').getTime(), campo_solo_canonico: 'HISTORICO FUERA DE RANGO' });
    assert.equal(h.api.firebasePushIdTimestamp(historical.id), null, 'Fixture no usa una clave push ni una fecha inventada desde la clave');
    assert.equal(h.api.activityCreatedTimestamp(historical), BASE, 'La fecha real sí está almacenada');
    install(h, [historical, outside]);
    h.api.seedDetailCache(`gestor_activities/${historical.id}`, { ...historical, campo_solo_canonico: 'NO USAR CACHE HISTORICA' });
    await h.node(`activityExport${type}`).click();
    if (h.downloads.length) {
      const csv = await csvDownload(h, type, 1);
      assert.equal(csv.cell(0, 'ID de actividad'), historical.id);
      assert.equal(csv.cell(0, '_activity_path'), `gestor_activities/${historical.id}`);
      assert.equal(csv.cell(0, 'Marca de tiempo de creación'), String(BASE));
      assert.equal(csv.cell(0, 'campo_solo_canonico'), 'HISTORICO FRESCO INTEGRO');
      assert.doesNotMatch(await h.downloads[0].blob.text(), /HISTORICO FUERA DE RANGO|NO USAR CACHE HISTORICA/);
    } else {
      assertNoDownload(h, /No se pudo completar la exportación:.*(?:cobertura histórica|fechas históricas)/);
      assert.match(h.node('activityExportStatus').textContent, /No se descargó un archivo parcial/);
      assert.ok(h.alerts.every(message => !/No hay registros/.test(message)), 'Un histórico coincidente nunca se anuncia como cero');
    }
  });
}

// Históricos de exactamente dos segmentos: sólo shallow del contenedor y get
// de cada actividad, nunca get del contenedor completo ni de medios.
for (const type of TYPES) for (const indexed of [false, true]) {
  test(`${type}: contenedor legacy/ID (${indexed ? 'índice parcial' : 'directa'}) exporta 57 hojas frescas, paths reales y sin lecturas duplicadas`, async () => {
    const h = harness();
    if (indexed) h.node('activityPlaza').value = 'CHIHUAHUA';
    const rows = Array.from({ length: 57 }, (_, index) => record(h, index, type, { comentarios: `ANIDADO FRESCO ${index}`, observaciones: `OBS ANIDADA ${index}` }));
    const outside = record(h, 80, type, { id: 'historical_outside', created_at: new Date('2026-11-05T10:00:00').getTime(), campo_solo_canonico: 'NO EXPORTAR FUERA DE RANGO' });
    const otherType = record(h, 81, type === 'GENERAL' ? 'COBRANZA' : 'GENERAL');
    const longId = `${h.api.firebasePushIdBoundary(new Date('2026-11-05T10:00:00').getTime(), '-')}_arbitrary_long_legacy_id`;
    const long = record(h, 99, type, { id: longId, created_at: BASE + 99, comentarios: 'LEGACY LARGO FRESCO' });
    const nested = [...rows, outside, otherType, long];
    put(h.store, 'gestor_activities/legacy', Object.fromEntries(nested.map(row => [row.id, row])));
    if (indexed) put(h.store, 'activity_summaries/plazas/CHIHUAHUA', { [rows[0].id]: indexRecord(rows[0]) });
    for (const row of rows) h.api.seedDetailCache(`gestor_activities/legacy/${row.id}`, { ...row, comentarios: 'NO USAR CACHE ANIDADA' });
    await h.node(`activityExport${type}`).click();
    const csv = await csvDownload(h, type, 58);
    const csvId = id => id === longId ? `'${id}` : id; // Protección de fórmula, sin cambiar el ID/path del registro.
    assert.deepEqual(csv.rows.map(cells => cells[0]).sort(), [...rows, long].map(row => csvId(row.id)).sort());
    for (const row of [...rows, long]) {
      const position = csv.rows.findIndex(cells => cells[0] === csvId(row.id));
      assert.equal(csv.cell(position, '_activity_path'), `gestor_activities/legacy/${row.id}`);
      assert.equal(csv.cell(position, 'campo_solo_canonico'), row.campo_solo_canonico);
      assert.equal(csv.cell(position, 'comentarios') || csv.cell(position, 'Comentarios o motivos') || csv.cell(position, 'Comentarios'), row.comentarios);
    }
    assert.doesNotMatch(await h.downloads[0].blob.text(), /NO USAR CACHE ANIDADA|NO EXPORTAR FUERA DE RANGO/);
    assert.equal(h.canonicalReads.length, nested.length);
    assert.equal(new Set(h.canonicalReads.map(read => read.route)).size, nested.length, 'La coincidencia indexada anidada también reutiliza su lectura fresca');
    assert.ok(h.canonicalReads.every(read => /^gestor_activities\/legacy\/[^/]+$/.test(read.route)), 'Nunca get del contenedor ni de un ID falsamente aplanado');
    assert.ok(h.maxCanonical() <= 8);
    assert.ok(h.shallowReads.includes('gestor_activities/legacy'));
    assert.ok(nested.every(row => h.shallowReads.includes(`gestor_activities/legacy/${row.id}`)));
    assert.ok(h.reads.every(read => !/gestor_photos|storage|media/.test(routeOf(read))));
  });
}

for (const indexState of ['ausente', 'parcial']) {
  test(`GERENTE contenedor sin plaza: ${indexState} verifica plaza escalar por hoja, no omite hijos propios ni hidrata ajenos`, async () => {
    const h = harness({ role: 'GERENTE', plaza: 'CHIHUAHUA' });
    const good = [record(h, 0), record(h, 1, 'GENERAL', { id: 'legacy_leaf_with_long_arbitrary_name' })];
    const foreign = [record(h, 2, 'GENERAL', { plaza: 'TAMPICO', user_uid: 'session-synthetic' }), record(h, 3, 'GENERAL', { plaza: '' })];
    put(h.store, 'gestor_activities/legacy', Object.fromEntries([...good, ...foreign].map(row => [row.id, row])));
    if (indexState === 'parcial') put(h.store, 'activity_summaries/plazas/CHIHUAHUA', { [good[0].id]: indexRecord(good[0]) });
    await h.node('activityExportGENERAL').click();
    const csv = await csvDownload(h, 'GENERAL', 2);
    assert.deepEqual(csv.rows.map(row => row[0]).sort(), good.map(row => row.id).sort());
    assert.deepEqual(h.scopeReads.map(read => read.route).sort(), [...good, ...foreign].map(row => `gestor_activities/legacy/${row.id}/plaza`).sort());
    assert.deepEqual(h.canonicalReads.map(read => read.route).sort(), good.map(row => `gestor_activities/legacy/${row.id}`).sort());
    assert.ok(!h.reads.includes('gestor_activities/legacy/plaza'), 'El contenedor no es una hoja ni tiene plaza heredable');
  });
}

for (const layout of ['ambos anidados', 'raiz anidada', 'hijo anidado']) {
  test(`PROSPECCION ${layout}: consolida historia fresca y conserva path de raíz, no el path del último seguimiento`, async () => {
    const h = harness(); h.node('activityPlaza').value = 'CHIHUAHUA';
    const root = record(h, 0, 'PROSPECCION', { es_expediente_prospeccion: true, actualizado_en: BASE + 100, solo_raiz: 'RAIZ FRESCA', historial_expediente: { inicio: { fecha: BASE, texto: 'Inicio fresco' } } });
    const child = record(h, 1, 'PROSPECCION', { seguimiento_de: root.id, actualizado_en: BASE + 200, solo_hijo: 'HIJO FRESCO', historial_expediente: { avance: { fecha: BASE + 200, texto: 'Avance fresco' } } });
    const rootPath = `gestor_activities/${layout === 'hijo anidado' ? '' : 'legacy/'}${root.id}`;
    const childPath = `gestor_activities/${layout === 'raiz anidada' ? '' : 'legacy/'}${child.id}`;
    put(h.store, rootPath, root); put(h.store, childPath, child);
    put(h.store, 'activity_summaries/plazas/CHIHUAHUA', { [root.id]: indexRecord(root), [child.id]: indexRecord(child) });
    await h.node('activityExportPROSPECCION').click();
    const csv = await csvDownload(h, 'PROSPECCION', 1);
    assert.equal(csv.cell(0, 'ID de actividad'), root.id);
    assert.equal(csv.cell(0, '_activity_path'), rootPath);
    assert.equal(csv.cell(0, 'solo_raiz'), 'RAIZ FRESCA');
    assert.equal(csv.cell(0, 'solo_hijo'), 'HIJO FRESCO');
    assert.deepEqual(Object.keys(JSON.parse(csv.cell(0, 'historial_expediente'))).sort(), ['avance', 'inicio']);
    assert.deepEqual(h.canonicalReads.map(read => read.route).sort(), [rootPath, childPath].sort());
  });
}

for (const structure of ['tercer nivel', 'hoja malformada', 'ID duplicado entre contenedores', 'ID duplicado plano-anidado', 'contenedor entre fronteras push']) {
  test(`cobertura anidada ${structure}: error visible antes de éxito vacío/parcial, sin get de contenedor`, async () => {
    const h = harness();
    if (structure !== 'contenedor entre fronteras push') h.node('activityPlaza').value = 'CHIHUAHUA';
    const indexed = record(h, 0); install(h, [indexed], 'activity_summaries/plazas/CHIHUAHUA');
    const leaf = record(h, 1, 'GENERAL', { id: 'nested_leaf' });
    if (structure === 'tercer nivel') put(h.store, 'gestor_activities/legacy/deeper/nested_leaf', leaf);
    if (structure === 'hoja malformada') put(h.store, 'gestor_activities/legacy/nested_leaf', { tipo: 'GENERAL', plaza: 'CHIHUAHUA', created_at: BASE });
    if (structure === 'ID duplicado entre contenedores') {
      put(h.store, 'gestor_activities/legacy/nested_leaf', leaf);
      put(h.store, 'gestor_activities/another/nested_leaf', leaf);
    }
    if (structure === 'ID duplicado plano-anidado') put(h.store, `gestor_activities/legacy/${indexed.id}`, indexed);
    if (structure === 'contenedor entre fronteras push') put(h.store, `gestor_activities/${h.api.firebasePushIdBoundary(BASE + 10, '-')}_container/nested_leaf`, leaf);
    await h.node('activityExportGENERAL').click();
    assertNoDownload(h, /cobertura histórica/i);
    assert.ok(h.alerts.every(message => !/No hay registros/.test(message)));
    assert.match(h.node('activityExportStatus').textContent, /No se descargó un archivo parcial/);
    assert.equal(h.canonicalReads.length, 0);
    assert.equal(h.queryReads.length, 0, 'La estructura ambigua/profunda se valida antes de una query que pudiera descargar contenedores');
  });
}

for (const failure of ['shallow denegado', 'hoja desaparecida', 'lectura rechazada', 'fecha ausente', 'plaza no escalar', 'cancelada']) {
  test(`hoja anidada ${failure}: no se anuncia cero ni se descarga sólo el registro indexado`, async () => {
    let leafPath;
    const h = harness({ role: failure === 'plaza no escalar' ? 'GERENTE' : 'ADMINISTRATIVO', beforeRead: request => {
      if (failure === 'shallow denegado' && request.shallow && request.route === 'gestor_activities/legacy') throw new Error('Metadatos históricos denegados');
      if (request === leafPath) {
        if (failure === 'hoja desaparecida') delete h.store.gestor_activities.legacy.nested_leaf;
        if (failure === 'lectura rechazada') throw new Error('Lectura anidada sintética denegada');
        if (failure === 'cancelada') h.node('activityRole').value = 'CANJES';
      }
    } });
    h.node('activityPlaza').value = 'CHIHUAHUA';
    const indexed = record(h, 0); install(h, [indexed], 'activity_summaries/plazas/CHIHUAHUA');
    const leaf = record(h, 1, 'GENERAL', { id: 'nested_leaf' });
    if (failure === 'fecha ausente') delete leaf.created_at;
    if (failure === 'plaza no escalar') leaf.plaza = { privada: true };
    leafPath = `gestor_activities/legacy/${leaf.id}`;
    put(h.store, leafPath, leaf);
    await h.node('activityExportGENERAL').click();
    const pattern = failure === 'lectura rechazada' ? /Lectura anidada sintética denegada/ : failure === 'hoja desaparecida' ? /registro ya no está disponible/ : failure === 'cancelada' ? /cancelada/ : /cobertura histórica/i;
    assertNoDownload(h, pattern);
    assert.ok(h.alerts.every(message => !/No hay registros/.test(message)));
    assert.match(h.node('activityExportStatus').textContent, /No se descargó un archivo parcial/);
    assert.ok(!h.canonicalReads.some(read => read.route === 'gestor_activities/legacy'));
  });
}

for (const changed of ['tipo', 'plaza']) {
  test(`índice anidado cambió ${changed}: falla completo en vez de ignorar silenciosamente la coincidencia vieja`, async () => {
    const h = harness({ role: changed === 'plaza' ? 'GERENTE' : 'ADMINISTRATIVO' });
    h.node('activityPlaza').value = 'CHIHUAHUA';
    const leaf = record(h, 0);
    put(h.store, 'activity_summaries/plazas/CHIHUAHUA', { [leaf.id]: indexRecord(leaf) });
    put(h.store, `gestor_activities/legacy/${leaf.id}`, { ...leaf, ...(changed === 'tipo' ? { tipo: 'COBRANZA' } : { plaza: 'TAMPICO' }) });
    await h.node('activityExportGENERAL').click();
    assertNoDownload(h, /registro cambió.*no se descargó un archivo parcial/);
    assert.equal(h.canonicalReads.length, changed === 'plaza' ? 0 : 1, 'Gerencia nunca hidrata una hoja ahora ajena');
  });
}

for (const indexed of [false, true]) {
  test(`IDs largos root con prefijo push no inventan fecha ni omiten canónicos (${indexed ? 'índice' : 'directa'})`, async () => {
    const h = harness(); if (indexed) h.node('activityPlaza').value = 'CHIHUAHUA';
    const good = record(h, 0, 'GENERAL', { id: `${h.api.firebasePushIdBoundary(BASE, '-')}_long_actual_legacy_id`, created_at: BASE, comentarios: 'FECHA REAL FRESCA' });
    const outside = record(h, 1, 'GENERAL', { id: `${h.api.firebasePushIdBoundary(BASE + 1, '-')}_long_outside_legacy_id`, created_at: new Date('2026-11-05T10:00:00').getTime(), comentarios: 'NO EXPORTAR FECHA INVENTADA' });
    install(h, [good, outside]);
    if (indexed) put(h.store, 'activity_summaries/plazas/CHIHUAHUA', { [good.id]: { ...indexRecord(good), created_at: undefined } });
    await h.node('activityExportGENERAL').click();
    const csv = await csvDownload(h, 'GENERAL', 1);
    assert.equal(csv.cell(0, 'ID de actividad'), `'${good.id}`);
    assert.equal(csv.cell(0, '_activity_path'), `gestor_activities/${good.id}`);
    assert.equal(csv.cell(0, 'Comentarios o motivos'), 'FECHA REAL FRESCA');
    assert.doesNotMatch(await h.downloads[0].blob.text(), /FECHA INVENTADA/);
    assert.equal(new Set(h.canonicalReads.map(read => read.route)).size, h.canonicalReads.length);
    assert.equal(h.canonicalReads.length, indexed ? 2 : 0, 'directText fresco no requiere gets adicionales de los legacy recorridos');
  });
}

for (const indexed of [false, true]) {
  test(`legacy largo sin fecha real (${indexed ? 'índice' : 'directa'}) no usa fecha ficticia del prefijo push y bloquea cobertura`, async () => {
    const h = harness(); if (indexed) h.node('activityPlaza').value = 'CHIHUAHUA';
    const row = record(h, 0, 'GENERAL', { id: `${h.api.firebasePushIdBoundary(BASE, '-')}_long_without_date` });
    delete row.created_at;
    install(h, [row]);
    await h.node('activityExportGENERAL').click();
    assertNoDownload(h, /cobertura histórica.*fechas históricas/i);
    assert.ok(h.alerts.every(message => !/No hay registros/.test(message)));
  });
}

test('legacy anidado con fecha sólo en bitácora conserva fecha real en preview y CSV sin rehidratar', async () => {
  const h = harness(); h.node('activityPlaza').value = 'CHIHUAHUA';
  const row = record(h, 0, 'GENERAL', { id: 'legacy_only_history', historial_expediente: { movimiento: { fecha: BASE } } });
  delete row.created_at;
  put(h.store, `gestor_activities/legacy/${row.id}`, row);
  await h.node('activityExportGENERAL').click();
  const csv = await csvDownload(h, 'GENERAL', 1);
  assert.equal(csv.cell(0, 'Marca de tiempo de creación'), String(BASE));
  assert.equal(csv.cell(0, '_activity_path'), `gestor_activities/legacy/${row.id}`);
  assert.equal(h.canonicalReads.length, 1);
});
