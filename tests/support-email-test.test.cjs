'use strict';

// Sólo funciones/constantes REALES de index.html, aisladas mediante VM.
// Sin navegador, SDK, red, credenciales reales ni dependencias externas.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const html = readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const EXPECTED_UID = '5dVKDIhQZlbzonMbSG9mX1pXHYg1';
const EXPECTED_URL = 'https://fredinero-avisos.sistemas-fredinero.workers.dev/v1/diagnostics/email-test';
const TOKEN = 'TEST_ONLY_BEARER_TOKEN_NEVER_RENDER';
const SECRET = 're_TEST_ONLY_FAKE_KEY_NEVER_RENDER';
const MALICIOUS = `<img src=x onerror="alert('${SECRET}')">`;
const GOOD = Object.freeze({
  ok: true, prueba_correo_aceptada: true, destinatario: 'soporte@fredinero.com',
  avisos_productivos_habilitados: false, revocacion_consultada: false,
});
const BUTTON_TEXT = 'Enviar correo de prueba a soporte@fredinero.com';
const plain = value => JSON.parse(JSON.stringify(value));

function realFunction(name) {
  const match = html.match(new RegExp(`^  (?:async )?function ${name}\\([^\\n]*\\) \\{(?:[^\\n]*\\}$|\\n[\\s\\S]*?^  \\})`, 'm'));
  assert.ok(match, `Función real no encontrada: ${name}`);
  return match[0];
}

function realWindowFunction(name) {
  const match = html.match(new RegExp(`^  window\\.${name} = (?:async )?function\\([^\\n]*\\) \\{(?:[^\\n]*\\};$|\\n[\\s\\S]*?^  \\};)`, 'm'));
  assert.ok(match, `Acción real no encontrada: ${name}`);
  return match[0];
}

function realDeclaration(kind, name) {
  const match = html.match(new RegExp(`^  ${kind} ${name} = [^\\n]+;`, 'm'));
  assert.ok(match, `Declaración real no encontrada: ${name}`);
  return match[0];
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function flush() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

function fakeClock() {
  let now = 0, nextId = 0;
  const pending = new Map();
  return {
    setTimeout(callback, milliseconds) {
      assert.equal(typeof callback, 'function');
      assert.ok(Number.isFinite(milliseconds) && milliseconds >= 0);
      const id = ++nextId;
      pending.set(id, { at: now + milliseconds, callback });
      return id;
    },
    clearTimeout(id) { pending.delete(id); },
    async tick(milliseconds) {
      const target = now + milliseconds;
      while (true) {
        const next = [...pending.entries()].filter(([, job]) => job.at <= target)
          .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!next) break;
        now = next[1].at;
        pending.delete(next[0]);
        next[1].callback();
        await flush();
      }
      now = target;
      await flush();
    },
    size: () => pending.size,
  };
}

