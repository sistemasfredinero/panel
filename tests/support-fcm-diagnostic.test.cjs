'use strict';

// Funciones/constantes REALES de index.html en VM: sin SDK, red ni credenciales reales.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const html = readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const UID = '5dVKDIhQZlbzonMbSG9mX1pXHYg1';
const URL = 'https://fredinero-avisos.sistemas-fredinero.workers.dev/v1/diagnostics/fcm-check';
const TOKEN = 'FAKE_FIREBASE_JWT_NEVER_RENDER';
const SECRET = 'FAKE_PRIVATE_KEY_NEVER_RENDER';
const MALICIOUS = `<img src=x onerror="alert('${SECRET}')">`;
const BUTTON = 'Comprobar configuración de push';
const SUCCESS = 'Google aceptó la validación de FCM sin entregar mensajes. Esta prueba no confirma recepción en un celular ni activa avisos operativos.';
const GOOD = { ok: true, fcm_configuracion_validada: true, validacion_sin_entrega: true,
  envios_habilitados: false, avisos_productivos_habilitados: false, revocacion_consultada: false };
const encode = value => new TextEncoder().encode(JSON.stringify(value));
const plain = value => JSON.parse(JSON.stringify(value));
function realFunction(name, action = false) {
  const pattern = action
    ? `^  window\\.${name} = (?:async )?function\\([^\\n]*\\) \\{\\n[\\s\\S]*?^  \\};`
    : `^  (?:async )?function ${name}\\([^\\n]*\\) \\{\\n[\\s\\S]*?^  \\}`;
  const match = html.match(new RegExp(pattern, 'm'));
  assert.ok(match, `No se encontró función real: ${name}`);
  return match[0];
}
function declaration(kind, name) {
  const match = html.match(new RegExp(`^  ${kind} ${name} = [^\\n]+;`, 'm'));
  assert.ok(match, `No se encontró declaración real: ${name}`);
  return match[0];
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function flush() { for (let i = 0; i < 20; i++) await Promise.resolve(); }
function harness(t) {
  const calls = [], tokens = [], writes = [], forbidden = [], timers = new Map();
  let now = 0, nextTimer = 0;
  const hooks = {}, ids = {};
  const deny = name => () => { forbidden.push(name); throw new Error(`${name}: ${SECRET}`); };
  const blocked = name => new Proxy({}, { get: () => deny(name), set: () => { deny(name)(); return false; } });
  for (const id of ['supportFcmDiagnosticEntry', 'supportFcmDiagnosticButton', 'supportFcmDiagnosticStatus', 'supportFcmDiagnosticResult',
    'privacyAdminEntry', 'dataUsageAdminEntry', 'supportProfileAdminEntry', 'supportWorkerDiagnosticEntry']) {
    ids[id] = new Proxy({ style: {}, disabled: false, hidden: true, textContent: '' }, {
      set(target, key, value) {
        if (key === 'textContent' || key === 'innerHTML') writes.push({ id, key, value: String(value) });
        target[key] = value; return true;
      },
    });
  }
  ids.supportFcmDiagnosticEntry.style.display = 'none';
  const operator = { uid: UID, email: 'soporte@fredinero.com', getIdToken(...args) {
    tokens.push({ receiver: this, args }); return hooks.token ? hooks.token() : Promise.resolve(TOKEN);
  } };
  const auth = { currentUser: operator };
  function response({ status = 200, data = GOOD, raw, length, read, chunks } = {}) {
    let position = 0;
    const parts = chunks || [raw || encode(data)];
    const result = { ok: status >= 200 && status < 300, status, reads: 0, cancelled: 0, released: 0,
      headers: { get: () => length === undefined ? null : String(length) },
      json: deny('response.json (lectura sin límite)'), text: deny('response.text (lectura sin límite)'),
      body: { cancel: async () => { result.cancelled++; }, getReader: () => ({
        async read() {
          result.reads++;
          if (read) return read();
          return position < parts.length ? { value: parts[position++], done: false } : { done: true };
        },
        async cancel() { result.cancelled++; }, releaseLock() { result.released++; },
      }) },
    };
    return result;
  }
  const sandbox = { auth, AbortController, Uint8Array, TextDecoder,
    document: { getElementById: id => ids[id] || null },
    fetch(...args) { calls.push(args); return hooks.fetch ? hooks.fetch(...args) : Promise.resolve(response()); },
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { at: now + delay, callback }); return id; },
    clearTimeout(id) { timers.delete(id); },
    console: blocked('console'), localStorage: blocked('localStorage'), sessionStorage: blocked('sessionStorage'),
    indexedDB: blocked('indexedDB'), caches: blocked('caches'), database: blocked('database'), firebase: blocked('firebase'),
    navigator: { sendBeacon: deny('sendBeacon') },
  };
  Object.defineProperty(sandbox.document, 'cookie', { get: deny('cookie'), set: deny('cookie') });
  for (const name of ['ref', 'get', 'set', 'update', 'remove', 'push', 'query', 'runTransaction', 'onValue',
    'getDatabase', 'getAuth', 'initializeApp', 'recordPanelDataUsage', 'createUserWithEmailAndPassword',
    'signInWithEmailAndPassword', 'signOut', 'getMessaging', 'getToken', 'sendNotification', 'sendEmail',
    'sendMessage', 'checkSupportWorkerSession', 'sendSupportEmailTest', 'XMLHttpRequest', 'WebSocket',
    'EventSource', 'alert', 'prompt', 'confirm', 'setInterval', 'requestAnimationFrame']) sandbox[name] = deny(name);
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext([
    ...['SUPPORT_WORKER_UID', 'SUPPORT_FCM_URL', 'SUPPORT_FCM_MAX_BYTES', 'SUPPORT_FCM_TIMEOUT_MS', 'SUPPORT_FCM_ERROR_CODES'].map(n => declaration('const', n)),
    ...['_supportFcmRun', '_supportFcmBusy', '_supportFcmController'].map(n => declaration('let', n)),
    ...['privacyIsSupport', 'supportWorkerIsAuthorized', 'applyPrivacyAdminAccess', 'supportFcmMessage',
      'resetSupportFcmDiagnostic', 'supportFcmReadJson', 'supportFcmProjectResult', 'supportFcmErrorMessage'].map(n => realFunction(n)),
    realFunction('checkSupportFcmConfiguration', true),
    'globalThis.api = { resetSupportFcmDiagnostic, applyPrivacyAdminAccess, state: () => ({ run: _supportFcmRun, busy: _supportFcmBusy, controller: _supportFcmController }), timeout: SUPPORT_FCM_TIMEOUT_MS, max: SUPPORT_FCM_MAX_BYTES };',
  ].join('\n\n'), context, { filename: 'index.html:real-support-fcm-diagnostic' });
  const h = { auth, operator, hooks, ids, calls, tokens, writes, timers, response, api: context.api,
    check: () => sandbox.checkSupportFcmConfiguration(), reset: () => context.api.resetSupportFcmDiagnostic(),
    result: ids.supportFcmDiagnosticResult, status: ids.supportFcmDiagnosticStatus, button: ids.supportFcmDiagnosticButton,
    async tick(ms) { now += ms; for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); } await flush(); },
  };
  t.after(() => {
    assert.deepEqual(forbidden, [], 'No SDK, escrituras, storage, logs, polling ni otros canales');
    for (const write of writes) {
      assert.equal(write.key, 'textContent');
      for (const secret of [TOKEN, SECRET, MALICIOUS]) assert.ok(!write.value.includes(secret), `Dato sensible publicado en ${write.id}`);
    }
    assert.equal(timers.size, 0); assert.equal(h.api.state().busy, false);
    assert.equal(h.api.state().controller, null); assert.equal(h.button.disabled, false);
  });
  return h;
}
function empty(h) { assert.equal(h.result.textContent, ''); assert.equal(h.result.hidden, true); }
function failure(h, pattern) { empty(h); assert.match(h.status.textContent, pattern); assert.equal(h.status.style.color, '#B91C1C'); }
function success(h, expected = GOOD) {
  assert.equal(h.result.hidden, false); assert.deepEqual(JSON.parse(h.result.textContent), expected);
  assert.equal(h.status.textContent, SUCCESS); assert.equal(h.status.style.color, '#166534');
}

