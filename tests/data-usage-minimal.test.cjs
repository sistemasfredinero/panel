'use strict';

// VM de las funciones REALES del panel; no Firebase, credenciales, red ni envíos.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const html = readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const plain = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const bytes = value => Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
const TELEMETRY_SOURCE = html.slice(html.indexOf('  let allRecords = []'), html.indexOf('  function formatDataUsageBytes('));
const DIAGNOSTICS_SOURCE = html.slice(html.indexOf('  function privacyFormatDate('), html.indexOf('  function prospectCounterKey('));
function realFunction(name) {
  const match = html.match(new RegExp(`^  (?:async )?function ${name}\\([^\\n]*\\) \\{(?:[^\\n]*\\}$|\\n[\\s\\S]*?^  \\})`, 'm'));
  assert.ok(match, `Función real no encontrada: ${name}`);
  return match[0];
}
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function until(predicate) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.ok(predicate(), 'No se alcanzó la condición local esperada');
}
function fixture() {
  const metric = (read_count, estimated_bytes, source = 'PANEL') => ({ read_count, estimated_bytes, source, last_records: 2, last_at: new Date(2026, 10, 10, 9).getTime(), last_scope: 'Período' });
  const historical = Object.fromEntries(Array.from({ length: 31 }, (_, i) => {
    const day = new Date(2026, 10, 10 - i);
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    return [key, { PANEL_ACTIVITY_SEARCH_PAGE: metric(1, 100) }];
  }));
  return {
    Ana: { nombre_completo: 'Ana María', correo: 'ana@example.test', rol: 'GESTOR', foto: 'x'.repeat(32000), tokens: { device: 'DO-NOT-READ' }, data_usage_metrics: historical },
    Nombre: { nombre: '<b>José</b>', data_usage_metrics: { '2026-11-09': { PANEL_ACTIVITY_GRAPHICS_RANGE: metric(2, 300) } } },
    Correo: { correo: 'persona@example.test', data_usage_metrics: { '2026-11-04': { APP_ACTIVITIES_SUMMARY: metric(3, 450, 'APP') } } },
    NodoTecnico: { data_usage_metrics: { '2026-11-10': { PANEL_ACTIVITY_SEARCH_PAGE: metric(4, 900) } } },
    SoloHistorico: { nombre_completo: 'Sin métricas recientes', data_usage_metrics: { '2026-10-25': { PANEL_ACTIVITY_SEARCH_PAGE: metric(6, 800) } } },
    Futuro: { data_usage_metrics: { '2026-11-11': { APP_FUTURE: metric(88, 99999) } } },
    PerfilSinMetricas: { nombre_completo: 'No descargar', tokens: { secret: 'NO' }, foto: 'z'.repeat(64000) },
  };
}
function harness({ users = fixture(), support = true, hooks = {}, shallow = undefined, status = 200 } = {}) {
  let clock = new Date(2026, 10, 10, 12).getTime();
  let timerId = 0;
  const timers = new Map();
  const reads = [];
  const writes = [];
  const fetches = [];
  const log = [];
  const authListeners = [];
  const downloads = [];
  let activeReads = 0;
  let maxActive = 0;
  let tokenCalls = 0;
  const uidCalls = [];
  function user(uid = 'support-uid', email = support ? 'soporte@fredinero.com' : 'other@example.test') {
    return { uid, email, getIdToken: async () => {
      tokenCalls++;
      if (hooks.token) return hooks.token(h);
      return 'FAKE-ID-TOKEN-ONLY-IN-MEMORY';
    } };
  }
  const auth = { currentUser: user() };
  const node = () => ({ innerHTML: '', value: '', style: {}, disabled: false });
  const ids = Object.fromEntries(['dataUsageDays', 'dataUsageDiagnosticsSummary', 'dataUsageDiagnosticsTable', 'dataUsageDiagnosticsSection', 'app'].map(id => [id, node()]));
  ids.dataUsageDays.value = '7';
  const readPath = route => route.split('/').reduce((value, key) => key === 'users' ? users : value?.[key], null);
  const sandbox = {
    auth, database: {}, firebaseConfig: { databaseURL: 'https://fixture-only.invalid' },
    TextEncoder, AbortController,
    Date: class extends Date { static now() { return clock; } },
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { at: clock + delay, delay, callback }); return id; },
    clearTimeout: id => timers.delete(id),
    document: { getElementById: id => ids[id] || null },
    console: Object.fromEntries(['log', 'warn', 'error', 'info', 'debug'].map(name => [name, (...args) => log.push(args)])),
    alert: message => log.push(['alert', message]),
    setPanelHeader: () => {},
    onAuthStateChanged: (_auth, callback) => { authListeners.push(callback); return () => {}; },
    ref: (_db, route) => route,
    orderByKey: () => ({ type: 'orderByKey' }),
    startAt: value => ({ type: 'startAt', value }),
    endAt: value => ({ type: 'endAt', value }),
    query: (route, ...constraints) => ({ route, constraints }),
    increment: value => ({ '.sv': { increment: value } }),
    update: (route, changes) => { writes.push({ route, changes: plain(changes) }); return Promise.resolve(); },
    get: async request => {
      const route = typeof request === 'string' ? request : request.route;
      reads.push(plain(request));
      assert.match(route, /^users\/[^/]+\/(data_usage_metrics|nombre_completo|nombre|correo)$/);
      activeReads++;
      maxActive = Math.max(maxActive, activeReads);
      try {
        if (hooks.get) await hooks.get(request, h);
        let value = plain(readPath(route)) ?? null;
        if (typeof request === 'object') {
          assert.deepEqual(request.constraints.map(c => c.type), ['orderByKey', 'startAt', 'endAt']);
          const from = request.constraints[1].value;
          const to = request.constraints[2].value;
          value = value === null ? null : Object.fromEntries(Object.entries(value).filter(([key]) => key >= from && key <= to));
          if (value && !Object.keys(value).length) value = null;
        }
        if (hooks.value) value = hooks.value(request, value, h);
        downloads.push({ route, bytes: bytes(value) });
        return { val: () => value, exists: () => value !== null };
      } finally { activeReads--; }
    },
    fetch: async (url, options) => {
      const parsed = new URL(url);
      assert.equal(parsed.origin, 'https://fixture-only.invalid');
      assert.equal(parsed.pathname, '/users.json');
      assert.equal(parsed.searchParams.get('shallow'), 'true');
      assert.equal(parsed.searchParams.get('auth'), 'FAKE-ID-TOKEN-ONLY-IN-MEMORY');
      assert.deepEqual([...parsed.searchParams.keys()].sort(), ['auth', 'shallow']);
      assert.equal(options.method, 'GET');
      assert.equal(options.cache, 'no-store');
      assert.equal(options.credentials, 'omit');
      assert.equal(options.referrerPolicy, 'no-referrer');
      // Ni siquiera las pruebas guardan el URL autenticado.
      fetches.push({ path: parsed.pathname, shallow: parsed.searchParams.get('shallow'), signal: options.signal });
      if (hooks.fetch) await hooks.fetch(options, h);
      const result = shallow === undefined ? Object.fromEntries(Object.keys(users).map(uid => [uid, true])) : shallow;
      downloads.push({ route: 'shallow-users', bytes: bytes(result) });
      return { ok: status === 200, status, json: async () => { if (hooks.json) await hooks.json(h); return plain(result); } };
    },
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext([
    TELEMETRY_SOURCE,
    realFunction('formatDataUsageBytes'), realFunction('privacyIsSupport'), realFunction('privacyEscape'),
    DIAGNOSTICS_SOURCE,
    'globalThis.api = { estimateDataUsageBytes, recordPanelDataUsage, flushPanelDataUsage, dataUsageDateKey, dataUsageActionLabel, state: () => ({ queued: _panelDataUsageCooldown.size, job: _dataUsageDiagnosticsJob, user: _panelDataUsageUser }) };',
  ].join('\n\n'), context, { filename: 'index.html:real-data-usage' });
  const h = {
    api: sandbox.api, window: sandbox, auth, ids, users, reads, writes, fetches, downloads, log, timers, user,
    load: () => sandbox.loadDataUsageDiagnostics(),
    tokenCalls: () => tokenCalls,
    maxActive: () => maxActive,
    activeReads: () => activeReads,
    output: () => ids.dataUsageDiagnosticsSummary.innerHTML + '\n' + ids.dataUsageDiagnosticsTable.innerHTML,
    changeUser: next => { auth.currentUser = next; uidCalls.push(next?.uid); for (const callback of authListeners) callback(next); },
    advance: milliseconds => {
      clock += milliseconds;
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= clock).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]); due[1].callback();
      }
    },
  };
  return h;
}
function assertNoSuccess(h) {
  assert.equal(h.ids.dataUsageDiagnosticsSummary.innerHTML, '');
  assert.doesNotMatch(h.ids.dataUsageDiagnosticsTable.innerHTML, /<table|lectura\(s\) registradas|usuario\(s\) con telemetría/);
  assert.equal(h.writes.length, 0, 'Diagnóstico fallido no escribe telemetría de éxito');
}