function harness(t, { user, hooks = {} } = {}) {
  const forbidden = [], domWrites = [], tokenCalls = [], fetchCalls = [], jsonCalls = [];
  const clock = fakeClock();
  const deny = name => () => {
    forbidden.push(name);
    throw new Error(`Operación prohibida en prueba de correo: ${name}`);
  };
  const blockedObject = label => new Proxy(Object.create(null), {
    get: (_target, key) => deny(`${label}.${String(key)}`),
    set: (_target, key) => { deny(`${label}.${String(key)}=`)(); return false; },
  });
  function node(id) {
    return new Proxy({ disabled: false, hidden: false, style: {}, textContent: '', innerHTML: '' }, {
      set(target, key, value) {
        if (key === 'textContent' || key === 'innerHTML') domWrites.push({ id, key, value: String(value) });
        target[key] = value;
        return true;
      },
    });
  }
  const ids = Object.fromEntries([
    'supportEmailTestButton', 'supportEmailTestStatus', 'supportEmailTestResult',
    'supportWorkerDiagnosticEntry', 'privacyAdminEntry', 'dataUsageAdminEntry', 'supportProfileAdminEntry',
  ].map(id => [id, node(id)]));
  ids.supportEmailTestResult.hidden = true;
  ids.supportEmailTestButton.textContent = BUTTON_TEXT;
  ids.supportWorkerDiagnosticEntry.style.display = 'none';
  const operator = {
    uid: EXPECTED_UID, email: 'soporte@fredinero.com',
    getIdToken(...args) {
      tokenCalls.push({ receiver: this, args });
      return hooks.token ? hooks.token(...args) : Promise.resolve(TOKEN);
    },
  };
  const auth = { currentUser: user === undefined ? operator : user };
  for (const name of ['signOut', 'signInWithEmailAndPassword', 'createUserWithEmailAndPassword']) auth[name] = deny(`auth.${name}`);
  function response({ status = 200, body = GOOD, jsonError, jsonHook } = {}) {
    return {
      ok: status >= 200 && status < 300, status,
      async json() {
        jsonCalls.push(status);
        if (jsonError) throw jsonError;
        return jsonHook ? jsonHook() : body;
      },
      text: deny('response.text'),
    };
  }
  const sandbox = {
    auth, AbortController, // AbortController REAL de Node; solamente se falsea el reloj.
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    document: { getElementById: id => ids[id] || null },
    fetch(...args) {
      fetchCalls.push(args);
      return hooks.fetch ? hooks.fetch(...args) : Promise.resolve(response());
    },
    console: blockedObject('console'),
    localStorage: blockedObject('localStorage'), sessionStorage: blockedObject('sessionStorage'),
    indexedDB: blockedObject('indexedDB'), caches: blockedObject('caches'),
    database: blockedObject('database'), firebase: blockedObject('firebase'),
    navigator: { sendBeacon: deny('sendBeacon') },
  };
  Object.defineProperty(sandbox.document, 'cookie', {
    get: deny('document.cookie:read'), set: deny('document.cookie:write'),
  });
  for (const name of [
    'ref', 'get', 'set', 'update', 'remove', 'push', 'runTransaction', 'query',
    'onValue', 'getDatabase', 'getAuth', 'initializeApp', 'recordPanelDataUsage',
    'createUserWithEmailAndPassword', 'signInWithEmailAndPassword', 'signOut',
    'sendPasswordResetEmail', 'sendEmailVerification', 'fetchSignInMethodsForEmail',
    'getFunctions', 'httpsCallable', 'getMessaging', 'getToken', 'send', 'sendMessage',
    'sendNotification', 'sendEmail', 'sendAvisos', 'enviarAvisos', 'enviarNotificacion',
    'checkSupportWorkerSession', 'XMLHttpRequest', 'WebSocket', 'EventSource',
    'alert', 'prompt', 'confirm', 'open', 'setInterval', 'requestAnimationFrame',
  ]) sandbox[name] = deny(name);
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext([
    ...['SUPPORT_WORKER_UID', 'SUPPORT_EMAIL_TEST_URL'].map(name => realDeclaration('const', name)),
    ...['_supportEmailTestRun', '_supportEmailTestBusy', '_supportEmailTestAccepted', '_supportEmailTestController']
      .map(name => realDeclaration('let', name)),
    ...['privacyIsSupport', 'supportWorkerIsAuthorized', 'applyPrivacyAdminAccess',
      'supportEmailTestMessage', 'resetSupportEmailTest'].map(realFunction),
    realWindowFunction('sendSupportEmailTest'),
    'globalThis.api = { supportWorkerIsAuthorized, applyPrivacyAdminAccess, supportEmailTestMessage, resetSupportEmailTest, uid: SUPPORT_WORKER_UID, url: SUPPORT_EMAIL_TEST_URL, state: () => ({ run: _supportEmailTestRun, busy: _supportEmailTestBusy, accepted: _supportEmailTestAccepted, controller: _supportEmailTestController }) };',
  ].join('\n\n'), context, { filename: 'index.html:real-support-email-test' });
  const h = {
    api: context.api, window: sandbox, auth, operator, ids, clock, hooks,
    forbidden, domWrites, tokenCalls, fetchCalls, jsonCalls, response,
    send: () => sandbox.sendSupportEmailTest(),
    reset: () => context.api.resetSupportEmailTest(),
    result: ids.supportEmailTestResult, status: ids.supportEmailTestStatus, button: ids.supportEmailTestButton,
  };
  t.after(() => {
    assert.deepEqual(forbidden, [], 'Sin Firebase, escrituras, consola, storage, diagnóstico auxiliar ni otros canales');
    for (const write of domWrites) {
      for (const sensitive of [TOKEN, SECRET, MALICIOUS]) {
        assert.ok(!write.value.includes(sensitive), `${write.id}/${write.key}: nunca publicar secretos ni transitoriamente`);
      }
      assert.equal(write.key, 'textContent', 'No interpretar HTML en mensajes/resultados');
    }
    assert.equal(clock.size(), 0, 'No quedan timers pendientes');
    assert.equal(h.api.state().busy, false);
    assert.equal(h.api.state().controller, null);
    assert.equal(h.button.disabled, h.api.state().accepted, 'Sólo la aceptación conserva el botón deshabilitado');
  });
  return h;
}

