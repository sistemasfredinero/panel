'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function fn(name) { const match = html.match(new RegExp(`^  (?:async )?function ${name}\\([^\\n]*\\) \\{(?:[^\\n]*\\}$|\\n[\\s\\S]*?^  \\})`, 'm')); assert.ok(match, name); return match[0]; }
function harness({ values = { rol: 'GERENTE', plaza: 'CHIHUAHUA' }, beforeRead } = {}) {
  const reads = [], usage = [];
  let now = Date.now(), active = 0, maximum = 0;
  class Clock extends Date { static now() { return now; } }
  const auth = { currentUser: { uid: 'synthetic', email: 'synthetic@example.test' } };
  const context = vm.createContext({ auth, database: {}, Date: Clock, ref: (_, route) => route,
    get: async route => { assert.match(route, /^users\/synthetic\/(rol|plaza|role)$/); reads.push(route); active++; maximum = Math.max(maximum, active); try { if (beforeRead) await beforeRead(route, auth); await Promise.resolve(); return { val: () => values[route.split('/').pop()] ?? null }; } finally { active--; } },
    recordPanelDataUsage: (action, data) => usage.push({ action, ...data }),
  });
  vm.runInContext('const PANEL_SESSION_PROFILE_TTL_MS=300000;let _panelSessionProfileCache=null;let _panelSessionProfileGeneration=0;\n' + ['normaliseActivityText', 'resetPanelSessionProfile', 'loadPanelSessionProfile'].map(fn).join('\n') + '\nglobalThis.api={resetPanelSessionProfile,loadPanelSessionProfile};', context);
  return { api: context.api, auth, reads, usage, max: () => maximum, advance: ms => { now += ms; } };
}
test('perfil canónico necesita sólo dos hojas, nunca métricas, correo, expediente ni perfil integral', async () => {
  const h = harness({ values: { rol: 'GERENTE', plaza: 'CHIHUAHUA', data_usage_metrics: 'NO DESCARGAR'.repeat(100000) } });
  const result = await h.api.loadPanelSessionProfile();
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { rol: 'GERENTE', plaza: 'CHIHUAHUA' });
  assert.deepEqual(h.reads.sort(), ['users/synthetic/plaza', 'users/synthetic/rol']); assert.equal(h.max(), 2);
  assert.equal(h.usage.length, 1); assert.equal(h.usage[0].action, 'PANEL_SESSION_PROFILE_SCALARS');
});
test('aperturas repetidas e in-flight comparten perfil sin red adicional', async () => {
  const h = harness();
  await Promise.all([h.api.loadPanelSessionProfile(), h.api.loadPanelSessionProfile(), h.api.loadPanelSessionProfile()]);
  await h.api.loadPanelSessionProfile(); assert.equal(h.reads.length, 2);
  h.advance(300001); await h.api.loadPanelSessionProfile(); assert.equal(h.reads.length, 4);
  h.api.resetPanelSessionProfile(); await h.api.loadPanelSessionProfile(); assert.equal(h.reads.length, 6);
});
test('alias role se consulta sólo si rol no existe; no amplia la plaza', async () => {
  const h = harness({ values: { role: 'GERENTE', plaza: 'TAMPICO' } });
  const result = await h.api.loadPanelSessionProfile(); assert.equal(result.rol, 'GERENTE'); assert.equal(result.plaza, 'TAMPICO');
  assert.equal(h.reads.length, 3); assert.equal(h.reads[2], 'users/synthetic/role');
});
for (const [name, values] of [['rol ausente', { plaza: 'CHIHUAHUA' }], ['rol objeto', { rol: { name: 'ADMINISTRATIVO' }, plaza: 'CHIHUAHUA' }], ['gerente sin plaza', { rol: 'GERENTE' }], ['plaza inválida', { rol: 'GERENTE', plaza: true }]]) test(`perfil ${name}: falla cerrado`, async () => {
  const h = harness({ values }); await assert.rejects(h.api.loadPanelSessionProfile(), /incompletos/); assert.equal(h.usage.length, 0);
});
for (const stage of ['logout', 'reset']) test(`perfil tardío tras ${stage}: no se guarda ni registra para otra sesión`, async () => {
  let release, entered; const waiting = new Promise(resolve => { entered = resolve; }); const blocked = new Promise(resolve => { release = resolve; });
  const h = harness({ beforeRead: async () => { entered(); await blocked; } });
  const loading = h.api.loadPanelSessionProfile(); await waiting;
  if (stage === 'logout') h.auth.currentUser = null; else h.api.resetPanelSessionProfile();
  release(); await assert.rejects(loading, /sesión cambió/); assert.equal(h.usage.length, 0);
});
test('UID inválido o sesión ausente bloquean antes de cualquier solicitud', async () => {
  const h = harness(); h.auth.currentUser.uid = 'other/path'; await assert.rejects(h.api.loadPanelSessionProfile(), /validar la sesión/); assert.equal(h.reads.length, 0);
  h.auth.currentUser = null; await assert.rejects(h.api.loadPanelSessionProfile(), /validar la sesión/); assert.equal(h.reads.length, 0);
});
test('Auth, Actividades y calendario utilizan la proyección mínima sin lecturas integrales del operador', () => {
  assert.match(html, /profile = await loadPanelSessionProfile\(user\)/);
  assert.match(html, /const profile = await loadPanelSessionProfile\(sessionUser\)/);
  assert.match(html, /_activityProfile = await loadPanelSessionProfile\(\)/);
  assert.ok(!html.includes('get(ref(database, `users/${auth.currentUser.uid}`))'));
  assert.ok(!html.includes('get(ref(database, `users/${user.uid}`))'));
});