test('enumeración shallow autenticada + métricas por rango: conserva contribuyentes históricos/técnicos y no lee perfiles completos', async () => {
  const h = harness();
  const before = plain(h.users);
  await h.load();
  assert.equal(h.fetches.length, 1);
  assert.equal(h.tokenCalls(), 1);
  assert.equal(h.reads.filter(request => typeof request === 'object').length, Object.keys(h.users).length);
  assert.ok(h.maxActive() <= 6);
  for (const request of h.reads.filter(request => typeof request === 'object')) {
    assert.deepEqual(request.constraints, [{ type: 'orderByKey' }, { type: 'startAt', value: '2026-11-04' }, { type: 'endAt', value: '2026-11-10' }]);
  }
  assert.match(h.output(), /16 lectura\(s\) registradas/);
  assert.match(h.output(), /4 usuario\(s\) con telemetría/);
  for (const name of ['Ana María', '&lt;b&gt;José&lt;/b&gt;', 'persona@example.test', 'NodoTecnico']) assert.ok(h.output().includes(name), name);
  assert.doesNotMatch(h.output(), /APP FUTURE|No descargar|Sin métricas recientes|<b>José<\/b>/);
  assert.ok(!h.reads.some(request => typeof request === 'string' && /SoloHistorico|Futuro|PerfilSinMetricas/.test(request)), 'No se lee identidad sin métricas del rango');
  assert.ok(!h.reads.includes('users/Ana/correo'), 'Fallback progresivo no descarga correo si tiene nombre');
  assert.deepEqual(h.users, before, 'No muta las métricas históricas ni perfiles');
  assert.equal(h.writes.length, 1, 'Sólo telemetría mínima existente del operador');
  const change = h.writes[0].changes;
  assert.deepEqual(change['2026-11-10/PANEL_DATA_USAGE_DIAGNOSTICS/estimated_bytes'], { '.sv': { increment: h.downloads.reduce((sum, item) => sum + item.bytes, 0) } });
});