function assertEmpty(h) {
  assert.equal(h.result.textContent, '');
  assert.equal(h.result.hidden, true);
}

function assertFailure(h, message) {
  assertEmpty(h);
  assert.match(h.status.textContent, message);
  assert.doesNotMatch(h.status.textContent, /Resend aceptó la prueba/);
  assert.equal(h.status.style.color, '#B91C1C');
  assert.equal(h.api.state().accepted, false);
  assert.equal(h.button.disabled, false);
}

function assertSuccess(h) {
  assert.equal(h.result.hidden, false);
  const result = JSON.parse(h.result.textContent);
  assert.deepEqual(result, GOOD, 'Lista cerrada de cinco campos: cuatro flags booleanos y destinatario fijo');
  for (const key of ['ok', 'prueba_correo_aceptada', 'avisos_productivos_habilitados', 'revocacion_consultada']) {
    assert.equal(typeof result[key], 'boolean');
  }
  assert.match(h.status.textContent, /Resend aceptó la prueba/);
  assert.match(h.status.textContent, /no garantiza.*entregado/);
  assert.equal(h.status.style.color, '#166534');
  assert.equal(h.api.state().accepted, true);
  assert.equal(h.button.disabled, true);
  assert.equal(h.button.textContent, 'Prueba aceptada por Resend');
}

test('exige UID exacto Y correo Auth normalizado; identidad local o rol nunca suplantan Auth', async t => {
  const h = harness(t);
  assert.equal(h.api.uid, EXPECTED_UID);
  h.window.currentUser = { ...h.operator, rol: 'SOPORTE' };
  h.window.currentUserRole = 'SOPORTE';
  h.window._panelProfile = { uid: EXPECTED_UID, email: 'soporte@fredinero.com', rol: 'SOPORTE' };
  const rejected = [
    null, {}, { uid: EXPECTED_UID }, { email: 'soporte@fredinero.com' },
    { uid: EXPECTED_UID, email: 'otro@example.test' },
    { uid: 'otro-uid', email: 'soporte@fredinero.com' },
    { uid: EXPECTED_UID.toLowerCase(), email: 'soporte@fredinero.com' },
    { uid: ` ${EXPECTED_UID}`, email: 'soporte@fredinero.com' },
    { uid: EXPECTED_UID, email: 'soporte@fredinero.com.evil.test' },
    { uid: EXPECTED_UID, email: '' }, { uid: EXPECTED_UID, rol: 'SOPORTE' },
  ];
  for (const user of rejected) {
    h.auth.currentUser = user && { ...user, getIdToken: h.operator.getIdToken };
    assert.equal(h.api.supportWorkerIsAuthorized(), false, JSON.stringify(user));
    h.api.applyPrivacyAdminAccess();
    assert.equal(h.ids.supportWorkerDiagnosticEntry.style.display, 'none');
    await h.send();
    assertEmpty(h);
  }
  assert.equal(h.tokenCalls.length, 0);
  assert.equal(h.fetchCalls.length, 0);
  assert.equal(h.clock.size(), 0);
});

