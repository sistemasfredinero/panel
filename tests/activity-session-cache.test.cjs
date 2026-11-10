'use strict';
// Callback real del panel, perfiles ficticios y ningún acceso a red.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const callback = html.match(/^  onAuthStateChanged\(auth, async \(user\) => \{\n[\s\S]*?^  \}\);/m);
assert.ok(callback, 'Callback de sesión productivo');
function harness(read = async () => ({ val: () => ({ rol: 'ADMINISTRATIVO' }) })) {
  const nodes = new Map(), reads = [], rendered = [];
  let authCallback, invalidations = 0;
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { style: { display: 'block' }, classList: { remove: value => { nodes.get(id).removed = value; } }, reset() {} });
    return nodes.get(id);
  };
  const context = vm.createContext({
    auth: { currentUser: null }, window: { resetSupportProfileCheck() {}, __activityRouteGroups: ['old'] },
    database: {}, ref: (_, route) => route, get: async route => { reads.push(route); return read(route); },
    document: { getElementById: node }, onAuthStateChanged: (_, cb) => { authCallback = cb; },
    invalidateActivityQueryCache: () => { invalidations++; },
    _activityQueryContext: 'old', _activityProfile: { rol: 'GERENTE' }, _activitiesData: ['old'], _activitiesFiltered: ['old'],
    _prospectAdminData: ['old'], _calendarDetailRecords: new Map([['old', { nombre: 'Anterior' }]]), _panelProfile: {},
    resetSupportWorkerDiagnostic() {}, resetSupportEmailTest() {}, resetSupportFcmDiagnostic() {},
    resetSupportNoticeDirectory() {}, resetSupportNoticeSetup() {}, panelNotices: { flush: async () => {} },
    applyPanelRoleAccess() {}, applyRequestManagementAccess() {}, applyPrivacyAdminAccess() {}, setDefaultDates() {},
    setPanelHeader: name => rendered.push({ name, user: context.auth.currentUser.uid, profile: context._panelProfile }),
  });
  vm.runInContext(callback[0], context);
  return { context, node, reads, rendered, invalidations: () => invalidations, change: async user => { context.auth.currentUser = user; return authCallback(user); } };
}
const user = uid => ({ uid, email: `${uid}@example.test` });
test('logout limpia resultados, metadatos visuales y ventanas de la cuenta anterior sin lecturas', async () => {
  const h = harness(); await h.change(null);
  assert.equal(h.invalidations(), 1); assert.equal(h.reads.length, 0);
  assert.equal(h.context._activityQueryContext, ''); assert.equal(h.context._activityProfile, null);
  for (const key of ['_activitiesData', '_activitiesFiltered', '_prospectAdminData']) assert.equal(h.context[key].length, 0);
  assert.equal(h.context._calendarDetailRecords.size, 0); assert.equal(h.context.window.__activityRouteGroups.length, 0);
  for (const id of ['activitiesSection', 'activityResponseChartsModal', 'prospectCalendarModal', 'pendingProspectsModal']) assert.equal(h.node(id).style.display, 'none');
  assert.equal(h.node('activityRoutesMapModal').removed, 'active');
  assert.equal(h.node('app').style.display, 'none');
});
test('cambio rápido de cuentas descarta el perfil tardío y no repinta la sesión anterior', async () => {
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const h = harness(async route => {
    if (route === 'users/first') await waiting;
    return { val: () => ({ rol: 'ADMINISTRATIVO', nombre: route }) };
  });
  const first = h.change(user('first'));
  await h.change(user('second'));
  release(); await first;
  assert.equal(h.invalidations(), 2); assert.equal(h.rendered.length, 1);
  assert.equal(h.rendered[0].user, 'second'); assert.equal(h.context._panelProfile.nombre, 'users/second');
  assert.equal(h.node('adminName').textContent, 'second@example.test');
});
test('logout mientras llega perfil no reabre el panel ni restaura privilegios', async () => {
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const h = harness(async () => { await waiting; return { val: () => ({ rol: 'GERENTE' }) }; });
  const entering = h.change(user('first'));
  await h.change(null); release(); await entering;
  assert.equal(h.rendered.length, 0); assert.equal(Object.keys(h.context._panelProfile).length, 0);
  assert.equal(h.node('app').style.display, 'none'); assert.equal(h.node('loginOverlay').style.display, 'flex');
});