test('fixture comparativa UTF-8: descarga mínima menor que users completo con agregados idénticos', async () => {
  const h = harness();
  await h.load();
  const legacyBytes = bytes(h.users);
  const minimalBytes = h.downloads.reduce((sum, item) => sum + item.bytes, 0);
  assert.ok(minimalBytes < legacyBytes / 10, `${minimalBytes} debe ser menos de una décima de ${legacyBytes}`);
  const legacyTotals = Object.values(h.users).flatMap(user => Object.entries(user.data_usage_metrics || {}).filter(([key]) => key >= '2026-11-04' && key <= '2026-11-10').flatMap(([, actions]) => Object.values(actions)));
  const totalReads = legacyTotals.reduce((sum, item) => sum + item.read_count, 0);
  const totalBytes = legacyTotals.reduce((sum, item) => sum + item.estimated_bytes, 0);
  assert.match(h.output(), new RegExp(`${totalReads} lectura\\(s\\) registradas`));
  assert.match(h.output(), /2\.3 KB estimados/);
  assert.equal(totalBytes, 2350);
  console.log(`Fixture local: users completo ${legacyBytes} bytes; diagnóstico mínimo ${minimalBytes} bytes; agregados ${totalReads} lecturas / ${totalBytes} bytes.`);
});

test('30 días conserva las contribuciones del rango sin migración ni límite de usuarios', async () => {
  const h = harness();
  h.ids.dataUsageDays.value = '30';
  await h.load();
  assert.match(h.output(), /45 lectura\(s\) registradas/);
  assert.match(h.output(), /5 usuario\(s\) con telemetría/);
  assert.match(h.output(), /Sin métricas recientes/);
  assert.equal(h.reads.find(request => typeof request === 'object').constraints[1].value, '2026-10-12');
});