test('acepta el correo Auth de Soporte normalizado sin relajar el UID', async t => {
  for (const email of ['soporte@fredinero.com', '  SOPORTE@FREDINERO.COM  ']) {
    const h = harness(t);
    h.operator.email = email;
    assert.equal(h.api.supportWorkerIsAuthorized(), true);
    await h.send();
    assertSuccess(h);
    assert.equal(h.tokenCalls.length, 1);
    assert.equal(h.fetchCalls.length, 1);
  }
});

test('sólo clic explícito: carga, visibilidad, reset y reloj no obtienen token ni envían', async t => {
  const h = harness(t);
  assert.match(html, /id="supportEmailTestButton"[^>]*type="button"[^>]*onclick="window\.sendSupportEmailTest\(\)"/);
  assert.match(html, /id="supportEmailTestStatus"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /id="supportEmailTestResult"[^>]*hidden/);
  const mentions = [...html.matchAll(/\bsendSupportEmailTest\b/g)];
  assert.equal(mentions.length, 2, 'Sólo definición de acción y onclick, sin llamada de inicio/Auth');
  for (let i = 0; i < 3; i++) {
    h.api.applyPrivacyAdminAccess();
    h.reset();
  }
  await h.clock.tick(60000);
  assert.equal(h.tokenCalls.length, 0);
  assert.equal(h.fetchCalls.length, 0);
  assert.equal(h.status.textContent, '');
  assertEmpty(h);
});

test('mensajes locales usan texto y colores; toleran nodo ausente sin efectos laterales', t => {
  const h = harness(t);
  h.api.supportEmailTestMessage('Estado informativo');
  assert.equal(h.status.textContent, 'Estado informativo');
  assert.equal(h.status.style.color, '#166534');
  h.api.supportEmailTestMessage('Error controlado', true);
  assert.equal(h.status.textContent, 'Error controlado');
  assert.equal(h.status.style.color, '#B91C1C');
  delete h.ids.supportEmailTestStatus;
  assert.doesNotThrow(() => h.api.supportEmailTestMessage('Sin nodo', true));
  assert.equal(h.fetchCalls.length, 0);
});

