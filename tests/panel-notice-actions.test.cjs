'use strict';
// node --test tests/panel-notice-actions.test.cjs — callbacks reales index.html + notice-client real; FB/DOM/HTTP simulados.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '..'), html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const tick = async () => { for (let n = 0; n < 60; n++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function realFunction(name, action = false) {
  const pattern = action ? `^  window\\.${name} = (?:async )?function\\([^\\n]*\\) \\{\\n[\\s\\S]*?^  \\};`
    : `^  (?:async )?function ${name}\\([^\\n]*\\) \\{\\n[\\s\\S]*?^  \\}`;
  const result = html.match(new RegExp(pattern, 'm')); assert.ok(result, `Callback/helper real: ${name}`); return result[0];
}
function load(name) {
  const compiled = ts.transpileModule(fs.readFileSync(path.join(root, name), 'utf8'), { compilerOptions: { allowJs: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} }; new Function('require', 'module', 'exports', compiled)(dep => {
    assert.equal(dep, './notice-contract.generated.js'); return load(dep.slice(2));
  }, module, module.exports); return module.exports;
}
const { makePanelNoticeClient } = load('notice-client.js');
const functions = ['approvalStageLabel', 'vpCorreoActual', 'vpEsSoporte', 'vpEsCleon', 'vpSolicitudEnEtapaFinal', 'vpPuedeGestionarFlujo',
  'vpVacacionEnEtapaFinal', 'vpPuedeEditarVacacion', 'vpRutaFlujo', 'vpSolicitudActual', 'vacGetEstado', 'vacParseFecha',
  'vpIsAlfredo', 'vpVacacionCleonEstaFinalizada', 'vpPuedeResponderVacacionCleon'];
const actions = ['vpAprobarFlujo', 'vpDevolverFlujo', 'saveVacEdit', 'alfredoResponder'];
const canonical = html.match(/^  async function panelNoticeCanonical\(path\)\{[^\n]+\}/m)?.[0]; assert.ok(canonical);
function initial(tipo = 'permisos') { return { id: 'source-1', _tipo: tipo, uid: 'owner', user_uid: 'owner', correo: 'owner@fredinero.com', nombre: 'Caso', rol: 'GESTOR', plaza: 'TAMPICO',
  estado: 'sin_responder', approval_stage: 'jaguayo', approval_stages: ['jaguayo', 'cleon'], fecha_inicio: '3/1/2026', fecha_fin: '4/1/2026',
  motivo: 'canonical-original', nota_cleon: 'NOTA OPACA', metadata: { untouched: true, opaque: { number: 1 } }, approved_by_names: { jaguayo: 'Viejo', cleon: 'RH' } }; }
function harness(options = {}) {
  let tree = {}, uuid = 0;
  const calls = { get: [], update: [], remove: [], http: [], alerts: [], refresh: 0, tokens: 0 };
  const auth = { currentUser: { uid: 'actor', email: options.email || 'soporte@fredinero.com', getIdToken: async () => { calls.tokens++; return 'FAKE_JWT'; } } };
  function valueAt(p) { return p ? p.split('/').reduce((node, key) => node?.[key], tree) : tree; }
  function setAt(target, p, value) { const parts = p.split('/'); let cursor = target; for (const key of parts.slice(0, -1)) cursor = cursor[key] ??= {}; if (value === null) delete cursor[parts.at(-1)]; else cursor[parts.at(-1)] = structuredClone(value); }
  const firebase = {
    ref: (_, p = '') => ({ path: p }), query: (r, ...constraints) => ({ ...r, constraints }), orderByKey: () => 'key', startAfter: key => ({ after: key }), limitToFirst: n => ({ first: n }),
    get: async r => { calls.get.push(r); assert.match(r.path, /^(permission_requests|vacation_requests)\/source-1$|^cleon_solicitudes\/vacaciones\/source-1$|^notice_pending\/actor\/n_actor_/);
      if (!r.path.startsWith('notice_pending/') && options.get) await options.get(auth);
      const value = valueAt(r.path); return { exists: () => value != null, val: () => value == null ? null : structuredClone(value), forEach: () => assert.fail('No fallback de colección') }; },
    update: async (r, changes) => { assert.equal(r.path, ''); const keys = Object.keys(changes); assert.ok(keys.every(p => keys.every(q => p === q || !q.startsWith(`${p}/`)))); calls.update.push(structuredClone(changes));
      if (options.update) await options.update(auth, changes); const next = structuredClone(tree); for (const [p, v] of Object.entries(changes)) setAt(next, p, v); tree = next; },
    remove: async r => { calls.remove.push(r.path); setAt(tree, r.path, null); },
  };
  const ids = Object.fromEntries(Object.entries({ vacEditId: 'source-1', vacEditIni: '3/1/2026', vacEditFin: '4/1/2026', vacEditDias: '2', vacEditNota: 'Actualizada', vacEditEstado: 'sin_responder', alfredoNota: 'Motivo legítimo', vacEditModal: '', vacPermSection: '', alfredredoModal: '', alfredoModal: '' }).map(([id, value]) => [id, { value, style: {} }]));
  const panelNotices = makePanelNoticeClient({ auth, database: {}, ...firebase, uuid: () => `id-${++uuid}`, now: () => 1793700000000,
    fetchImpl: async (url, request) => { assert.equal(auth.currentUser?.uid, 'actor'); const eventId = JSON.parse(request.body).event_id;
      assert.ok(valueAt(`notice_events/${eventId}`) && valueAt(`notice_pending/actor/${eventId}`)); calls.http.push({ url, ...request });
      const status = options.httpStatus || 200; return { status, ok: status === 200, text: async () => JSON.stringify({ ok: true, event_committed: true, accepted: 1 }) }; } });
  const window = { buscarVacPerm: () => { calls.refresh++; }, loadVacaciones: () => { calls.refresh++; }, loadAlfredoSolicitudes: () => { calls.refresh++; } };
  const doc = { getElementById: id => { assert.ok(ids[id], `DOM desconocido ${id}`); return ids[id]; } };
  const script = `const VP_SOPORTE_EMAIL='soporte@fredinero.com',VP_CLEON_EMAIL='cleon@fredinero.com';
    const panelNoticeBusy=new Set();let _vpData=[],vacData=[],_alfredoSolActiva=null;
    ${canonical}\n${functions.map(name => realFunction(name)).join('\n')}\n${actions.map(name => realFunction(name, true)).join('\n')}
    return {window,setRows:(rows)=>{_vpData=rows;vacData=rows;},setAlfredo:(row)=>{_alfredoSolActiva=row;},busy:()=>panelNoticeBusy.size};`;
  const api = new Function('auth', 'database', 'get', 'ref', 'panelNotices', 'document', 'window', 'alert', 'confirm', 'prompt', script)(
    auth, {}, firebase.get, firebase.ref, panelNotices, doc, window, text => calls.alerts.push(String(text)), () => true, () => 'Devolver por motivo');
  return { auth, calls, ids, api, valueAt, seed: (p, value) => setAt(tree, p, value), rows: rows => api.setRows(rows),
    event: () => Object.values(valueAt('notice_events') || {})[0] };
}
function seed(h, type = 'permisos', row = initial(type)) { const collection = type === 'permisos' ? 'permission_requests' : 'vacation_requests'; h.seed(`${collection}/source-1`, row); h.rows([structuredClone(row)]); return row; }
function assertCommit(h, kind, source) {
  assert.equal(h.calls.update.length, 1); assert.equal(h.calls.get.filter(r => !r.path.startsWith('notice_pending/')).length, 1);
  const event = h.event(); assert.ok(event); assert.equal(event.kind, kind); assert.equal(event.actor_uid, 'actor');
  assert.equal(h.valueAt(`${source}/last_notice_id`), event.id); assert.equal(h.valueAt(`${source}/notice_validation/${kind.replace(/[.-]/g, '_')}`), event.id);
  assert.deepEqual(h.calls.get.filter(r => r.path.startsWith('notice_pending/')).map(r => r.path), [`notice_pending/actor/${event.id}`]);
  assert.equal(h.api.busy(), 0); assert.equal(h.valueAt(`${source}/metadata/untouched`), true);
  return event;
}

test('callbacks reales existen con locks, no se inventan vpConfirmar/vpGuardarCambios/vpEditGuardar ausentes', () => {
  for (const action of actions) { const source = realFunction(action, true); assert.match(source, /panelNoticeBusy\.has/); assert.match(source, /finally.*panelNoticeBusy\.delete/); assert.match(source, /panelNoticeCanonical/); assert.doesNotMatch(source, /sendEmail|sendNotification|fetch\(/); }
});

for (const type of ['permisos', 'vacaciones']) test(`aprobar ${type} obtiene un before canónico una sola vez y guarda event/proof/pending atómicamente`, async () => {
  const h = harness(), row = seed(h, type); h.rows([{ ...row, motivo: 'cached-stale', fecha_inicio: '9/9/1999' }]);
  await h.api.window.vpAprobarFlujo('source-1', type); await tick();
  const event = assertCommit(h, `${type === 'permisos' ? 'permission' : 'vacation'}.panel_stage_approved`, `${type === 'permisos' ? 'permission' : 'vacation'}_requests/source-1`);
  assert.equal(event.before.fecha_inicio, '3/1/2026'); if(type === 'permisos') assert.equal(event.before.motivo, 'canonical-original');
  assert.equal(event.after.approval_stage, 'cleon'); assert.equal(event.after.approved_by_names.jaguayo, 'soporte@fredinero.com');
  assert.equal(h.calls.http.length, 1); assert.equal(h.calls.refresh, 1);
});

for (const type of ['permisos', 'vacaciones']) test(`devolver ${type} conserva motivo canónico y registra before/after + timestamp en un commit`, async () => {
  const h = harness(); seed(h, type, { ...initial(type), approval_stage: 'cleon' });
  await h.api.window.vpDevolverFlujo('source-1', type); await tick();
  const event = assertCommit(h, `${type === 'permisos' ? 'permission' : 'vacation'}.panel_returned`, `${type === 'permisos' ? 'permission' : 'vacation'}_requests/source-1`);
  assert.equal(event.before.approval_stage, 'cleon'); assert.equal(event.after.approval_stage, 'jaguayo'); assert.equal(event.after.devolucion_desde, 'cleon');
  assert.equal(event.after.motivo_devolucion, 'Devolver por motivo'); assert.equal(event.created_at, event.after.devolucion_timestamp);
});

test('RH aprobación final usa kind correcto y política canónica sin alterar semántica', async () => {
  const h = harness({ email: 'cleon@fredinero.com' }); seed(h, 'permisos', { ...initial(), approval_stage: 'cleon' });
  await h.api.window.vpAprobarFlujo('source-1', 'permisos'); await tick(); const event = assertCommit(h, 'permission.panel_final_approved', 'permission_requests/source-1');
  assert.equal(event.after.approval_stage, 'completado'); assert.equal(event.after.estado, 'aprobado_final'); assert.equal(event.after.visto_bueno_cleon, true);
});

test('editar vacación actual ejecuta saveVacEdit real, preserva fechas legacy de un dígito y campos opacos', async () => {
  const h = harness(); seed(h, 'vacaciones'); await h.api.window.saveVacEdit(); await tick();
  const event = assertCommit(h, 'vacation.panel_edited', 'vacation_requests/source-1');
  assert.equal(event.before.fecha_inicio, '3/1/2026'); assert.equal(event.after.fecha_inicio_aprobada, '3/1/2026'); assert.equal(event.after.dias_aprobados, 2);
  assert.equal(h.valueAt('vacation_requests/source-1/nota_cleon'), 'NOTA OPACA'); assert.equal(h.calls.http.length, 1);
});

for (const action of ['vpAprobarFlujo', 'vpDevolverFlujo', 'saveVacEdit']) test(`doble ${action} mientras canonical read espera: una lectura/commit/aviso`, async () => {
  const gate = deferred(), h = harness({ get: () => gate.promise }); seed(h, action === 'saveVacEdit' ? 'vacaciones' : 'permisos');
  const args = action === 'saveVacEdit' ? [] : ['source-1', 'permisos'];
  const first = h.api.window[action](...args); await tick(); await h.api.window[action](...args);
  assert.equal(h.calls.get.length, 1); assert.equal(h.calls.update.length, 0); gate.resolve(); await first; await tick();
  assert.equal(h.calls.update.length, 1); assert.equal(h.calls.http.length, 1); assert.equal(h.api.busy(), 0);
});

for (const action of ['vpAprobarFlujo', 'vpDevolverFlujo', 'saveVacEdit']) test(`${action} rechaza fuente que concluyó después del cache sin commit`, async () => {
  const h = harness(), type = action === 'saveVacEdit' ? 'vacaciones' : 'permisos'; const row = seed(h, type);
  h.seed(`${type === 'permisos' ? 'permission' : 'vacation'}_requests/source-1`, { ...row, approval_stage: 'completado', visto_bueno_cleon: true });
  await h.api.window[action](...(action === 'saveVacEdit' ? [] : ['source-1', type])); await tick();
  assert.equal(h.calls.update.length, 0); assert.equal(h.calls.http.length, 0); assert.equal(h.api.busy(), 0);
});

for (const email of ['alfredo@fredinero.com', 'gestor@fredinero.com', 'lgallegos@fredinero.com']) test(`política existente ${email} no obtiene aprobación/edición extra de solicitudes comunes`, async () => {
  const h = harness({ email }); seed(h); await h.api.window.vpAprobarFlujo('source-1', 'permisos'); await h.api.window.vpDevolverFlujo('source-1', 'permisos');
  seed(h, 'vacaciones'); await h.api.window.saveVacEdit(); await tick();
  assert.equal(h.calls.get.length, 0); assert.equal(h.calls.update.length, 0); assert.equal(h.calls.http.length, 0);
});

for (const status of ['aprobada_alfredo', 'rechazada_alfredo']) test(`Alfredo ${status} sólo vacación Cleon: before canónico y un marker/proof/HTTP dispatch sin proveedores directos`, async () => {
  const h = harness({ email: 'alfredo@fredinero.com' }), row = { ...initial('vac'), correo: 'cleon@fredinero.com', user_email: 'cleon@fredinero.com', estado: 'pendiente_alfredo' };
  h.seed('cleon_solicitudes/vacaciones/source-1', row); h.api.setAlfredo(structuredClone(row));
  await h.api.window.alfredoResponder(status); await tick();
  const event = assertCommit(h, `cleon-vacation.${status === 'aprobada_alfredo' ? 'approved' : 'rejected'}`, 'cleon_solicitudes/vacaciones/source-1');
  assert.equal(event.before.estado, 'pendiente_alfredo'); assert.equal(event.after.estado, status); assert.equal(event.after.respondido_por, 'alfredo@fredinero.com'); assert.equal(h.calls.http.length, 1);
});

test('Alfredo no resuelve permiso ni estado arbitrario ni vacación ya finalizada', async () => {
  for (const [type, beforeState, result] of [['perm', 'pendiente_alfredo', 'aprobada_alfredo'], ['vac', 'aprobada_alfredo', 'rechazada_alfredo'], ['vac', 'pendiente_alfredo', 'intruso']]) {
    const h = harness({ email: 'alfredo@fredinero.com' }), row = { ...initial(type), estado: beforeState, correo: 'cleon@fredinero.com' };
    h.seed('cleon_solicitudes/vacaciones/source-1', row); h.api.setAlfredo(row); await h.api.window.alfredoResponder(result); await tick();
    assert.equal(h.calls.update.length, 0); assert.equal(h.calls.http.length, 0); assert.equal(h.api.busy(), 0);
  }
});

test('HTTP503 después de aprobación no revierte datos ni provoca UI error de save ni segunda mutación', async () => {
  const h = harness({ httpStatus: 503 }); seed(h); await h.api.window.vpAprobarFlujo('source-1', 'permisos'); await tick();
  const event = assertCommit(h, 'permission.panel_stage_approved', 'permission_requests/source-1');
  assert.equal(h.valueAt('permission_requests/source-1/approval_stage'), 'cleon'); assert.ok(h.valueAt(`notice_pending/actor/${event.id}`));
  assert.equal(h.calls.remove.length, 0); assert.equal(h.calls.update.length, 1); assert.ok(h.calls.alerts.some(text => text.includes('Solicitud enviada')));
});