test('la enumeración incluye todos los UIDs aunque notice_directory no tenga nodos técnicos; concurrencia real máxima seis', async () => {
  const release = deferred();
  const users = Object.fromEntries(Array.from({ length: 19 }, (_, i) => [`technical-${i}`, { data_usage_metrics: { '2026-11-10': { PANEL_ACTIVITY_ROUTE_LOCATIONS: { read_count: 1, estimated_bytes: 1 } } } }]));
  const h = harness({ users, hooks: { get: async () => { await release.promise; } } });
  const job = h.load();
  await until(() => h.activeReads() === 6);
  assert.equal(h.reads.length, 6);
  release.resolve();
  await job;
  assert.equal(h.maxActive(), 6);
  assert.match(h.output(), /19 usuario\(s\) con telemetría/);
  assert.match(h.output(), /technical-18/);
});

test('doble clic deduplica en vuelo y después permite actualización explícita', async () => {
  const release = deferred();
  const h = harness({ hooks: { fetch: async () => { await release.promise; } } });
  const first = h.load();
  const second = h.load();
  assert.equal(second, first);
  await until(() => h.fetches.length === 1);
  release.resolve();
  await Promise.all([first, second]);
  assert.equal(h.fetches.length, 1);
  await h.load();
  assert.equal(h.fetches.length, 2, 'Sin caché obsoleta de sesión al actualizar');
});

test('no Soporte y sesión ausente: error visible, ninguna lectura ni token ni escritura', async () => {
  for (const missingUser of [false, true]) {
    const h = harness({ support: false });
    if (missingUser) h.auth.currentUser = null;
    await h.load();
    assert.equal(h.reads.length + h.fetches.length + h.tokenCalls(), 0);
    assertNoSuccess(h);
    assert.match(h.output(), /exclusiva para Soporte/);
  }
});

test('fallos shallow 401/403/400/503 y respuestas inválidas nunca fallback a users ni éxito parcial', async () => {
  for (const options of [
    { status: 401 }, { status: 403 }, { status: 400 }, { status: 503 },
    { shallow: 'bad' }, { shallow: [] }, { shallow: { u: { secret: 'never-download' } } }, { shallow: { 'invalid/key': true } },
  ]) {
    const h = harness(options);
    await h.load();
    assert.equal(h.reads.length, 0);
    assertNoSuccess(h);
    assert.match(h.output(), /No se pudo cargar el diagnóstico completo/);
    assert.match(h.output(), /No se muestran resultados parciales/);
  }
});

test('base vacía shallow null es diagnóstico completo sin lecturas individuales', async () => {
  const h = harness({ users: {}, shallow: null });
  await h.load();
  assert.equal(h.reads.length, 0);
  assert.match(h.output(), /0 usuario\(s\) con telemetría/);
  assert.match(h.output(), /Aún no hay métricas/);
});