test('UID y correo de Authentication: perfil, roles o identidad local no habilitan HTTP', async t => {
  const h = harness(t);
  for (const user of [null, {}, { uid: UID }, { email: 'soporte@fredinero.com' },
    { uid: 'otro', email: 'soporte@fredinero.com' }, { uid: UID, email: 'otro@example.test' },
    { uid: ` ${UID}`, email: 'soporte@fredinero.com' }, { uid: UID, email: 'soporte@fredinero.com.evil' }]) {
    h.auth.currentUser = user && { ...user, getIdToken: h.operator.getIdToken };
    h.ids.supportProfileAdminEntry.rol = 'SOPORTE'; h.api.applyPrivacyAdminAccess(); await h.check();
    assert.equal(h.ids.supportFcmDiagnosticEntry.style.display, 'none'); empty(h);
  }
  assert.equal(h.tokens.length, 0); assert.equal(h.calls.length, 0);
  h.auth.currentUser = h.operator; h.operator.email = '  SOPORTE@FREDINERO.COM  ';
  await h.check(); success(h);
});

test('tarjeta consistente, accesible, oculta por defecto; visibilidad/reset/Auth no disparan diagnóstico', async t => {
  const h = harness(t);
  assert.match(html, /id="supportFcmDiagnosticEntry"[^>]*style="display:none/);
  assert.match(html, /id="supportFcmDiagnosticButton"[^>]*type="button"[^>]*onclick="window\.checkSupportFcmConfiguration\(\)"/);
  assert.match(html, /id="supportFcmDiagnosticStatus"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.ok(html.includes('Valida la clave del servidor y sus permisos en Google; no entrega notificaciones ni descarga registros.'));
  assert.equal([...html.matchAll(/\bcheckSupportFcmConfiguration\b/g)].length, 2);
  assert.match(html, /onAuthStateChanged\(auth, async \(user\) => \{\s*resetSupportWorkerDiagnostic\(\);\s*resetSupportEmailTest\(\);\s*resetSupportFcmDiagnostic\(\);/);
  h.api.applyPrivacyAdminAccess(); assert.equal(h.ids.supportFcmDiagnosticEntry.style.display, '');
  h.reset(); await h.tick(60000); assert.equal(h.calls.length, 0); assert.equal(h.tokens.length, 0);
});

test('GET fijo sin query/cuerpo: un getIdToken(false), Bearer sólo en Authorization, sin tokens de dispositivos', async t => {
  const h = harness(t); await h.check(); success(h);
  assert.equal(h.calls.length, 1); assert.equal(h.tokens.length, 1);
  assert.deepEqual(h.tokens[0].args, [false]); assert.equal(h.tokens[0].receiver, h.operator);
  const [url, options] = h.calls[0]; assert.equal(url, URL);
  assert.deepEqual(Object.keys(options).sort(), ['method', 'headers', 'credentials', 'cache', 'redirect', 'referrerPolicy', 'signal'].sort());
  assert.deepEqual(plain(options.headers), { Authorization: `Bearer ${TOKEN}` });
  for (const [key, value] of Object.entries({ method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer' })) assert.equal(options[key], value);
  assert.ok(options.signal instanceof AbortSignal); assert.equal(options.signal.aborted, false);
});

test('éxito proyecta sólo seis flags y dos booleanos opcionales, nunca valores del proveedor', async t => {
  const h = harness(t); const expected = { ...GOOD, secreto_presente: true, estructura_valida: true };
  h.hooks.fetch = async () => h.response({ data: { ...expected, token: TOKEN, secret: SECRET,
    message: MALICIOUS, provider: { detalle: SECRET }, project_id: MALICIOUS, client_email: SECRET } });
  await h.check(); success(h, expected);
  assert.ok(Object.values(JSON.parse(h.result.textContent)).every(v => typeof v === 'boolean'));
});

test('doble clic durante token/fetch/body: un solo token y una petición', async t => {
  const h = harness(t), token = deferred(), fetched = deferred(), chunk = deferred();
  h.hooks.token = () => token.promise; h.hooks.fetch = () => fetched.promise;
  const pending = h.check(); await h.check(); assert.equal(h.tokens.length, 1);
  token.resolve(TOKEN); await flush(); await h.check(); assert.equal(h.calls.length, 1);
  let read = 0; fetched.resolve(h.response({ read: () => ++read === 1 ? chunk.promise : Promise.resolve({ done: true }) }));
  await flush(); await h.check(); assert.equal(h.calls.length, 1); assert.equal(h.tokens.length, 1);
  chunk.resolve({ value: encode(GOOD), done: false }); await pending; success(h);
});

test('nueve códigos de error conocidos tienen mensajes locales; códigos arbitrarios usan fallback', async t => {
  const cases = [
    ['FCM_CONFIG_INVALID', /GOOGLE_FCM_SERVICE_ACCOUNT_JSON.*fredinero-avisos-worker@fredineroappasistencia\.iam\.gserviceaccount\.com/],
    ['OAUTH_REJECTED', /clave siga vigente.*cuenta de servicio esté habilitada.*Si la clave fue revocada/], ['OAUTH_UNAVAILABLE', /temporalmente/],
    ['FCM_REJECTED', /API esté habilitada.*Firebase Cloud Messaging API Admin.*roles\/firebasecloudmessaging\.admin/],
    ['SESION_RECIENTE_REQUERIDA', /cierra sesión.*cinco minutos/], ['SESION_INVALIDA', /cierra sesión.*cinco minutos/],
    ['SOLO_SOPORTE', /UID y correo de Soporte/], ['CONFIGURACION_AUTH_INCOMPLETA', /configuración de autenticación/],
    ['RUTA_NO_DISPONIBLE', /preparación-4.*preparación-3/], [MALICIOUS, /No se pudo comprobar/],
  ];
  for (const [codigo, pattern] of cases) {
    const h = harness(t); h.hooks.fetch = async () => h.response({ status: 502, data: { codigo, message: MALICIOUS, secret: SECRET } });
    await h.check(); failure(h, pattern); await h.tick(60000); assert.equal(h.calls.length, 1);
  }
});

test('JWT vigente pero auth_time antiguo: 401 exige logout/login en cinco minutos, nunca force refresh', async t => {
  for (const data of [{ codigo: 'SESION_RECIENTE_REQUERIDA' }, { codigo: 'DESCONOCIDO' }, null]) {
    const h = harness(t); h.hooks.fetch = async () => h.response({ status: 401, data });
    await h.check(); failure(h, /cierra sesión.*vuelve a entrar.*cinco minutos.*renovar el token no sustituye/);
    assert.deepEqual(h.tokens.map(v => v.args), [[false]]); assert.equal(h.calls.length, 1);
  }
  const h = harness(t); h.hooks.fetch = async () => h.response({ status: 401, raw: new TextEncoder().encode(MALICIOUS) });
  await h.check(); failure(h, /cierra sesión.*cinco minutos/);
});

test('404 del Worker anterior pide preparación-4; otros HTTP desconocidos nunca confirman éxito', async t => {
  for (const status of [404, 403, 429, 500, 503]) {
    const h = harness(t); h.hooks.fetch = async () => h.response({ status, data: { ...GOOD, codigo: SECRET } });
    await h.check(); failure(h, status === 404 ? /preparación-4.*preparación-3/ : /No se pudo comprobar/);
  }
});

test('rechaza JSON malformado, flags falsos/ausentes/no booleanos y opcionales con secretos', async t => {
  const bodies = [null, {}, [], 'ok', { ...GOOD, secreto_presente: SECRET }, { ...GOOD, estructura_valida: MALICIOUS }];
  for (const [key, value] of Object.entries(GOOD)) {
    const missing = { ...GOOD }; delete missing[key]; bodies.push(missing, { ...GOOD, [key]: !value }, { ...GOOD, [key]: String(value) });
  }
  for (const data of bodies) {
    const h = harness(t); h.hooks.fetch = async () => h.response({ data }); await h.check(); failure(h, /no confirmó.*sin entregas/);
  }
  const h = harness(t); h.hooks.fetch = async () => h.response({ raw: new TextEncoder().encode(MALICIOUS) });
  await h.check(); failure(h, /no confirmó.*sin entregas/);
});

test('límite real de 8 KiB con Content-Length, sin él y UTF-8 inválido; cancela y no usa json/text ilimitados', async t => {
  for (const opts of [{ length: 8193 }, { raw: new Uint8Array(8193) },
    { chunks: [new Uint8Array(4096), new Uint8Array(4097)] }, { raw: new Uint8Array([255]) }]) {
    const h = harness(t), response = h.response(opts); h.hooks.fetch = async () => response;
    await h.check(); failure(h, /no confirmó/); assert.equal(h.api.max, 8192); assert.equal(response.cancelled, 1);
    if (opts.length) assert.equal(response.reads, 0);
  }
  const h = harness(t), bytes = encode(GOOD), raw = new Uint8Array(8192); raw.fill(32); raw.set(bytes);
  h.hooks.fetch = async () => h.response({ raw }); await h.check(); success(h);
});

test('red/CORS y token fallidos no reflejan errores, no reintentan; recuperación sólo manual', async t => {
  for (const stage of ['token', 'fetch']) {
    const h = harness(t); h.hooks[stage] = async () => { throw new Error(`${TOKEN} ${SECRET} ${MALICIOUS}`); };
    await h.check(); failure(h, /Internet.*CORS/); await h.tick(60000);
    assert.equal(h.tokens.length, 1); assert.equal(h.calls.length, stage === 'token' ? 0 : 1);
    delete h.hooks[stage]; await h.check(); success(h);
  }
});

test('deadline de 25 s incluye token; resolución tardía no inicia HTTP y permite nueva comprobación', async t => {
  const h = harness(t), gate = deferred(); h.hooks.token = () => gate.promise;
  const pending = h.check(), controller = h.api.state().controller;
  assert.equal(h.api.timeout, 25000); await h.tick(24999); assert.equal(h.button.disabled, true);
  await h.tick(1); await pending; failure(h, /tiempo de espera/); assert.equal(controller.signal.aborted, true);
  gate.resolve(TOKEN); await flush(); assert.equal(h.calls.length, 0);
  delete h.hooks.token; await h.check(); success(h);
});

test('deadline cubre fetch/body que ignoran abort: no salida tardía y recuperación inmediata', async t => {
  for (const stage of ['fetch', 'body']) {
    const h = harness(t), gate = deferred();
    h.hooks.fetch = stage === 'fetch' ? () => gate.promise : async () => h.response({ read: () => gate.promise });
    const pending = h.check(); await flush(); const signal = h.calls[0][1].signal;
    await h.tick(25000); await pending; failure(h, /tiempo de espera/); assert.equal(signal.aborted, true);
    delete h.hooks.fetch; await h.check(); success(h); const writes = h.writes.length;
    gate.resolve(stage === 'fetch' ? h.response() : { value: encode(GOOD), done: false }); await flush();
    assert.equal(h.writes.length, writes); assert.equal(h.calls.length, 2);
  }
});

test('cambio de usuario/logout antes de cada await impide HTTP/body/salida obsoletos incluso errores', async t => {
  for (const stage of ['token', 'fetch', 'body']) for (const change of ['replacement', 'uid', 'email', 'logout']) for (const reject of [false, true]) {
    const h = harness(t), gate = deferred();
    if (stage === 'token') h.hooks.token = () => gate.promise;
    if (stage === 'fetch') h.hooks.fetch = () => gate.promise;
    if (stage === 'body') h.hooks.fetch = async () => h.response({ read: () => gate.promise });
    const pending = h.check(); await flush();
    if (change === 'replacement') h.auth.currentUser = { ...h.operator };
    if (change === 'uid') h.operator.uid = 'otro'; if (change === 'email') h.operator.email = 'otro@example.test';
    if (change === 'logout') h.auth.currentUser = null;
    const writes = h.writes.length;
    if (reject) gate.reject(new Error(`${TOKEN} ${SECRET}`));
    else gate.resolve(stage === 'token' ? TOKEN : stage === 'fetch' ? h.response() : { done: true });
    await pending; empty(h); assert.equal(h.calls.length, stage === 'token' ? 0 : 1);
    assert.ok(h.writes.slice(writes).every(w => w.id === 'supportFcmDiagnosticButton'));
  }
});

test('logout/reset cancela race aunque transporte no termine y limpia todo sin resultado tardío', async t => {
  for (const stage of ['token', 'fetch', 'body']) {
    const h = harness(t), gate = deferred(); await h.check(); success(h); h.reset();
    if (stage === 'token') h.hooks.token = () => gate.promise;
    if (stage === 'fetch') h.hooks.fetch = () => gate.promise;
    if (stage === 'body') h.hooks.fetch = async () => h.response({ read: () => gate.promise });
    const pending = h.check(); await flush(); const controller = h.api.state().controller;
    h.auth.currentUser = null; h.reset(); await pending;
    assert.equal(controller.signal.aborted, true); assert.equal(h.status.textContent, ''); empty(h);
    assert.equal(h.ids.supportFcmDiagnosticEntry.style.display, 'none'); assert.equal(h.button.textContent, BUTTON);
    const writes = h.writes.length;
    gate.resolve(stage === 'token' ? TOKEN : stage === 'fetch' ? h.response() : { done: true }); await flush();
    assert.equal(h.writes.length, writes);
  }
});

test('reset permite nueva solicitud: finally viejo no altera busy/controlador/timer ni mezcla diagnósticos', async t => {
  const h = harness(t), old = deferred(), current = deferred();
  h.hooks.fetch = () => h.calls.length === 1 ? old.promise : current.promise;
  const first = h.check(); await flush(); h.reset(); const second = h.check(); await flush();
  const controller = h.api.state().controller; await first;
  old.reject(new Error(`${TOKEN} ${SECRET}`)); await flush();
  assert.equal(h.api.state().controller, controller); assert.equal(h.api.state().busy, true);
  assert.equal(h.button.disabled, true); assert.equal(h.timers.size, 1); await h.check(); assert.equal(h.calls.length, 2);
  current.resolve(h.response()); await second; success(h);
});

test('ReadableStream real admite JSON dividido; cuerpo ausente o AbortError fallan sin exponer datos', async t => {
  const h = harness(t), bytes = encode(GOOD);
  h.hooks.fetch = async () => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(bytes.subarray(0, 20)); controller.enqueue(bytes.subarray(20)); controller.close();
  } }), { status: 200 });
  await h.check(); success(h);
  h.hooks.fetch = async () => new Response(null, { status: 200 });
  await h.check(); failure(h, /no confirmó/);
  h.hooks.fetch = async () => { const error = new Error(`${TOKEN} ${SECRET}`); error.name = 'AbortError'; throw error; };
  await h.check(); failure(h, /tiempo de espera/); await h.tick(60000); assert.equal(h.calls.length, 3);
});