test('POST HTTPS fijo, cuerpo de confirmación exacto y token sólo en Authorization; sin envíos auxiliares', async t => {
  const h = harness(t);
  h.hooks.fetch = async () => h.response({ body: {
    ...GOOD, token: TOKEN, secret: SECRET, message: MALICIOUS,
    upstream: { key: SECRET, html: MALICIOUS, email: 'privado@example.test' },
  } });
  await h.send();
  assertSuccess(h);
  assert.equal(h.tokenCalls.length, 1);
  assert.equal(h.tokenCalls[0].receiver, h.operator);
  assert.deepEqual(h.tokenCalls[0].args, []);
  assert.equal(h.fetchCalls.length, 1);
  const [url, options] = h.fetchCalls[0];
  assert.equal(h.api.url, EXPECTED_URL);
  assert.equal(url, EXPECTED_URL);
  const parsed = new URL(url);
  assert.equal(parsed.protocol, 'https:');
  assert.equal(parsed.search + parsed.hash + parsed.username + parsed.password, '');
  assert.ok(!url.includes(TOKEN));
  assert.deepEqual(Object.keys(options).sort(), ['method', 'headers', 'body', 'credentials', 'cache', 'redirect', 'referrerPolicy', 'signal'].sort());
  assert.deepEqual(plain(options.headers), { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' });
  assert.equal(options.method, 'POST');
  assert.equal(options.body, JSON.stringify({ confirmacion: 'ENVIAR_PRUEBA_SOPORTE' }));
  assert.deepEqual(JSON.parse(options.body), { confirmacion: 'ENVIAR_PRUEBA_SOPORTE' });
  assert.ok(!options.body.includes(TOKEN));
  assert.equal(options.credentials, 'omit');
  assert.equal(options.redirect, 'error');
  assert.equal(options.cache, 'no-store');
  assert.equal(options.referrerPolicy, 'no-referrer');
  assert.ok(options.signal instanceof AbortSignal);
  assert.equal(options.signal.aborted, false);
  assert.equal(h.jsonCalls.length, 1);
  assert.doesNotMatch(h.result.textContent, /token|secret|message|upstream|privado@example\.test|<img/);
});

test('aceptación bloquea nuevos intentos en esta sesión incluso por llamada directa, sin persistencia local', async t => {
  const h = harness(t);
  await h.send();
  assertSuccess(h);
  const writes = h.domWrites.length;
  for (let i = 0; i < 3; i++) await h.send();
  await h.clock.tick(120000);
  assert.equal(h.tokenCalls.length, 1);
  assert.equal(h.fetchCalls.length, 1);
  assert.equal(h.domWrites.length, writes);
  assertSuccess(h);
  // La idempotencia frente a recargas pertenece al servidor: no se simula con storage.
});

test('doble clic mientras espera token, fetch o body sólo obtiene un token y hace un POST', async t => {
  const token = deferred(), fetched = deferred(), body = deferred();
  const h = harness(t, { hooks: { token: () => token.promise, fetch: () => fetched.promise } });
  const pending = h.send();
  assert.equal(h.api.state().busy, true);
  assert.equal(h.button.disabled, true);
  assert.equal(h.button.textContent, 'Enviando prueba…');
  await h.send();
  assert.equal(h.tokenCalls.length, 1);
  assert.equal(h.fetchCalls.length, 0);
  token.resolve(TOKEN);
  await flush();
  await h.send();
  assert.equal(h.fetchCalls.length, 1);
  fetched.resolve(h.response({ jsonHook: () => body.promise }));
  await flush();
  await h.send();
  assert.equal(h.jsonCalls.length, 1);
  assert.equal(h.tokenCalls.length, 1);
  assert.equal(h.fetchCalls.length, 1);
  body.resolve(GOOD);
  await pending;
  assertSuccess(h);
});

const httpCases = [
  { status: 401, codigo: 'SESION_RECIENTE_REQUERIDA', message: /cierra sesión.*cinco minutos/ },
  { status: 401, codigo: 'DESCONOCIDO', message: /cierra sesión.*cinco minutos/ },
  { status: 403, codigo: 'DESCONOCIDO', message: /Acceso rechazado.*origen permitido/ },
  { status: 410, codigo: 'PRUEBA_VENCIDA', message: /ventana.*venció.*No cambies la clave idempotente/ },
  { status: 410, codigo: 'DESCONOCIDO', message: /ventana.*venció/ },
  { status: 503, codigo: 'PRUEBA_DESACTIVADA', message: /desactivada.*SUPPORT_EMAIL_TEST_ENABLED.*Text.*true/ },
  { status: 503, codigo: 'CONFIGURACION_PRUEBA_INCOMPLETA', message: /Falta completar la configuración.*Conserva los secretos fuera/ },
  { status: 503, codigo: 'ENVIOS_NO_IMPLEMENTADOS', message: /Worker preparación-3/ },
  { status: 503, codigo: 'DESCONOCIDO', message: /Worker preparación-3/ },
  { status: 404, codigo: 'DESCONOCIDO', message: /Worker preparación-3/ },
  { status: 429, codigo: 'PRUEBA_EN_PROCESO_O_LIMITADA', message: /en proceso.*reintento manual de la misma operación/ },
  { status: 502, codigo: 'PROVEEDOR_RECHAZO_PRUEBA', message: /Resend rechazó.*no compartas la clave/ },
  { status: 502, codigo: 'RESULTADO_ENVIO_NO_CONFIRMADO', message: /podría haber sido aceptado.*No habrá reintentos automáticos/ },
  { status: 502, codigo: 'DESCONOCIDO', message: /podría haber sido aceptado.*No habrá reintentos automáticos/ },
  { status: 500, codigo: `${TOKEN} ${SECRET} ${MALICIOUS}`, message: /No se pudo confirmar el resultado/ },
];
for (const { status, codigo, message } of httpCases) {
  test(`HTTP ${status} / ${codigo.includes(SECRET) ? 'código malicioso' : codigo}: mensaje local sin reflejar upstream ni reintentar`, async t => {
    const h = harness(t);
    h.hooks.fetch = async () => h.response({ status, body: {
      ...GOOD, codigo, error: `${TOKEN} ${SECRET} ${MALICIOUS}`,
      message: MALICIOUS, provider: { api_key: SECRET },
    } });
    await h.send();
    assertFailure(h, message);
    await h.clock.tick(60000);
    assert.equal(h.fetchCalls.length, 1);
    assert.equal(h.tokenCalls.length, 1);
    assert.equal(h.jsonCalls.length, 1);
  });
}

test('respuesta aceptada exige todos los campos, tipos y destinatario exactos; producción nunca se activa', async t => {
  const bodies = [null, {}, [], 'aceptado', { ...GOOD, destinatario: 'otro@example.test' },
    { ...GOOD, destinatario: 'SOPORTE@FREDINERO.COM' }];
  for (const [key, value] of Object.entries(GOOD)) {
    const missing = { ...GOOD }; delete missing[key];
    bodies.push(missing, { ...GOOD, [key]: null });
    if (typeof value === 'boolean') bodies.push({ ...GOOD, [key]: !value }, { ...GOOD, [key]: String(value) }, { ...GOOD, [key]: Number(value) });
  }
  for (const body of bodies) {
    const h = harness(t);
    h.hooks.fetch = async () => h.response({ body });
    await h.send();
    assertFailure(h, /No se pudo confirmar el resultado.*podría haber sido aceptado/);
    assert.equal(h.fetchCalls.length, 1);
  }
});

test('JSON inválido con clave ficticia en el error nunca se publica', async t => {
  const h = harness(t);
  h.hooks.fetch = async () => h.response({ jsonError: new SyntaxError(`Unexpected token ${TOKEN} ${SECRET} ${MALICIOUS}`) });
  await h.send();
  assertFailure(h, /No se pudo confirmar el resultado/);
  assert.equal(h.jsonCalls.length, 1);
});

test('getIdToken fallido no hace fetch ni publica su error', async t => {
  const h = harness(t, { hooks: { token: async () => { throw new Error(`${TOKEN} ${SECRET} ${MALICIOUS}`); } } });
  await h.send();
  assertFailure(h, /No se pudo confirmar el resultado/);
  assert.equal(h.tokenCalls.length, 1);
  assert.equal(h.fetchCalls.length, 0);
  await h.clock.tick(60000);
  assert.equal(h.tokenCalls.length, 1);
});

test('error de red con clave ficticia no llega al DOM; sólo reintento manual', async t => {
  const h = harness(t, { hooks: { fetch: async () => { throw new Error(`CORS ${TOKEN} ${SECRET} ${MALICIOUS}`); } } });
  await h.send();
  assertFailure(h, /podría haber sido aceptado.*No habrá reintentos automáticos/);
  await h.clock.tick(60000);
  assert.equal(h.fetchCalls.length, 1);
  h.hooks.fetch = async () => h.response();
  await h.send();
  assert.equal(h.tokenCalls.length, 2);
  assert.equal(h.fetchCalls.length, 2);
  assertSuccess(h);
});

test('timeout exacto de 20s abarca obtención de token; token tardío no inicia fetch', async t => {
  const token = deferred();
  const h = harness(t, { hooks: { token: () => token.promise } });
  const pending = h.send();
  const controller = h.api.state().controller;
  assert.ok(controller instanceof AbortController);
  await h.clock.tick(19999);
  assert.equal(h.api.state().busy, true);
  assert.equal(controller.signal.aborted, false);
  await h.clock.tick(1);
  await pending;
  assert.equal(controller.signal.aborted, true);
  assertFailure(h, /podría haber sido aceptado.*No habrá reintentos automáticos/);
  const writes = h.domWrites.length;
  token.resolve(TOKEN);
  await flush();
  assert.equal(h.fetchCalls.length, 0);
  assert.equal(h.domWrites.length, writes);
});

test('timeout exacto de 20s aborta fetch real y descarta respuesta tardía sin reintento', async t => {
  const fetched = deferred();
  const h = harness(t, { hooks: { fetch: () => fetched.promise } });
  const pending = h.send();
  await flush();
  const signal = h.fetchCalls[0][1].signal;
  let aborts = 0;
  signal.addEventListener('abort', () => { aborts++; }, { once: true });
  await h.clock.tick(19999);
  assert.equal(signal.aborted, false);
  assert.equal(h.api.state().busy, true);
  await h.clock.tick(1);
  await pending;
  assert.equal(signal.aborted, true);
  assert.equal(aborts, 1);
  assertFailure(h, /podría haber sido aceptado/);
  const writes = h.domWrites.length;
  // Transporte simulado que ignora abort y aun así devuelve una respuesta tardía.
  fetched.resolve(h.response());
  await flush();
  assert.equal(h.domWrites.length, writes);
  assertEmpty(h);
  await h.clock.tick(60000);
  assert.equal(h.fetchCalls.length, 1);
});

test('timeout también cubre JSON lento, cuyo éxito tardío no se muestra', async t => {
  const body = deferred();
  const h = harness(t);
  h.hooks.fetch = async () => h.response({ jsonHook: () => body.promise });
  const pending = h.send();
  await flush();
  const signal = h.fetchCalls[0][1].signal;
  assert.equal(h.jsonCalls.length, 1);
  await h.clock.tick(20000);
  await pending;
  assert.equal(signal.aborted, true);
  assertFailure(h, /No se pudo confirmar el resultado/);
  const writes = h.domWrites.length;
  body.resolve(GOOD);
  await flush();
  assert.equal(h.domWrites.length, writes);
  assertEmpty(h);
});

test('AbortError de transporte no refleja errores ni provoca reintento automático', async t => {
  const h = harness(t, { hooks: { fetch: async () => {
    const error = new Error(`${TOKEN} ${SECRET} ${MALICIOUS}`);
    error.name = 'AbortError';
    throw error;
  } } });
  await h.send();
  assertFailure(h, /No se pudo confirmar el resultado/);
  await h.clock.tick(60000);
  assert.equal(h.fetchCalls.length, 1);
});

test('cambio de sesión antes del token, respuesta o body bloquea fetch/salida obsoletos y errores', async t => {
  for (const stage of ['token', 'response', 'body']) {
    for (const change of ['replacement', 'email', 'uid', 'logout']) {
      for (const rejected of [false, true]) {
        const gate = deferred();
        const h = harness(t);
        if (stage === 'token') h.hooks.token = () => gate.promise;
        if (stage === 'response') h.hooks.fetch = () => gate.promise;
        if (stage === 'body') h.hooks.fetch = async () => h.response({ jsonHook: () => gate.promise });
        const pending = h.send();
        await flush();
        assert.equal(h.fetchCalls.length, stage === 'token' ? 0 : 1);
        assert.equal(h.jsonCalls.length, stage === 'body' ? 1 : 0);
        if (change === 'replacement') h.auth.currentUser = { ...h.operator };
        if (change === 'email') h.auth.currentUser.email = 'otro@example.test';
        if (change === 'uid') h.auth.currentUser.uid = 'otro-uid';
        if (change === 'logout') h.auth.currentUser = null;
        const writes = h.domWrites.length;
        if (rejected) gate.reject(new Error(`${TOKEN} ${SECRET} ${MALICIOUS}`));
        else gate.resolve(stage === 'token' ? TOKEN : stage === 'response' ? h.response() : GOOD);
        await pending;
        assertEmpty(h);
        assert.equal(h.api.state().accepted, false);
        assert.equal(h.fetchCalls.length, stage === 'token' ? 0 : 1, 'No enviar tras perder sesión mientras se obtiene token');
        assert.equal(h.jsonCalls.length, stage === 'body' ? 1 : 0, 'No leer body de respuesta de sesión obsoleta');
        assert.ok(h.domWrites.slice(writes).every(write => write.id === 'supportEmailTestButton'),
          `${stage}/${change}/${rejected}: ni éxito ni error obsoletos se publican`);
      }
    }
  }
});

test('reset conectado a Auth limpia aceptación visible y estado sin iniciar otro envío', async t => {
  const h = harness(t);
  assert.match(html, /onAuthStateChanged\(auth, async \(user\) => \{\s*resetSupportWorkerDiagnostic\(\);\s*resetSupportEmailTest\(\);/);
  await h.send();
  assertSuccess(h);
  h.auth.currentUser = null;
  h.reset();
  assertEmpty(h);
  assert.equal(h.status.textContent, '');
  assert.equal(h.api.state().accepted, false);
  assert.equal(h.api.state().busy, false);
  assert.equal(h.api.state().controller, null);
  assert.equal(h.button.disabled, false);
  assert.equal(h.button.textContent, BUTTON_TEXT);
  assert.equal(h.fetchCalls.length, 1);
});

test('logout/reset aborta petición real, limpia interfaz y descarta respuesta o body anteriores', async t => {
  for (const stage of ['response', 'body']) {
    const gate = deferred();
    const h = harness(t);
    if (stage === 'response') h.hooks.fetch = () => gate.promise;
    else h.hooks.fetch = async () => h.response({ jsonHook: () => gate.promise });
    const pending = h.send();
    await flush();
    const oldRun = h.api.state().run;
    const signal = h.fetchCalls[0][1].signal;
    h.auth.currentUser = null;
    h.reset();
    assert.equal(signal.aborted, true);
    assert.equal(h.api.state().run, oldRun + 1);
    assert.equal(h.api.state().busy, false);
    assert.equal(h.api.state().accepted, false);
    assert.equal(h.api.state().controller, null);
    assert.equal(h.button.disabled, false);
    assert.equal(h.button.textContent, BUTTON_TEXT);
    assert.equal(h.status.textContent, '');
    assertEmpty(h);
    const writes = h.domWrites.length;
    gate.resolve(stage === 'response' ? h.response() : GOOD);
    await pending;
    assert.equal(h.domWrites.length, writes, 'Ni finally obsoleto modifica la interfaz reiniciada');
    assert.equal(h.status.textContent, '');
    assertEmpty(h);
    assert.equal(h.jsonCalls.length, stage === 'body' ? 1 : 0);
  }
});

test('reset mientras espera token impide fetch y errores tardíos', async t => {
  for (const reject of [false, true]) {
    const token = deferred();
    const h = harness(t, { hooks: { token: () => token.promise } });
    const pending = h.send();
    const signal = h.api.state().controller.signal;
    h.reset();
    assert.equal(signal.aborted, true);
    if (reject) token.reject(new Error(`${TOKEN} ${SECRET}`));
    else token.resolve(TOKEN);
    await pending;
    assert.equal(h.fetchCalls.length, 0);
    assert.equal(h.status.textContent, '');
    assertEmpty(h);
  }
});

test('finally viejo no altera busy/controller/botón/timer de una nueva petición tras reset', async t => {
  for (const rejectOld of [false, true]) {
    const oldResponse = deferred(), newResponse = deferred();
    const h = harness(t);
    h.hooks.fetch = () => h.fetchCalls.length === 1 ? oldResponse.promise : newResponse.promise;
    const oldRequest = h.send();
    await flush();
    const oldSignal = h.fetchCalls[0][1].signal;
    h.reset();
    const newRequest = h.send();
    await flush();
    const newController = h.api.state().controller;
    assert.equal(h.fetchCalls.length, 2);
    assert.equal(oldSignal.aborted, true);
    assert.equal(newController.signal.aborted, false);
    if (rejectOld) oldResponse.reject(new Error(`${TOKEN} ${SECRET}`));
    else oldResponse.resolve(h.response());
    await oldRequest;
    assert.equal(h.api.state().busy, true, 'finally viejo no libera busy nuevo');
    assert.equal(h.api.state().accepted, false);
    assert.equal(h.api.state().controller, newController, 'finally viejo no borra controller nuevo');
    assert.equal(h.button.disabled, true);
    assert.equal(h.button.textContent, 'Enviando prueba…');
    assert.equal(h.clock.size(), 1, 'Sólo queda el timeout de la nueva petición');
    assertEmpty(h);
    await h.send();
    assert.equal(h.fetchCalls.length, 2);
    assert.equal(h.tokenCalls.length, 2);
    newResponse.resolve(h.response());
    await newRequest;
    assertSuccess(h);
    assert.equal(h.jsonCalls.length, 1, 'No se procesa body de petición previa al reset');
  }
});