test('fallo de token, fetch y JSON se sanitiza: sin tokens en consola, DOM o telemetría', async () => {
  for (const field of ['token', 'fetch', 'json']) {
    const h = harness({ hooks: { [field]: () => { throw new Error('https://bad.invalid?auth=DO-NOT-LEAK'); } } });
    await h.load();
    assertNoSuccess(h);
    assert.equal(h.reads.length, 0);
    assert.doesNotMatch(h.output() + JSON.stringify(h.log) + JSON.stringify(h.writes), /DO-NOT-LEAK|auth=/);
  }
});

test('timeout de token/fetch/SDK cancela la consulta, muestra error completo y no publica resultados tardíos', async () => {
  for (const field of ['token', 'fetch', 'get']) {
    const release = deferred();
    const h = harness({ hooks: { [field]: async () => { await release.promise; return field === 'token' ? 'FAKE-ID-TOKEN-ONLY-IN-MEMORY' : undefined; } } });
    const job = h.load();
    await until(() => field === 'token' ? h.tokenCalls() === 1 : field === 'fetch' ? h.fetches.length === 1 : h.reads.length === 6);
    h.advance(20_001);
    await job;
    assertNoSuccess(h);
    assert.match(h.output(), /tiempo de espera/);
    const output = h.output();
    const readCount = h.reads.length;
    release.resolve();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.output(), output);
    assert.equal(h.reads.length, readCount);
    if (h.fetches.length) assert.equal(h.fetches[0].signal.aborted, true);
  }
});

test('permiso denegado en un UID no representa los otros contribuyentes como éxito parcial', async () => {
  const h = harness({ hooks: { get: request => {
    if ((request.route || request).includes('NodoTecnico')) throw new Error('Permission denied with auth=NO-LEAK');
  } } });
  await h.load();
  assertNoSuccess(h);
  assert.match(h.output(), /permisos de Soporte/);
  assert.doesNotMatch(h.output(), /NO-LEAK/);
  assert.ok(h.api.state().job.cancelled);
});

test('permiso denegado en escalar de identidad también falla completo, no omite contribuyentes', async () => {
  const h = harness({ hooks: { get: request => {
    if (request === 'users/Ana/nombre_completo') throw new Error('Permission denied');
  } } });
  await h.load();
  assertNoSuccess(h);
});

test('logout y cambio de cuenta cancelan fetch/lecturas; limpiado de DOM evita exposición tardía', async () => {
  for (const field of ['fetch', 'get']) {
    for (const logout of [true, false]) {
      const release = deferred();
      const h = harness({ hooks: { [field]: async () => { await release.promise; } } });
      const job = h.load();
      await until(() => field === 'fetch' ? h.fetches.length === 1 : h.reads.length === 6);
      h.changeUser(logout ? null : h.user('different-support'));
      await job;
      assertNoSuccess(h);
      assert.match(h.output(), /sesión cambió/);
      assert.equal(h.ids.dataUsageDiagnosticsSection.style.display, 'none');
      const output = h.output();
      const readCount = h.reads.length;
      release.resolve();
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(h.output(), output);
      assert.equal(h.reads.length, readCount);
    }
  }
});

test('cambio de rango invalida trabajo previo; resultado tardío no sobrescribe el nuevo', async () => {
  const release = deferred();
  let firstFetch = true;
  const h = harness({ hooks: { fetch: async () => { if (firstFetch) { firstFetch = false; await release.promise; } } } });
  const old = h.load();
  await until(() => h.fetches.length === 1);
  h.ids.dataUsageDays.value = '1';
  const next = h.load();
  assert.notEqual(old, next);
  await next;
  assert.match(h.output(), /5 lectura\(s\) registradas/);
  const output = h.output();
  release.resolve();
  await old;
  assert.equal(h.output(), output);
  assert.equal(h.fetches[0].signal.aborted, true);
});

