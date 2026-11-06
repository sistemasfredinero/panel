'use strict';
// node --test tests/panel-notice-client.test.cjs — módulo real y contrato real; fetchImpl simulado, sin red.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '..');
const compiled = name => ts.transpileModule(fs.readFileSync(path.join(root, name), 'utf8'), { compilerOptions: { allowJs: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const modules = { 'notice-client.js': compiled('notice-client.js'), 'notice-contract.generated.js': compiled('notice-contract.generated.js') };
function load(name, globals = {}, cache = new Map()) {
  if (cache.has(name)) return cache.get(name);
  const module = { exports: {} }; cache.set(name, module.exports);
  new Function('require', 'module', 'exports', 'setTimeout', 'clearTimeout', modules[name])(
    dep => { assert.equal(dep, './notice-contract.generated.js', 'Sólo contrato local'); return load(dep.slice(2), globals, cache); },
    module, module.exports, globals.setTimeout || setTimeout, globals.clearTimeout || clearTimeout);
  cache.set(name, module.exports); return module.exports;
}
const tick = async () => { for (let n = 0; n < 50; n++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const id = n => `n_uid-own_${String(n).padStart(3, '0')}`;
const CONTRACT = load('notice-contract.generated.js');
const sourcePath = 'permission_requests/source-1';
const initial = () => ({ id: 'source-1', uid: 'applicant', user_uid: 'applicant', correo: 'applicant@fredinero.com', nombre: 'Persona', rol: 'GESTOR', plaza: 'TAMPICO',
  estado: 'sin_responder', approval_stage: 'jaguayo', approval_stages: ['jaguayo', 'cleon'], fecha_inicio: '3/1/2026',
  nota_cleon: 'OPAQUE legacy note', metadata: { untouched: true, nested: { sequence: 99 } },
  approved_by_names: { jaguayo: 'Antes', cleon: 'RH previa' } });
function harness(options = {}) {
  let tree = {}, now = 1793700000000, uuid = 0, timerId = 0;
  const timers = new Map(), hooks = options;
  const calls = { get: [], update: [], remove: [], http: [], tokens: [], active: 0, maxActive: 0 };
  const user = { uid: 'uid-own', email: 'own@fredinero.com', getIdToken: async () => { calls.tokens.push(user); return hooks.token ? hooks.token(auth) : 'PRIVATE_JWT'; } };
  const auth = { currentUser: user };
  function valueAt(p) { return p ? p.split('/').reduce((node, key) => node?.[key], tree) : tree; }
  function setAt(target, p, value) {
    const parts = p.split('/'); let node = target; for (const key of parts.slice(0, -1)) node = node[key] ??= {};
    if (value === null) delete node[parts.at(-1)]; else node[parts.at(-1)] = structuredClone(value);
  }
  const firebase = {
    ref: (_, p = '') => ({ path: p }), query: (r, ...constraints) => ({ ...r, constraints }),
    orderByKey: () => ({ type: 'key' }), startAfter: key => ({ type: 'after', key }), limitToFirst: n => ({ type: 'first', n }),
    get: async request => {
      assert.match(request.path, /^notice_pending\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)?$/, 'Sólo pending de la sesión, no roots/listeners');
      calls.get.push(request); if (hooks.get) await hooks.get(auth, request);
      const value = valueAt(request.path), after = request.constraints?.find(c => c.type === 'after')?.key;
      const limit = request.constraints?.find(c => c.type === 'first')?.n ?? Infinity;
      const entries = Object.entries(value || {}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).filter(([key]) => !after || key > after).slice(0, limit);
      return { ref: request, exists: () => value != null, val: () => value == null ? null : structuredClone(value),
        forEach: cb => { for (const [key, item] of entries) cb({ key, val: () => structuredClone(item), ref: { path: `${request.path}/${key}` } }); } };
    },
    update: async (r, changes) => {
      assert.equal(r.path, ''); calls.update.push(structuredClone(changes));
      const keys = Object.keys(changes); assert.ok(keys.every(p => keys.every(q => p === q || !q.startsWith(`${p}/`))), 'Un update sin paths ancestro/hijo');
      if (hooks.update) await hooks.update(auth, changes);
      const next = structuredClone(tree); for (const [p, value] of Object.entries(changes)) setAt(next, p, value); tree = next;
    },
    remove: async r => { calls.remove.push(r.path); setAt(tree, r.path, null); },
  };
  const response = (status = 200, body = { ok: true, event_committed: true, accepted: 1 }, extra = {}) => ({ status, ok: status >= 200 && status < 300,
    headers: { get: () => null }, text: async () => typeof body === 'string' ? body : JSON.stringify(body), ...extra });
  const exports = load('notice-client.js', { setTimeout: (cb, delay) => { const key = ++timerId; timers.set(key, { cb, delay }); return key; }, clearTimeout: key => timers.delete(key) });
  const client = exports.makePanelNoticeClient({ auth, database: {}, ...firebase, now: () => now, uuid: () => String(++uuid).padStart(3, '0'),
    fetchImpl: async (url, request) => {
      const eventId = JSON.parse(request.body).event_id; assert.equal(auth.currentUser, user, 'No HTTP con identidad reemplazada');
      assert.ok(valueAt(`notice_pending/${user.uid}/${eventId}`), 'No HTTP de evento no confirmado');
      calls.http.push({ url, ...request }); calls.active++; calls.maxActive = Math.max(calls.maxActive, calls.active);
      try { return hooks.fetch ? await hooks.fetch(auth, request) : response(); } finally { calls.active--; }
    } });
  return { client, exports, auth, user, calls, timers, response, valueAt, seed: (p, value) => setAt(tree, p, value),
    advance: ms => { now += ms; }, expire: () => { for (const [key, timer] of [...timers]) { timers.delete(key); timer.cb(); } } };
}
function prepare(h, overrides = {}) { return h.client.prepare({ kind: 'permission.panel_stage_approved', sourceId: 'source-1', before: initial(), after: { ...initial(), estado: 'pendiente_vobo', approval_stage: 'cleon' }, ...overrides }); }

test('prepare real es puro: snapshots del contrato, actor Auth y proof exacto, source nunca se reemplaza', () => {
  const h = harness(), before = initial(), after = { ...before, approval_stage: 'cleon', token: 'PRIVATE_JWT', foto_base64: 'PRIVATE_PHOTO' };
  const original = JSON.stringify({ before, after }), p = prepare(h, { before, after });
  assert.equal(p.event.actor_uid, h.user.uid); assert.equal(p.event.actor_email, h.user.email); assert.equal(p.event.suppressed, false);
  assert.equal(p.event.before.fecha_inicio, '3/1/2026'); assert.equal(p.event.after.approval_stage, 'cleon');
  assert.ok(!('token' in p.event.after) && !('foto_base64' in p.event.after) && !('metadata' in p.event.after));
  assert.equal(JSON.stringify({ before, after }), original);
  const ops = Object.fromEntries(p.operations.map(op => [op.path, op.value]));
  assert.equal(ops[`${sourcePath}/last_notice_id`], p.event.id);
  const proof = ops[`${sourcePath}/notice_validation/permission_panel_stage_approved`] ?? ops[`${sourcePath}/notice_validation`]?.permission_panel_stage_approved;
  assert.equal(proof, p.event.id); assert.equal(ops[`notice_events/${p.event.id}`], p.event);
  assert.deepEqual(ops[`notice_pending/uid-own/${p.event.id}`], { created_at: p.event.created_at });
  assert.deepEqual(p.event.validation.snapshots.primary, Object.fromEntries(CONTRACT.NOTICE_SNAPSHOT_FIELDS[p.event.kind].map(field => [CONTRACT.NOTICE_FIELD_CODES[field], true])));
  assert.equal(h.calls.update.length, 0); assert.equal(h.calls.get.length, 0); assert.equal(h.calls.tokens.length, 0); assert.equal(h.calls.http.length, 0);
});

test('save real un commit leaf conserva campos opacos + siblings, event before/after coincide con RTDB, despacho sólo del ID confirmado', async () => {
  const h = harness(), before = initial(); h.seed(sourcePath, before);
  const event = await h.client.save({ kind: 'permission.panel_stage_approved', sourceId: 'source-1', before, patch: { approval_stage: 'cleon', estado: 'pendiente_vobo', 'approved_by_names/jaguayo': 'Nuevo' } }); await tick();
  assert.equal(h.calls.update.length, 1); const changes = h.calls.update[0];
  assert.ok(!Object.hasOwn(changes, sourcePath) && !Object.hasOwn(changes, `${sourcePath}/approved_by_names`));
  assert.equal(h.valueAt(`${sourcePath}/approved_by_names/cleon`), 'RH previa'); assert.equal(h.valueAt(`${sourcePath}/nota_cleon`), before.nota_cleon);
  assert.deepEqual(h.valueAt(`${sourcePath}/metadata`), before.metadata);
  const stored = h.valueAt(`notice_events/${event.id}`); assert.equal(stored.before.approval_stage, before.approval_stage); assert.equal(stored.after.approval_stage, 'cleon');
  assert.equal(stored.after.approved_by_names.jaguayo, h.valueAt(`${sourcePath}/approved_by_names/jaguayo`));
  assert.deepEqual(h.calls.get.map(r => r.path), [`notice_pending/uid-own/${event.id}`]);
  assert.equal(JSON.parse(h.calls.http[0].body).event_id, event.id); assert.equal(h.timers.size, 0);
});

test('attach expande fuente ligada recursivamente, no borra metadata/notas ni modifica ops opacas fuera del scope', () => {
  const h = harness(), p = prepare(h), opaque = { path: 'other/root', value: { nested: { note: 'keep' } } };
  const plus = { path: 'summary/new/total', value: { '.sv': { increment: 1 } } }, minus = { path: 'summary/old/total', value: { '.sv': { increment: -1 } } };
  const result = h.client.attach([{ path: sourcePath, value: { estado: 'pendiente_vobo', approved_by_names: { jaguayo: 'Nuevo' }, approval_stages: ['jaguayo', 'cleon'] } }, opaque, plus, minus], p);
  assert.ok(result.every(op => op.path !== sourcePath && op.path !== `${sourcePath}/approved_by_names` && op.path !== `${sourcePath}/approval_stages`));
  assert.equal(result.find(op => op.path === `${sourcePath}/approved_by_names/jaguayo`).value, 'Nuevo');
  assert.equal(result.find(op => op.path === `${sourcePath}/approval_stages/1`).value, 'cleon');
  assert.ok(result.includes(opaque)); assert.equal(result.find(op => op.path === plus.path).value, plus.value); assert.equal(result.find(op => op.path === minus.path).value, minus.value);
  assert.ok(!result.some(op => op.path.includes('/metadata') || op.path.endsWith('/nota_cleon')));
});

for (const [label, patch] of [['proto', JSON.parse('{"__proto__":{"polluted":true}}')], ['forbidden path', { 'constructor/prototype/x': 1 }], ['sparse array', { approval_stages: [, 'cleon'] }]]) test(`save rechaza ${label} antes de cualquier commit/HTTP`, async () => {
  const h = harness(); h.seed(sourcePath, initial());
  await assert.rejects(h.client.save({ kind: 'permission.panel_stage_approved', sourceId: 'source-1', before: initial(), patch }));
  assert.equal(h.calls.update.length, 0); assert.equal(h.calls.http.length, 0); assert.equal({}.polluted, undefined);
});

test('getter de fábrica/after nunca se ejecuta y after inválido no produce side effects', () => {
  const h = harness(); let invoked = false;
  assert.throws(() => prepare(h, { after: { get id() { invoked = true; return 'source-1'; } } }));
  assert.equal(invoked, false); assert.equal(h.calls.update.length, 0);
});

for (const blockedCount of [3, 10]) test(`despacho directo fresco no queda oculto por ${blockedCount} marcadores antiguos bloqueados`, async () => {
  const old = Array.from({ length: blockedCount }, (_, n) => id(n));
  const h = harness({ fetch: async (_, request) => h.response(old.includes(JSON.parse(request.body).event_id) ? 403 : 200) });
  for (const key of old) h.seed(`notice_pending/uid-own/${key}`, { created_at: 1 });
  assert.equal((await h.client.flush()).blocked, blockedCount);
  const fresh = id(999); h.seed(`notice_pending/uid-own/${fresh}`, { created_at: 2 });
  assert.equal((await h.client.dispatchCommitted(fresh)).accepted, 1);
  assert.deepEqual(h.calls.get.at(-1), { path: `notice_pending/uid-own/${fresh}` });
  assert.ok(old.every(key => h.valueAt(`notice_pending/uid-own/${key}`))); assert.equal(h.valueAt(`notice_pending/uid-own/${fresh}`), undefined);
});

test('página con diez bloqueados avanza startAfter para entregar otros diez, sin polling', async () => {
  const h = harness({ fetch: async (_, request) => h.response(JSON.parse(request.body).event_id < id(10) ? 403 : 200) });
  for (let n = 0; n < 20; n++) h.seed(`notice_pending/uid-own/${id(n)}`, { created_at: n });
  assert.equal((await h.client.flush()).blocked, 10); assert.equal((await h.client.flush()).accepted, 10);
  assert.deepEqual(h.calls.get[1], { path: 'notice_pending/uid-own', constraints: [{ type: 'key' }, { type: 'after', key: id(9) }, { type: 'first', n: 10 }] });
  assert.equal(h.calls.maxActive, 1); assert.equal(h.timers.size, 0);
});

for (const status of [401, 429, 503]) test(`HTTP ${status} conserva marcador propio y nunca revierte data confirmada`, async () => {
  const h = harness({ fetch: async () => h.response(status, 'PRIVATE_RESPONSE') }), before = initial(); h.seed(sourcePath, before);
  const event = await h.client.save({ kind: 'permission.panel_stage_approved', sourceId: 'source-1', before, patch: { approval_stage: 'cleon' } }); await tick();
  assert.equal(h.valueAt(`${sourcePath}/approval_stage`), 'cleon'); assert.ok(h.valueAt(`notice_pending/uid-own/${event.id}`)); assert.equal(h.calls.remove.length, 0);
  if (status !== 401) { for (let n = 0; n < 299; n++) { h.advance(1000); await h.client.flush(); } assert.equal(h.calls.http.length, 1); h.advance(1000); await h.client.flush(); assert.equal(h.calls.http.length, 2); }
  assert.equal(h.calls.update.length, 1); assert.equal(h.timers.size, 0);
});

for (const phase of ['get', 'token', 'response']) test(`Auth cambia durante ${phase}: no HTTP en cuenta nueva ni delete previo`, async () => {
  const changed = auth => { auth.currentUser = { uid: 'wrong', email: 'wrong@fredinero.com', getIdToken: () => assert.fail('token otra cuenta') }; };
  const options = {};
  if (phase === 'get') options.get = changed;
  if (phase === 'token') options.token = auth => { changed(auth); return 'PRIVATE_JWT'; };
  if (phase === 'response') options.fetch = async auth => { changed(auth); return h.response(); };
  const h = harness(options); h.seed(`notice_pending/uid-own/${id(1)}`, { created_at: 1 });
  await h.client.dispatchCommitted(id(1)); assert.equal(h.calls.remove.length, 0); assert.equal(h.calls.http.length, phase === 'response' ? 1 : 0);
  assert.deepEqual(h.calls.get.map(r => r.path), [`notice_pending/uid-own/${id(1)}`]);
  await h.client.dispatchCommitted(id(1)); assert.equal(h.calls.get.length, 1);
});

test('save confirmado devuelve event aunque Auth cambie durante write, no dispatch ajeno ni mensaje de falso fallo que duplica', async () => {
  const h = harness({ update: async auth => { auth.currentUser = { uid: 'wrong', email: 'wrong@fredinero.com', getIdToken: () => assert.fail('token otra cuenta') }; } });
  h.seed(sourcePath, initial()); const event = await h.client.save({ kind: 'permission.panel_stage_approved', sourceId: 'source-1', before: initial(), patch: { estado: 'pendiente_vobo' } }); await tick();
  assert.equal(h.valueAt(`notice_events/${event.id}/id`), event.id); assert.ok(h.valueAt(`notice_pending/uid-own/${event.id}`)); assert.equal(h.calls.http.length, 0); assert.equal(h.calls.remove.length, 0);
});

test('update rechazado no crea event ni marcador ni despacha después de fallo', async () => {
  const h = harness({ update: async () => { throw Error('permission_denied'); } }); h.seed(sourcePath, initial());
  await assert.rejects(h.client.save({ kind: 'permission.panel_stage_approved', sourceId: 'source-1', before: initial(), patch: { estado: 'pendiente_vobo' } })); await tick();
  assert.equal(h.valueAt('notice_events'), undefined); assert.equal(h.valueAt('notice_pending'), undefined); assert.equal(h.calls.http.length, 0);
});

test('dispatchCommitted serializa dos IDs sin compartir incorrectamente el resultado ni desplazar cursor batch', async () => {
  const gate = deferred();
  const h = harness({ fetch: async (_, request) => JSON.parse(request.body).event_id === id(1) ? gate.promise : h.response() });
  for (const n of [1, 2]) h.seed(`notice_pending/uid-own/${id(n)}`, { created_at: 1 });
  const first = h.client.dispatchCommitted(id(1)); await tick();
  const second = h.client.dispatchCommitted(id(2)); await tick(); assert.equal(h.calls.http.length, 1);
  gate.resolve(h.response()); assert.equal((await first).accepted, 1); assert.equal((await second).accepted, 1);
  assert.deepEqual(h.calls.get.map(read => read.path), [`notice_pending/uid-own/${id(1)}`, `notice_pending/uid-own/${id(2)}`]);
  assert.equal(h.calls.maxActive, 1); assert.equal(h.timers.size, 0);
  h.seed(`notice_pending/uid-own/${id(0)}`, { created_at: 1 }); await h.client.flush();
  assert.ok(!h.calls.get.at(-1).constraints.some(c => c.type === 'after'), 'target no avanza cursor del batch');
  assert.equal(JSON.parse(h.calls.http.at(-1).body).event_id, id(0));
});

test('ID propio no confirmado lee exclusivamente leaf exists=false: cero tokens/HTTP; ID ajeno/ruta ni siquiera get', async () => {
  const h = harness();
  assert.deepEqual(await h.client.dispatchCommitted(id(1)), { accepted: 0, pending: 0, blocked: 0 });
  assert.deepEqual(h.calls.get, [{ path: `notice_pending/uid-own/${id(1)}` }]);
  assert.equal(h.calls.tokens.length, 0); assert.equal(h.calls.http.length, 0);
  for (const bad of ['n_wrong_001', 'x/y', id(1)+'\n', 'n_uid-own_'+ 'x'.repeat(257)]) await h.client.dispatchCommitted(bad);
  assert.equal(h.calls.get.length, 1); assert.equal(h.calls.remove.length, 0);
});

test('UID/email de sesión inválidos fallan localmente en prepare y jamás consultan fuente, pending o HTTP', async () => {
  const h = harness();
  for (const user of [null, { uid: 'uid/own', email: 'own@fredinero.com' }, { uid: 'a'.repeat(129), email: 'own@fredinero.com' }, { uid: 'uid-own', email: 'own@fredinero.com.evil' }]) {
    h.auth.currentUser = user; assert.throws(() => prepare(h)); await h.client.flush(); await h.client.dispatchCommitted(id(1));
  }
  assert.equal(h.calls.get.length, 0); assert.equal(h.calls.http.length, 0); assert.equal(h.calls.update.length, 0);
});
