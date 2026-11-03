'use strict';
// node --test tests/support-notice-setup.test.cjs — funciones reales de index.html; sin red/SDK/storage.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const UID = '5dVKDIhQZlbzonMbSG9mX1pXHYg1', TOKEN = 'PRIVATE_FAKE_JWT_NEVER_RENDER';
const BAD = '<img src=x onerror="steal(PRIVATE_FAKE_JWT_NEVER_RENDER)">';
const GOOD = { ok: true, d1_tablas_validadas: true, reglas_version_correcta: true, directorio_soporte_validado: true,
  avisos_productivos_habilitados: false, revocacion_consultada: true, validacion_sin_entrega: true };
const tick = async () => { for (let n = 0; n < 40; n++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function realFunction(name) {
  const m = html.match(new RegExp(`^  function ${name}\\([^\\n]*\\) \\{\\n[\\s\\S]*?^  \\}`, 'm'));
  assert.ok(m, `Función real ${name}`); return m[0];
}
const setup = html.match(/^  let supportNoticeSetupRun=[\s\S]*?^  \};/m)?.[0];
assert.ok(setup, 'Bloque diagnóstico real existe');
function harness(t) {
  const calls = [], tokens = [], writes = [], forbidden = [], timers = new Map(), hooks = {};
  let time = 0, timerId = 0;
  const ids = Object.fromEntries(['supportNoticeSetupEntry', 'supportNoticeSetupButton', 'supportNoticeSetupStatus', 'supportNoticeSetupResult'].map(id => [id,
    new Proxy({ style: { display: 'none' }, hidden: true, disabled: false, textContent: '' }, { set(node, key, value) {
      if (key === 'innerHTML') assert.fail('Nunca innerHTML');
      if (key === 'textContent') { const text = String(value); writes.push({ id, text }); assert.ok(!text.includes(TOKEN) && !text.includes(BAD), 'Sin token/PII HTML arbitrario'); }
      node[key] = value; return true;
    } })]));
  const operator = { uid: UID, email: 'soporte@fredinero.com', getIdToken(...args) { tokens.push({ user: this, args }); return hooks.token ? hooks.token() : Promise.resolve(TOKEN); } };
  const auth = { currentUser: operator };
  const deny = name => () => { forbidden.push(name); assert.fail(`Prohibido ${name}`); };
  const response = (status = 200, body = GOOD, overrides = {}) => ({ status, ok: status >= 200 && status < 300, headers: { get: () => null }, text: async () => typeof body === 'string' ? body : JSON.stringify(body), ...overrides });
  const sandbox = { auth, AbortController, TextEncoder, TextDecoder, Uint8Array,
    document: { getElementById: id => ids[id] || null },
    fetch(...args) { calls.push(args); return hooks.fetch ? hooks.fetch(...args) : Promise.resolve(response()); },
    setTimeout(cb, delay) { const id = ++timerId; timers.set(id, { cb, at: time + delay, delay }); return id; }, clearTimeout: id => timers.delete(id),
  };
  for (const name of ['ref', 'get', 'set', 'update', 'remove', 'query', 'push', 'getToken', 'sendEmail', 'sendNotification', 'signOut', 'setInterval', 'recordPanelDataUsage', 'XMLHttpRequest', 'WebSocket']) sandbox[name] = deny(name);
  for (const name of ['localStorage', 'sessionStorage', 'database', 'firebase', 'console', 'indexedDB', 'navigator']) sandbox[name] = new Proxy({}, { get: () => deny(name), set: () => { deny(name)(); return false; } });
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(`const SUPPORT_WORKER_UID=${JSON.stringify(UID)};\n${realFunction('supportWorkerIsAuthorized')}\n${setup}\nglobalThis.api={reset:resetSupportNoticeSetup,state:()=>({busy:supportNoticeSetupBusy,controller:supportNoticeSetupController,run:supportNoticeSetupRun})};`, context);
  const h = { auth, operator, hooks, calls, tokens, writes, timers, ids, response, api: context.api,
    check: () => sandbox.checkSupportNoticeSetup(), reset: () => context.api.reset(),
    result: ids.supportNoticeSetupResult, status: ids.supportNoticeSetupStatus, button: ids.supportNoticeSetupButton,
    advance: async ms => { time += ms; for (const [id, timer] of [...timers]) if (timer.at <= time) { timers.delete(id); timer.cb(); } await tick(); } };
  t.after(() => { assert.deepEqual(forbidden, []); assert.equal(timers.size, 0); assert.equal(h.api.state().busy, false); assert.equal(h.button.disabled, false); });
  return h;
}
function empty(h) { assert.equal(h.result.hidden, true); assert.equal(h.result.textContent, ''); }
function success(h, expected = GOOD) { assert.equal(h.result.hidden, false); assert.deepEqual(JSON.parse(h.result.textContent), expected); assert.match(h.status.textContent, /No se entregó ningún aviso/); }

test('tarjeta oculta por defecto, botón explícito y reset onAuth no inicia diagnóstico', async t => {
  const h = harness(t); assert.match(html, /id="supportNoticeSetupEntry"[^>]*style="display:none/);
  assert.match(html, /onclick="window\.checkSupportNoticeSetup\(\)"/);
  assert.match(html, /onAuthStateChanged\(auth,[\s\S]*?resetSupportNoticeSetup\(\)/);
  assert.equal((html.match(/checkSupportNoticeSetup/g) || []).length, 2);
  h.reset(); assert.equal(h.ids.supportNoticeSetupEntry.style.display, ''); await h.advance(60000);
  assert.equal(h.calls.length, 0); assert.equal(h.tokens.length, 0);
  h.auth.currentUser = null; h.reset(); assert.equal(h.ids.supportNoticeSetupEntry.style.display, 'none'); empty(h);
});

test('sólo UID y correo exactos de Auth permiten POST /v1/notices/status con body {} y Bearer fuera de salida', async t => {
  const h = harness(t);
  for (const user of [null, {}, { uid: 'wrong', email: 'soporte@fredinero.com' }, { uid: UID, email: 'cleon@fredinero.com' },
    { uid: ` ${UID}`, email: 'soporte@fredinero.com' }, { uid: UID, email: 'soporte@fredinero.com.evil' }]) {
    h.auth.currentUser = user && { ...user, getIdToken: h.operator.getIdToken }; h.reset(); await h.check();
    empty(h); assert.equal(h.ids.supportNoticeSetupEntry.style.display, 'none');
  }
  assert.equal(h.calls.length, 0); assert.equal(h.tokens.length, 0);
  h.auth.currentUser = h.operator; await h.check(); success(h);
  assert.equal(h.calls.length, 1); assert.equal(h.tokens.length, 1); assert.equal(h.tokens[0].user, h.operator);
  const [url, request] = h.calls[0]; assert.equal(url, 'https://fredinero-avisos.sistemas-fredinero.workers.dev/v1/notices/status');
  assert.equal(request.method, 'POST'); assert.equal(request.body, '{}'); assert.equal(request.credentials, 'omit');
  assert.deepEqual(JSON.parse(JSON.stringify(request.headers)), { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' });
});

test('proyección whitelist sólo booleans descarta strings arbitrarios/secretos, y ok false no afirma instalación completa', async t => {
  const h = harness(t); h.hooks.fetch = async () => h.response(200, { ...GOOD, token: TOKEN, html: BAD, email: 'PII@private.test', nested: { secret: TOKEN } });
  await h.check(); success(h); assert.ok(Object.values(JSON.parse(h.result.textContent)).every(v => typeof v === 'boolean'));
  h.hooks.fetch = async () => h.response(200, { ...GOOD, ok: false }); await h.check(); success(h, { ...GOOD, ok: false });
  assert.match(h.status.textContent, /todavía necesita/);
});

test('rechaza true ok sin revocación real/sin validación no entrega y cada campo no boolean/ausente', async t => {
  const bodies = [null, [], {}, BAD, { ...GOOD, revocacion_consultada: false }, { ...GOOD, validacion_sin_entrega: false }];
  for (const key of Object.keys(GOOD)) { const missing = { ...GOOD }; delete missing[key]; bodies.push(missing, { ...GOOD, [key]: 'true' }); }
  for (const body of bodies) { const h = harness(t); h.hooks.fetch = async () => h.response(200, body); await h.check(); empty(h); assert.match(h.status.textContent, /No se pudo validar/); }
});

for (const [status, message] of [[401, /Cierra e inicia sesión/], [429, /límite temporal/], [503, /No se pudo validar/]]) test(`HTTP ${status} muestra mensaje local sin cuerpo privado y no repite automáticamente`, async t => {
  const h = harness(t); h.hooks.fetch = async () => h.response(status, BAD, { text: () => assert.fail('No lee cuerpos fallidos') });
  await h.check(); empty(h); assert.match(h.status.textContent, message); await h.advance(60000); assert.equal(h.calls.length, 1);
});

test('límite raw 4096 UTF8 bytes, JSON inválido y errores token/red siempre sanitizados', async t => {
  for (const raw of ['x'.repeat(4097), 'é'.repeat(2049), BAD]) { const h = harness(t); h.hooks.fetch = async () => h.response(200, raw); await h.check(); empty(h); }
  for (const stage of ['token', 'fetch']) { const h = harness(t); h.hooks[stage] = async () => { throw Error(BAD); }; await h.check(); empty(h); assert.match(h.status.textContent, /No se pudo validar/); }
});

test('doble clic durante token y fetch obtiene un token y una sola petición', async t => {
  const h = harness(t), token = deferred(), fetch = deferred(); h.hooks.token = () => token.promise; h.hooks.fetch = () => fetch.promise;
  const first = h.check(); await h.check(); assert.equal(h.tokens.length, 1); assert.equal(h.calls.length, 0);
  token.resolve(TOKEN); await tick(); await h.check(); assert.equal(h.calls.length, 1);
  fetch.resolve(h.response()); await first; success(h);
});

for (const stage of ['token', 'fetch', 'body']) test(`deadline25s incluye ${stage} y resolución tardía nunca publica ni inicia otra petición`, async t => {
  const h = harness(t), gate = deferred();
  if (stage === 'token') h.hooks.token = () => gate.promise;
  if (stage === 'fetch') h.hooks.fetch = () => gate.promise;
  if (stage === 'body') h.hooks.fetch = async () => h.response(200, '', { text: () => gate.promise });
  const first = h.check(); await tick(); assert.deepEqual([...h.timers.values()].map(timer => timer.delay), [25000]);
  await h.advance(24999); assert.equal(h.button.disabled, true); await h.advance(1); await first; empty(h);
  const count = h.writes.length;
  gate.resolve(stage === 'token' ? TOKEN : stage === 'fetch' ? h.response() : JSON.stringify(GOOD)); await tick();
  assert.equal(h.writes.length, count); assert.equal(h.calls.length, stage === 'token' ? 0 : 1);
});

for (const stage of ['token', 'fetch', 'body']) for (const change of ['logout', 'replacement']) test(`cambio Auth ${change} durante ${stage} descarta HTTP/salida del operador anterior`, async t => {
  const h = harness(t), gate = deferred();
  if (stage === 'token') h.hooks.token = () => gate.promise;
  if (stage === 'fetch') h.hooks.fetch = () => gate.promise;
  if (stage === 'body') h.hooks.fetch = async () => h.response(200, '', { text: () => gate.promise });
  const work = h.check(); await tick(); h.auth.currentUser = change === 'logout' ? null : { ...h.operator };
  h.reset(); const count = h.writes.length;
  gate.resolve(stage === 'token' ? TOKEN : stage === 'fetch' ? h.response() : JSON.stringify(GOOD)); await work; await tick();
  empty(h); assert.equal(h.writes.length, count); assert.equal(h.calls.length, stage === 'token' ? 0 : 1);
});