test('concurrencia global seis incluso al cambiar rango con seis GET SDK antiguos no abortables', async () => {
  const release = deferred();
  let blocking = true;
  const h = harness({ hooks: { get: async () => { if (blocking) await release.promise; } } });
  const old = h.load();
  await until(() => h.activeReads() === 6);
  h.ids.dataUsageDays.value = '1';
  const next = h.load();
  await until(() => h.fetches.length === 2);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.reads.length, 6, 'El nuevo trabajo espera cupo en vez de emitir otros seis GET');
  assert.equal(h.maxActive(), 6);
  blocking = false;
  release.resolve();
  await Promise.all([old, next]);
  assert.equal(h.maxActive(), 6);
  assert.match(h.output(), /5 lectura\(s\) registradas/);
});

test('formatos corruptos en métricas, días o acciones producen error completo visible', async () => {
  for (const malformed of [
    'invalid', [], { '2026-11-10': 'invalid' }, { '2026-11-10': [] },
    { '2026-11-10': { ACTION: null } }, { '2026-11-10': { ACTION: [] } },
    { '2026-11-10': { ACTION: { read_count: -1 } } },
    { '2026-11-10': { ACTION: { estimated_bytes: 'not-a-number' } } },
  ]) {
    const h = harness({ users: { corrupt: {} }, hooks: { value: request => typeof request === 'object' ? malformed : null } });
    await h.load();
    assertNoSuccess(h);
    assert.match(h.output(), /No se pudo cargar el diagnóstico completo/);
  }
});

test('estimación usa JSON UTF-8 real y soporta acentos, emoji, null y circular', () => {
  const h = harness();
  for (const value of [null, { nombre: 'José 🎉 中文', text: 'áéíóú' }, 'emoji 🗺️', [1, true]]) assert.equal(h.api.estimateDataUsageBytes(value), bytes(value));
  const circular = {}; circular.self = circular;
  assert.equal(h.api.estimateDataUsageBytes(circular), 0);
});

test('primer flush inmediato y agrupación sin perder count/bytes del cooldown: un timer, no polling', () => {
  const h = harness();
  const payloads = [{ a: 'José' }, { b: '🗺️' }, { c: 'México' }];
  h.api.recordPanelDataUsage('PANEL_ACTIVITY_SEARCH_PAGE', { payload: payloads[0], scope: 'persona-ajena@example.test' });
  assert.equal(h.writes.length, 1);
  h.api.recordPanelDataUsage('PANEL_ACTIVITY_SEARCH_PAGE', { payload: payloads[1], records: 2 });
  h.api.recordPanelDataUsage('PANEL_ACTIVITY_SEARCH_PAGE', { payload: payloads[2], records: 3 });
  h.api.recordPanelDataUsage('PANEL_ACTIVITY_ROUTE_LOCATIONS', { payload: [1, 2] });
  assert.equal(h.writes.length, 1);
  assert.equal(h.timers.size, 1);
  h.advance(45_000);
  assert.equal(h.writes.length, 2, 'Todas las acciones del período en un único update');
  assert.equal(h.timers.size, 0, 'Sin timer recurrente vacío');
  const key = '2026-11-10/PANEL_ACTIVITY_SEARCH_PAGE';
  assert.deepEqual(h.writes[0].changes[`${key}/read_count`], { '.sv': { increment: 1 } });
  assert.deepEqual(h.writes[1].changes[`${key}/read_count`], { '.sv': { increment: 2 } });
  assert.deepEqual(h.writes[1].changes[`${key}/estimated_bytes`], { '.sv': { increment: bytes(payloads[1]) + bytes(payloads[2]) } });
  assert.equal(h.writes[1].changes[`${key}/last_records`], 3);
  assert.doesNotMatch(JSON.stringify(h.writes), /persona-ajena|José|México|🗺️/);
  h.advance(90_000);
  assert.equal(h.writes.length, 2);
});

