'use strict';

// Ejecuta únicamente las funciones/constantes REALES extraídas de index.html.
// Sin navegador, SDK, red, credenciales reales, consola de la aplicación ni deps.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const html = readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const EXPECTED_UID = '5dVKDIhQZlbzonMbSG9mX1pXHYg1';
const EXPECTED_URL = 'https://fredinero-avisos.sistemas-fredinero.workers.dev/v1/auth/check';
const TOKEN = 'TEST_ONLY_BEARER_TOKEN_DO_NOT_RENDER';
const SECRET = 'TEST_ONLY_SERVER_SECRET_DO_NOT_RENDER';
const MALICIOUS = `<img src=x onerror="alert('${SECRET}')">`;
const GOOD = Object.freeze({
  ok: true, autenticado: true, soporte_autorizado: true,
  envios_habilitados: false, revocacion_consultada: false,
});
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

// Despacha los awaits anidados sin dormir ni depender del reloj de la máquina.
async function flush() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

function fakeClock() {
  let now = 0, nextId = 0;
  const pending = new Map();
  const clock = {
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
  return clock;
}

function harness(t, { user, hooks = {} } = {}) {
  const forbidden = [], domWrites = [], tokenCalls = [], fetchCalls = [], jsonCalls = [];
  const clock = fakeClock();
  const deny = name => () => {
    forbidden.push(name);
    throw new Error(`Operación prohibida en diagnóstico: ${name}`);
  };
  const blockedObject = label => new Proxy(Object.create(null), {
    get: (_target, key) => deny(`${label}.${String(key)}`),
    set: (_target, key) => { deny(`${label}.${String(key)}=`)(); return false; },
  });
  function node(id) {
    const element = { disabled: false, hidden: false, style: {}, textContent: '', innerHTML: '' };
    return new Proxy(element, {
      set(target, key, value) {
        if (key === 'textContent' || key === 'innerHTML') domWrites.push({ id, key, value: String(value) });
        target[key] = value;
        return true;
      },
    });
  }
  const ids = Object.fromEntries([
    'supportWorkerDiagnosticEntry', 'supportWorkerDiagnosticButton',
    'supportWorkerDiagnosticStatus', 'supportWorkerDiagnosticResult',
    'privacyAdminEntry', 'dataUsageAdminEntry', 'supportProfileAdminEntry',
  ].map(id => [id, node(id)]));
  ids.supportWorkerDiagnosticEntry.style.display = 'none';
  ids.supportWorkerDiagnosticResult.hidden = true;
  ids.supportWorkerDiagnosticButton.textContent = 'Comprobar conexión segura';
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
        if (jsonHook) return jsonHook();
        return body;
      },
      text: deny('response.text'),
    };
  }
  const sandbox = {
    auth, AbortController, // Implementación REAL de Node, no un mock de abort.
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
    'XMLHttpRequest', 'WebSocket', 'alert', 'prompt', 'confirm',
  ]) sandbox[name] = deny(name);
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext([
    ...['SUPPORT_WORKER_UID', 'SUPPORT_WORKER_URL'].map(name => realDeclaration('const', name)),
    ...['_supportWorkerRun', '_supportWorkerBusy', '_supportWorkerController'].map(name => realDeclaration('let', name)),
    ...['privacyIsSupport', 'supportWorkerIsAuthorized', 'supportWorkerMessage',
      'resetSupportWorkerDiagnostic', 'applyPrivacyAdminAccess'].map(realFunction),
    realWindowFunction('checkSupportWorkerSession'),
    'globalThis.api = { supportWorkerIsAuthorized, supportWorkerMessage, resetSupportWorkerDiagnostic, applyPrivacyAdminAccess, uid: SUPPORT_WORKER_UID, url: SUPPORT_WORKER_URL, state: () => ({ busy: _supportWorkerBusy, run: _supportWorkerRun, controller: _supportWorkerController }) };',
  ].join('\n\n'), context, { filename: 'index.html:real-support-worker-diagnostic' });
  const h = {
    api: context.api, window: sandbox, auth, operator, ids, clock, hooks,
    forbidden, domWrites, tokenCalls, fetchCalls, jsonCalls, response,
    check: () => sandbox.checkSupportWorkerSession(),
    reset: () => context.api.resetSupportWorkerDiagnostic(),
    result: ids.supportWorkerDiagnosticResult,
    status: ids.supportWorkerDiagnosticStatus,
    button: ids.supportWorkerDiagnosticButton,
    entry: ids.supportWorkerDiagnosticEntry,
  };
  t.after(() => {
    assert.deepEqual(forbidden, [], 'Sin console, almacenamiento, Firebase, envíos ni otros canales');
    for (const write of domWrites) {
      for (const sensitive of [TOKEN, SECRET, MALICIOUS]) {
        assert.ok(!write.value.includes(sensitive), `${write.id}/${write.key}: nunca publicar secretos, ni transitoriamente`);
      }
      assert.equal(write.key, 'textContent', 'No se interpreta HTML para mensajes/resultados');
    }
    assert.equal(clock.size(), 0, 'No quedan timers pendientes');
    assert.equal(h.api.state().busy, false, 'busy se libera al concluir');
    assert.equal(h.api.state().controller, null);
    assert.equal(h.button.disabled, false);
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
  assert.doesNotMatch(h.status.textContent, /Conexión segura confirmada/);
  assert.equal(h.status.style.color, '#B91C1C');
}

function assertSuccess(h) {
  assert.equal(h.result.hidden, false);
  const result = JSON.parse(h.result.textContent);
  assert.deepEqual(result, GOOD, 'Sólo los cinco booleanos permitidos');
  assert.ok(Object.values(result).every(value => typeof value === 'boolean'));
  assert.match(h.status.textContent, /Conexión segura confirmada/);
  assert.equal(h.status.style.color, '#166534');
}

test('autoriza exclusivamente UID exacto Y correo normalizado; no basta UID, correo o rol', async t => {
  const h = harness(t);
  assert.equal(h.api.uid, EXPECTED_UID);
  for (const email of ['soporte@fredinero.com', '  SOPORTE@FREDINERO.COM  ']) {
    h.auth.currentUser = { ...h.operator, email };
    assert.equal(h.api.supportWorkerIsAuthorized(), true);
  }
  const rejected = [
    null, {}, { uid: EXPECTED_UID }, { email: 'soporte@fredinero.com' },
    { uid: EXPECTED_UID, email: 'otro@example.test' },
    { uid: 'otro-uid', email: 'soporte@fredinero.com' },
    { uid: EXPECTED_UID.toLowerCase(), email: 'soporte@fredinero.com' },
    { uid: ` ${EXPECTED_UID}`, email: 'soporte@fredinero.com' },
    { uid: EXPECTED_UID, email: 'soporte@fredinero.com.evil.test' },
    { uid: EXPECTED_UID, email: '' },
  ];
  h.window.currentUser = { uid: EXPECTED_UID, email: 'soporte@fredinero.com', rol: 'SOPORTE' };
  h.window.currentUserRole = 'SOPORTE';
  for (const user of rejected) {
    h.auth.currentUser = user && { ...h.operator, ...user, getIdToken: h.operator.getIdToken };
    // No heredar las credenciales omitidas en los casos parciales.
    if (user && !Object.hasOwn(user, 'uid')) delete h.auth.currentUser.uid;
    if (user && !Object.hasOwn(user, 'email')) delete h.auth.currentUser.email;
    assert.equal(h.api.supportWorkerIsAuthorized(), false, JSON.stringify(user));
    h.api.applyPrivacyAdminAccess();
    assert.equal(h.entry.style.display, 'none');
    await h.check();
    assertEmpty(h);
  }
  assert.equal(h.tokenCalls.length, 0);
  assert.equal(h.fetchCalls.length, 0);
  assert.equal(h.clock.size(), 0);
});

test('la tarjeta sólo cambia visibilidad: applyPrivacyAdminAccess/reset no inician token ni fetch', t => {
  const h = harness(t);
  assert.equal(h.entry.style.display, 'none');
  assert.match(html, /id="supportWorkerDiagnosticEntry"[^>]*style="display:none/);
  assert.match(html, /id="supportWorkerDiagnosticButton"[^>]*onclick="window\.checkSupportWorkerSession\(\)"/);
  assert.match(html, /id="supportWorkerDiagnosticStatus"[^>]*role="status"[^>]*aria-live="polite"/);
  for (let i = 0; i < 3; i++) {
    h.api.applyPrivacyAdminAccess();
    assert.equal(h.entry.style.display, '');
    h.reset();
  }
  h.auth.currentUser = { uid: 'otro', email: 'soporte@fredinero.com' };
  h.api.applyPrivacyAdminAccess();
  assert.equal(h.entry.style.display, 'none', 'La autorización por correo de otras tarjetas no se hereda');
  assert.equal(h.ids.supportProfileAdminEntry.style.display, '');
  h.auth.currentUser = null;
  h.reset();
  assert.equal(h.entry.style.display, 'none');
  assert.equal(h.tokenCalls.length, 0);
  assert.equal(h.fetchCalls.length, 0);
  assertEmpty(h);
});

test('supportWorkerMessage usa texto y distingue estado normal/error sin efectos laterales', t => {
  const h = harness(t);
  h.api.supportWorkerMessage('Estado informativo');
  assert.equal(h.status.textContent, 'Estado informativo');
  assert.equal(h.status.style.color, '#166534');
  h.api.supportWorkerMessage('Error controlado', true);
  assert.equal(h.status.textContent, 'Error controlado');
  assert.equal(h.status.style.color, '#B91C1C');
  delete h.ids.supportWorkerDiagnosticStatus;
  assert.doesNotThrow(() => h.api.supportWorkerMessage('Sin nodo', true));
  assert.equal(h.fetchCalls.length, 0);
});

test('éxito muestra JSON cerrado e ignora secretos/HTML; GET HTTPS fijo con token sólo en Authorization', async t => {
  const h = harness(t);
  h.hooks.fetch = () => Promise.resolve(h.response({ body: {
    ...GOOD, token: TOKEN, secret: SECRET, message: MALICIOUS,
    nested: { correo: 'privado@example.test', detalle: MALICIOUS },
  } }));
  await h.check();
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
  assert.equal(parsed.search, '');
  assert.equal(parsed.hash, '');
  assert.equal(parsed.username + parsed.password, '');
  assert.ok(!url.includes(TOKEN));
  assert.deepEqual(Object.keys(options).sort(), ['method', 'headers', 'credentials', 'cache', 'redirect', 'referrerPolicy', 'signal'].sort());
  assert.deepEqual(plain(options.headers), { Authorization: `Bearer ${TOKEN}` });
  assert.equal(options.method, 'GET');
  assert.equal(options.credentials, 'omit');
  assert.equal(options.redirect, 'error');
  assert.equal(options.cache, 'no-store');
  assert.equal(options.referrerPolicy, 'no-referrer');
  assert.ok(options.signal instanceof AbortSignal);
  assert.equal(options.signal.aborted, false);
  assert.equal(Object.hasOwn(options, 'body'), false);
  assert.equal(h.jsonCalls.length, 1);
  assert.doesNotMatch(h.result.textContent, /privado@example\.test|nested|message|secret|token|<img/);
});

test('doble clic durante token y durante fetch produce una sola obtención y una sola petición', async t => {
  const token = deferred(), response = deferred();
  const h = harness(t, { hooks: { token: () => token.promise, fetch: () => response.promise } });
  const first = h.check();
  assert.equal(h.api.state().busy, true);
  assert.equal(h.button.disabled, true);
  await h.check();
  assert.equal(h.tokenCalls.length, 1);
  assert.equal(h.fetchCalls.length, 0);
  token.resolve(TOKEN);
  await flush();
  assert.equal(h.fetchCalls.length, 1);
  await h.check();
  assert.equal(h.tokenCalls.length, 1);
  assert.equal(h.fetchCalls.length, 1);
  response.resolve(h.response());
  await first;
  assertSuccess(h);
});

test('HTTP 401/403/503 y otros errores muestran mensajes locales sin revelar body ni token', async t => {
  for (const [status, message] of [
    [401, /no aceptó la sesión/], [403, /rechazó el acceso/],
    [503, /no está listo/], [500, /No se pudo completar la conexión/],
  ]) {
    const h = harness(t);
    h.hooks.fetch = async () => h.response({ status, body: { ...GOOD, error: `${TOKEN} ${SECRET} ${MALICIOUS}` } });
    await h.check();
    assertFailure(h, message);
    assert.equal(h.fetchCalls.length, 1);
    assert.equal(h.jsonCalls.length, 1);
  }
});

test('JSON inválido nunca publica el error bruto del parser', async t => {
  const h = harness(t);
  h.hooks.fetch = async () => h.response({ jsonError: new SyntaxError(`Unexpected token ${TOKEN}: ${MALICIOUS}`) });
  await h.check();
  assertFailure(h, /No se pudo completar la conexión/);
  assert.equal(h.jsonCalls.length, 1);
});

test('flags inesperados o no booleanos, especialmente envios_habilitados=true, no confirman éxito', async t => {
  const bodies = [null, {}, { ...GOOD, envios_habilitados: true, message: MALICIOUS }];
  for (const [key, value] of Object.entries(GOOD)) {
    const missing = { ...GOOD }; delete missing[key];
    bodies.push(missing, { ...GOOD, [key]: !value }, { ...GOOD, [key]: String(value) });
  }
  for (const body of bodies) {
    const h = harness(t);
    h.hooks.fetch = async () => h.response({ body });
    await h.check();
    assertFailure(h, /no confirmó el diagnóstico sin envíos/);
    assert.equal(h.fetchCalls.length, 1);
  }
});

test('error al obtener token libera busy, no hace fetch ni expone el error', async t => {
  const h = harness(t, { hooks: { token: async () => { throw new Error(`${TOKEN} ${SECRET} ${MALICIOUS}`); } } });
  await h.check();
  assertFailure(h, /No se pudo completar la conexión/);
  assert.equal(h.tokenCalls.length, 1);
  assert.equal(h.fetchCalls.length, 0);
  assert.equal(h.api.state().busy, false);
});

test('fallo de fetch con token en su error no lo publica; reintento es exclusivamente manual', async t => {
  const h = harness(t, { hooks: { fetch: async () => { throw new Error(`CORS ${TOKEN} ${SECRET} ${MALICIOUS}`); } } });
  await h.check();
  assertFailure(h, /Internet.*CORS/);
  await h.clock.tick(60000);
  assert.equal(h.fetchCalls.length, 1, 'No reintenta automáticamente');
  h.hooks.fetch = async () => h.response();
  await h.check();
  assert.equal(h.fetchCalls.length, 2);
  assertSuccess(h);
});

test('timeout de 12s incluye getIdToken lento y su resolución tardía nunca inicia fetch', async t => {
  const token = deferred();
  const h = harness(t, { hooks: { token: () => token.promise } });
  const pending = h.check();
  const controller = h.api.state().controller;
  assert.ok(controller instanceof AbortController);
  await h.clock.tick(11999);
  assert.equal(h.api.state().busy, true);
  assert.equal(controller.signal.aborted, false);
  await h.clock.tick(1);
  await pending;
  assert.equal(controller.signal.aborted, true);
  assertFailure(h, /tiempo de espera/);
  const message = h.status.textContent;
  token.resolve(TOKEN);
  await flush();
  assert.equal(h.fetchCalls.length, 0);
  assert.equal(h.status.textContent, message);
  assertEmpty(h);
});

test('timeout de fetch lento aborta la señal real y no muestra una respuesta tardía', async t => {
  const response = deferred();
  const h = harness(t, { hooks: { fetch: () => response.promise } });
  const pending = h.check();
  await flush();
  const signal = h.fetchCalls[0][1].signal;
  let aborts = 0;
  signal.addEventListener('abort', () => { aborts++; }, { once: true });
  await h.clock.tick(11999);
  assert.equal(signal.aborted, false);
  assert.equal(h.api.state().busy, true);
  await h.clock.tick(1);
  await pending;
  assert.equal(signal.aborted, true);
  assert.equal(aborts, 1);
  assertFailure(h, /tiempo de espera/);
  const message = h.status.textContent;
  // Incluso si el transporte simulado ignora abort y entrega datos, race no publica.
  response.resolve(h.response());
  await flush();
  assert.equal(h.status.textContent, message);
  assertEmpty(h);
  assert.equal(h.fetchCalls.length, 1);
});

test('AbortError del transporte produce sólo aviso local de espera y libera la interfaz', async t => {
  const h = harness(t, { hooks: { fetch: async () => {
    const error = new Error(`${TOKEN} ${SECRET}`);
    error.name = 'AbortError';
    throw error;
  } } });
  await h.check();
  assertFailure(h, /tiempo de espera/);
});

test('cambio de sesión antes de token, respuesta o body invalida éxito y errores sin publicar', async t => {
  for (const stage of ['token', 'response', 'body']) {
    for (const change of ['replacement', 'email', 'logout']) {
      for (const rejected of [false, true]) {
        const gate = deferred();
        const h = harness(t);
        if (stage === 'token') h.hooks.token = () => gate.promise;
        if (stage === 'response') h.hooks.fetch = () => gate.promise;
        if (stage === 'body') h.hooks.fetch = async () => h.response({ jsonHook: () => gate.promise });
        const pending = h.check();
        await flush();
        assert.equal(h.fetchCalls.length, stage === 'token' ? 0 : 1);
        assert.equal(h.jsonCalls.length, stage === 'body' ? 1 : 0);
        if (change === 'replacement') h.auth.currentUser = { ...h.operator }; // Misma identidad, distinto objeto Auth.
        if (change === 'email') h.auth.currentUser.email = 'otro@example.test';
        if (change === 'logout') h.auth.currentUser = null;
        const writesBefore = h.domWrites.length;
        if (rejected) gate.reject(new Error(`${TOKEN} ${SECRET} ${MALICIOUS}`));
        else gate.resolve(stage === 'token' ? TOKEN : stage === 'response' ? h.response() : GOOD);
        await pending;
        assertEmpty(h);
        assert.equal(h.fetchCalls.length, stage === 'token' ? 0 : 1, 'No fetch tras perder sesión durante getIdToken');
        assert.equal(h.jsonCalls.length, stage === 'body' ? 1 : 0, 'No lee body de una respuesta de sesión obsoleta');
        assert.ok(h.domWrites.slice(writesBefore).every(write => write.id === 'supportWorkerDiagnosticButton'),
          'No publica ni éxito ni errores de la sesión obsoleta');
        assert.equal(h.api.state().busy, false);
      }
    }
  }
});

test('reset limpia resultado visible, estado y botón; aborta petición y bloquea salida tardía', async t => {
  const h = harness(t);
  await h.check();
  assertSuccess(h);
  h.reset();
  assertEmpty(h);
  assert.equal(h.status.textContent, '');
  assert.equal(h.entry.style.display, '');
  const response = deferred();
  h.hooks.fetch = () => response.promise;
  const pending = h.check();
  await flush();
  const oldRun = h.api.state().run;
  const signal = h.fetchCalls.at(-1)[1].signal;
  h.auth.currentUser = null;
  h.reset();
  assert.equal(signal.aborted, true);
  assert.equal(h.api.state().run, oldRun + 1);
  assert.equal(h.api.state().busy, false);
  assert.equal(h.api.state().controller, null);
  assert.equal(h.button.disabled, false);
  assert.equal(h.button.textContent, 'Comprobar conexión segura');
  assert.equal(h.entry.style.display, 'none');
  assert.equal(h.status.textContent, '');
  assertEmpty(h);
  response.resolve(h.response());
  await pending;
  assert.equal(h.status.textContent, '');
  assertEmpty(h);
  assert.equal(h.jsonCalls.length, 1, 'Sólo se leyó el body del primer éxito, no el obsoleto');
});

test('reset mientras espera token impide fetch posterior y no publica errores tardíos', async t => {
  for (const reject of [false, true]) {
    const token = deferred();
    const h = harness(t, { hooks: { token: () => token.promise } });
    const pending = h.check();
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

test('nueva petición tras reset conserva busy/controller/timer aunque termine el finally anterior', async t => {
  for (const rejectOld of [false, true]) {
    const oldResponse = deferred(), newResponse = deferred();
    const h = harness(t);
    h.hooks.fetch = () => h.fetchCalls.length === 1 ? oldResponse.promise : newResponse.promise;
    const oldRequest = h.check();
    await flush();
    const oldSignal = h.fetchCalls[0][1].signal;
    h.reset();
    const newRequest = h.check();
    await flush();
    const newController = h.api.state().controller;
    assert.equal(h.fetchCalls.length, 2);
    assert.equal(oldSignal.aborted, true);
    assert.equal(newController.signal.aborted, false);
    if (rejectOld) oldResponse.reject(new Error(`${TOKEN} ${SECRET}`));
    else oldResponse.resolve(h.response());
    await oldRequest;
    assert.equal(h.api.state().busy, true, 'finally viejo no libera busy nuevo');
    assert.equal(h.api.state().controller, newController, 'finally viejo no borra controller nuevo');
    assert.equal(h.button.disabled, true);
    assert.equal(h.button.textContent, 'Comprobando…');
    assert.equal(h.clock.size(), 1, 'Sólo queda el timeout de la petición nueva');
    assertEmpty(h);
    await h.check();
    assert.equal(h.fetchCalls.length, 2, 'Sigue vigente exclusión de doble clic');
    assert.equal(h.tokenCalls.length, 2);
    newResponse.resolve(h.response());
    await newRequest;
    assertSuccess(h);
    assert.equal(h.jsonCalls.length, 1, 'Nunca procesa body de petición anterior al reset');
  }
});