test('bytes acumulados no se truncan; última lectura respeta límite 50 MB de las reglas existentes', () => {
  const h = harness();
  const measured = 60 * 1024 * 1024;
  h.api.recordPanelDataUsage('LARGE', { estimatedBytes: measured + 0.9 });
  const changes = h.writes[0].changes;
  assert.deepEqual(changes['2026-11-10/LARGE/estimated_bytes'], { '.sv': { increment: measured } });
  assert.equal(changes['2026-11-10/LARGE/last_estimated_bytes'], 50 * 1024 * 1024);
});

test('logout también elimina nombres y contribuyentes de un diagnóstico ya terminado', async () => {
  const h = harness();
  await h.load();
  assert.match(h.output(), /Ana María/);
  h.changeUser(null);
  assert.doesNotMatch(h.output(), /Ana María|persona@example.test|NodoTecnico|<table/);
  assert.equal(h.ids.dataUsageDiagnosticsSummary.innerHTML, '');
  assert.equal(h.ids.dataUsageDiagnosticsSection.style.display, 'none');
});

test('cola no mezcla cuentas, se cancela al logout y una nueva sesión mantiene primer envío inmediato', () => {
  const h = harness();
  const firstUser = h.auth.currentUser;
  h.api.recordPanelDataUsage('ONE', { payload: 'first' });
  h.api.recordPanelDataUsage('ONE', { payload: 'pending-personal-data' });
  assert.equal(h.api.state().queued, 1);
  h.changeUser(null);
  assert.equal(h.api.state().queued, 0);
  assert.equal(h.timers.size, 0);
  h.advance(45_000);
  assert.equal(h.writes.length, 1);
  h.changeUser(h.user('other-account'));
  h.api.recordPanelDataUsage('TWO', { payload: 'second' });
  assert.equal(h.writes.length, 2);
  assert.equal(h.writes[0].route, `users/${firstUser.uid}/data_usage_metrics`);
  assert.equal(h.writes[1].route, 'users/other-account/data_usage_metrics');
  assert.doesNotMatch(JSON.stringify(h.writes[1]), /ONE|pending-personal-data/);
});

test('cola mantiene días diferentes al cruzar medianoche sin suprimir eventos', () => {
  const h = harness();
  h.advance((12 * 60 * 60 * 1000) - 10_000);
  h.api.recordPanelDataUsage('SEARCH', { payload: 'first' });
  h.api.recordPanelDataUsage('SEARCH', { payload: 'pending-today' });
  h.advance(15_000);
  h.api.recordPanelDataUsage('SEARCH', { payload: 'pending-tomorrow' });
  h.advance(30_000);
  assert.equal(h.writes.length, 2);
  assert.ok(h.writes[1].changes['2026-11-10/SEARCH/read_count']);
  assert.ok(h.writes[1].changes['2026-11-11/SEARCH/read_count']);
});

test('etiquetas españolas explícitas para gráficos, mapa, búsquedas, exportación y diagnóstico', () => {
  const h = harness();
  assert.equal(h.api.dataUsageActionLabel('PANEL_ACTIVITY_GRAPHICS_RANGE'), 'Panel · Gráficos de actividades del período');
  assert.equal(h.api.dataUsageActionLabel('PANEL_ACTIVITY_ROUTE_LOCATIONS'), 'Panel · Ubicaciones para el mapa de rutas');
  assert.equal(h.api.dataUsageActionLabel('PANEL_ACTIVITY_SEARCH_PAGE'), 'Panel · Búsqueda paginada de actividades');
  assert.equal(h.api.dataUsageActionLabel('PANEL_ACTIVITY_EXPORT_RANGE'), 'Panel · Exportación de actividades por período');
  assert.equal(h.api.dataUsageActionLabel('PANEL_DATA_USAGE_DIAGNOSTICS'), 'Panel · Diagnóstico de descargas');
});
