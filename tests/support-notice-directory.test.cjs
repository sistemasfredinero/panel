'use strict';

// Funciones REALES de index.html; sin navegador, red, SDK ni credenciales reales.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const html = readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const UID = '5dVKDIhQZlbzonMbSG9mX1pXHYg1';
const PRIVATE = 'TEST_ONLY_PRIVATE_PASSWORD_FCM_METRIC';
const plain = value => JSON.parse(JSON.stringify(value));
const profile = (email = 'persona@fredinero.com', extra = {}) => ({ correo: email, rol: 'LÍDER A', plaza: ' TÁMPICO ', nombre_completo: 'Persona', ...extra });
const row = (uid, p = profile()) => ({ uid, profile: p });

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
async function flush() { for (let i = 0; i < 20; i++) await Promise.resolve(); }
function snapshot(rows) {
  return {
    exists: () => rows.length > 0,
    val: () => Object.fromEntries(rows.map(r => [r.uid, r.profile])),
    forEach(fn) { for (const r of rows) if (fn({ key: r.uid, val: () => r.profile }) === true) break; },
  };
}

function harness(t, { user, rows = [row('actual-child-key')], hooks = {} } = {}) {
  const reads = [], writes = [], confirms = [], forbidden = [], domWrites = [];
  const timers = new Map(); let nextTimer = 0, now = 1000000;
  const deny = name => () => { forbidden.push(name); throw new Error(`Prohibido ${name}`); };
  const nodes = new Proxy({}, { get(target, id) {
    if (!target[id]) target[id] = new Proxy({ textContent: '', style: {}, hidden: false, disabled: false, checked: false, value: '' }, {
      set(node, key, value) { if (['textContent', 'innerHTML'].includes(key)) domWrites.push({ id, key, value }); node[key] = value; return true; },
    });
    return target[id];
  } });
  const operator = { uid: UID, email: 'soporte@fredinero.com', getIdToken: deny('getIdToken') };
  const auth = { currentUser: user === undefined ? operator : user };
  const sandbox = {
    auth, database: {}, AbortController,
    Date: class extends Date { static now() { return now; } },
    document: { getElementById: id => nodes[id], querySelectorAll: () => [] },
    btoa: value => Buffer.from(value, 'binary').toString('base64'),
    setTimeout(fn, ms) { const id = ++nextTimer; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    ref(db, location) { assert.equal(db, sandbox.database); assert.ok(['users', 'privacy_consents', 'notice_directory'].includes(location), `Ruta inesperada ${location}`); return { location }; },
    orderByKey: () => ({ kind: 'orderByKey' }), startAfter: key => ({ kind: 'startAfter', key }), limitToFirst: count => ({ kind: 'limitToFirst', count }),
    query(base, ...constraints) { return { ...base, constraints }; },
    get(request) {
      reads.push(plain(request));
      if (hooks.get) return hooks.get(request, reads.length);
      assert.ok(request.constraints, 'El nuevo flujo nunca lee users sin query');
      assert.deepEqual(plain(request.constraints.filter(c => c.kind !== 'startAfter')), [{ kind: 'orderByKey' }, { kind: 'limitToFirst', count: 10 }]);
      const cursor = request.constraints.find(c => c.kind === 'startAfter')?.key;
      const offset = cursor ? rows.findIndex(r => r.uid === cursor) + 1 : 0;
      return Promise.resolve(snapshot(rows.slice(offset, offset + 10)));
    },
    set(request, projection) {
      assert.equal(request.location, 'notice_directory');
      writes.push({ request: plain(request), projection: plain(projection) });
      return hooks.set ? hooks.set(request, projection) : Promise.resolve();
    },
    serverTimestamp: () => ({ '.sv': 'timestamp' }),
    confirm(message) { confirms.push(message); return hooks.confirm ? hooks.confirm(message, confirms.length) : true; },
    setPanelHeader() {}, privacyFormatDate: () => '',
  };
  for (const name of ['fetch', 'onValue', 'update', 'remove', 'push', 'runTransaction', 'sendEmail', 'sendAvisos', 'getAuth', 'initializeApp', 'signOut', 'getToken', 'recordPanelDataUsage']) sandbox[name] = deny(name);
  for (const name of ['console', 'localStorage', 'sessionStorage', 'indexedDB', 'caches']) sandbox[name] = new Proxy({}, { get: (_, key) => deny(`${name}.${String(key)}`) });
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext([
    ...['SUPPORT_WORKER_UID', 'TAMPICO_MADERO_MANAGER_EMAIL', 'SUPPORT_NOTICE_FIELDS'].map(name => realDeclaration('const', name)),
    ...['_supportNoticeRun', '_supportNoticeBusy', '_supportNoticeController', '_supportNoticePrepared', '_supportNoticeCache'].map(name => realDeclaration('let', name)),
    ...['normaliseActivityText', 'privacyEscape', 'privacyIsSupport', 'supportWorkerIsAuthorized', 'applyPrivacyAdminAccess', 'supportNoticeProfile', 'supportNoticeKey', 'supportNoticeLabel', 'managerProfilePlazas', 'buildSupportNoticeDirectory', 'supportNoticeMessage', 'supportNoticeControls', 'resetSupportNoticeDirectory', 'supportNoticeWait'].map(realFunction),
    ...['prepareSupportNoticeDirectory', 'cancelSupportNoticeDirectory', 'saveSupportNoticeDirectory', 'showPrivacyConsentAdmin'].map(realWindowFunction),
    'globalThis.api = { buildSupportNoticeDirectory, supportNoticeProfile, managerProfilePlazas, resetSupportNoticeDirectory, applyPrivacyAdminAccess, state: () => ({ busy: _supportNoticeBusy, run: _supportNoticeRun, controller: _supportNoticeController, prepared: _supportNoticePrepared, cache: _supportNoticeCache }), cache: (rows, operator, at) => { _supportNoticeCache = { rows, operator, at }; } };',
  ].join('\n\n'), context);
  const h = { api: context.api, auth, operator, sandbox, nodes, reads, writes, confirms, hooks, timers, domWrites,
    prepare: () => sandbox.prepareSupportNoticeDirectory(), save: () => sandbox.saveSupportNoticeDirectory(), cancel: () => sandbox.cancelSupportNoticeDirectory(), reset: () => context.api.resetSupportNoticeDirectory(),
    status: nodes.supportNoticeDirectoryStatus, preview: nodes.supportNoticeDirectoryPreview,
    advance: ms => { now += ms; },
    async timeout() { for (const [id, job] of [...timers]) { timers.delete(id); job.fn(); } await flush(); },
    now: () => now,
  };
  h.api.resetSupportNoticeDirectory();
  t.after(() => {
    assert.deepEqual(forbidden, []);
    assert.equal(timers.size, 0, 'No timers/listeners de espera pendientes');
    assert.equal(h.api.state().busy, false);
    assert.equal(h.api.state().controller, null);
    for (const write of domWrites) {
      assert.ok(!String(write.value).includes(PRIVATE), 'Ningún secreto ni error bruto visible');
      if (String(write.id).startsWith('supportNotice')) assert.equal(write.key, 'textContent', 'Sin interpretar HTML');
    }
    assert.ok(!JSON.stringify(writes).includes(PRIVATE), 'Sólo campos permitidos en el índice');
  });
  return h;
}

function blocked(h, pattern) {
  assert.equal(h.api.state().prepared, null);
  assert.equal(h.nodes.supportNoticeDirectorySave.disabled, true);
  assert.equal(h.writes.length, 0);
  if (pattern) assert.match(h.preview.textContent + h.status.textContent, pattern);
}

test('UI requiere instalación y confirmaciones explícitas; sin ejecución al iniciar', t => {
  const h = harness(t);
  assert.match(html, /id="supportNoticeDirectoryEntry"[^>]*style="display:none/);
  assert.match(html, /Requiere reglas de avisos; no activar hasta instalación/);
  assert.match(html, /id="supportNoticeDirectoryPrepare"[^>]*onclick="window\.prepareSupportNoticeDirectory\(\)"/);
  assert.match(html, /id="supportNoticeDirectorySave"[^>]*disabled[^>]*onclick="window\.saveSupportNoticeDirectory\(\)"/);
  assert.match(html, /onAuthStateChanged\(auth, async \(user\) => \{\s*resetSupportWorkerDiagnostic\(\);\s*resetSupportEmailTest\(\);\s*resetSupportFcmDiagnostic\(\);\s*resetSupportNoticeDirectory\(\);/);
  h.api.applyPrivacyAdminAccess(); h.reset();
  assert.equal(h.nodes.supportNoticeDirectoryEntry.style.display, '');
  assert.deepEqual([h.reads.length, h.writes.length, h.confirms.length], [0, 0, 0]);
});

test('protege botón y ambos handlers: UID exacto Y correo; rol no concede acceso', async t => {
  const h = harness(t);
  for (const user of [null, {}, { uid: UID }, { email: 'soporte@fredinero.com' }, { uid: 'otro', email: 'soporte@fredinero.com' }, { uid: UID, email: 'otro@fredinero.com' }, { uid: UID, email: 'soporte@fredinero.com.evil' }]) {
    h.auth.currentUser = user; h.api.applyPrivacyAdminAccess(); h.reset();
    assert.equal(h.nodes.supportNoticeDirectoryEntry.style.display, 'none');
    await h.prepare(); await h.save(); h.cancel();
  }
  assert.deepEqual([h.reads.length, h.writes.length, h.confirms.length], [0, 0, 0]);
  h.auth.currentUser = { ...h.operator, email: ' SOPORTE@FREDINERO.COM ' };
  await h.prepare(); assert.ok(h.api.state().prepared);
});

test('proyección cerrada, UID real de child.key, correo ASCII base64url biyectivo y sin datos técnicos', async t => {
  const source = profile('  Persona.Prueba+uno@FREDINERO.COM ', { uid: 'UID-EMBEBIDO-INCORRECTO', email: 'persona.prueba+uno@fredinero.com', role: '  LIDER A ', nombre: 'Alternativo' });
  for (const field of ['password', 'contraseña', 'fcmToken', 'data_usage_metrics', 'photos', 'attendance', 'activities', 'notifications', 'transactions']) Object.defineProperty(source, field, { enumerable: true, get() { throw new Error(`No debe leerse ${field}`); } });
  const h = harness(t, { rows: [row('canonical-child', source)] });
  await h.prepare(); assert.equal(h.writes.length, 0);
  const p = h.api.state().prepared.projection;
  assert.deepEqual(Object.keys(p).sort(), ['by_uid', 'by_email', 'manager_coverage', 'managers_by_plaza'].sort());
  assert.deepEqual(plain(p.by_uid['canonical-child']), { uid: 'canonical-child', email: 'persona.prueba+uno@fredinero.com', role: 'LIDER A', plaza: 'TAMPICO', name: 'Persona', managedPlazas: [] });
  const key = Object.keys(p.by_email)[0];
  assert.match(key, /^[A-Za-z0-9_-]+$/); assert.equal(Buffer.from(key, 'base64url').toString(), 'persona.prueba+uno@fredinero.com');
  assert.equal(p.by_email[key], 'canonical-child');
  assert.ok(!JSON.stringify(p).includes('UID-EMBEBIDO'));
  await h.save(); assert.equal(h.writes.length, 1);
  assert.equal(Object.hasOwn(h.writes[0].projection, 'updated_at'), false);
  assert.equal(Object.hasOwn(h.writes[0].projection, 'version'), false);
  assert.match(h.confirms[1], /REEMPLAZAR ÚNICAMENTE notice_directory/);
  assert.match(h.status.textContent, /avisos operativos siguen sin activar/);
});

test('nombre usa nombre_completo, nombre o correo; ADMINISTRATIVO permite plaza vacía sin inventarla', t => {
  const h = harness(t);
  const report = h.api.buildSupportNoticeDirectory([row('admin', profile('admin@fredinero.com', { rol: 'ADMINISTRATIVO', plaza: null, nombre_completo: '', nombre: '' })), row('alternate', profile('otro@fredinero.com', { nombre_completo: ' ', nombre: 'Nombre alternativo' }))]);
  assert.deepEqual(plain(report.conflicts), []);
  assert.deepEqual(plain(report.projection.by_uid.admin), { uid: 'admin', email: 'admin@fredinero.com', role: 'ADMINISTRATIVO', plaza: '', name: 'admin@fredinero.com', managedPlazas: [] });
  assert.equal(report.projection.by_uid.alternate.name, 'Nombre alternativo');
});

test('correos duplicados abortan TODO y muestran ambos nombres/correo sin asignación arbitraria', async t => {
  const h = harness(t, { rows: [row('uno', profile('igual@fredinero.com', { nombre_completo: 'Primero' })), row('dos', profile(' IGUAL@fredinero.com ', { nombre_completo: 'Segundo' }))] });
  await h.prepare(); blocked(h, /Correo duplicado igual@fredinero.com: Primero \(uno\) \/ Segundo \(dos\)/);
  assert.match(h.preview.textContent, /Usuarios revisados: 2/);
  await h.save(); assert.equal(h.confirms.length, 1);
});

test('aliases contradictorios de correo o rol bloquean; aliases normalizados iguales sí funcionan', async t => {
  for (const extra of [{ email: 'diferente@fredinero.com' }, { role: 'GERENTE' }]) {
    const h = harness(t, { rows: [row('user', profile('persona@fredinero.com', extra))] });
    await h.prepare(); blocked(h, /Aliases .* contradictorios/);
  }
  const h = harness(t, { rows: [row('user', profile('persona@fredinero.com', { email: ' PERSONA@FREDINERO.COM ', role: 'LIDER A' }))] });
  await h.prepare(); assert.ok(h.api.state().prepared);
});

test('perfiles malformados, rol ausente, dominio externo y claves Firebase inválidas fallan cerrados', async t => {
  for (const p of [null, [], {}, profile('externo@example.test'), profile('user@fredinero.com.evil'), profile('ñ@fredinero.com'), profile('user@fredinero.com', { rol: '' }), profile('user@fredinero.com', { rol: {} }), profile('user@fredinero.com', { plaza: '' }), ...['BAD.PLAZA', 'BAD#PLAZA', 'BAD$PLAZA', 'BAD[PLAZA', 'BAD/PLAZA', 'BAD\u0000PLAZA'].map(plaza => profile('user@fredinero.com', { plaza }))]) {
    const h = harness(t, { rows: [row('good', profile('good@fredinero.com')), row('bad', p)] });
    await h.prepare(); blocked(h, /Conflictos\/bloqueos: 1/);
  }
  for (const uid of ['bad.key', 'bad/key', 'bad key', '', 'bad\u0000key']) {
    const h = harness(t, { rows: [row(uid)] }); await h.prepare(); blocked(h, /UID o perfil inválido/);
  }
});

test('fuente vacía nunca permite borrar directorio anterior', async t => {
  const h = harness(t, { rows: [] }); await h.prepare(); blocked(h, /Fuente vacía/); await h.save();
});

test('cobertura igual al helper vigente: arrays, CSV, objetos, aliases y Tampico–Madero', t => {
  const h = harness(t);
  const p = profile('gerente.tampico@fredinero.com', { rol: 'GERENTE', plaza: 'TAMPICO', plazas_a_cargo: ['MÁDERO', 'TAMPICO'], plazasACargo: 'MANTE, POZA', managed_plazas: { first: 'TUXPAN' }, managedPlazas: ['PAPANTLA'] });
  const report = h.api.buildSupportNoticeDirectory([row('gerente', p), row('gestor-historico', profile('gestor.madero@fredinero.com', { rol: 'GESTOR', plaza: 'MADERO' }))]);
  assert.deepEqual(plain(report.conflicts), []);
  assert.deepEqual(plain(report.projection.by_uid.gerente.managedPlazas), ['TAMPICO', 'MADERO', 'MANTE', 'POZA', 'TUXPAN', 'PAPANTLA']);
  assert.deepEqual(plain(report.projection.manager_coverage.gerente), { TAMPICO: true, MADERO: true, MANTE: true, POZA: true, TUXPAN: true, PAPANTLA: true });
  assert.equal(report.projection.managers_by_plaza.MADERO, 'gerente');
  assert.equal(report.projection.by_uid['gestor-historico'].email, 'gestor.madero@fredinero.com');
});

test('gerencia principal tiene prioridad; empates principales o de cobertura fallan sin first arbitrario', t => {
  const h = harness(t);
  const tampico = row('tampico', profile('gerente.tampico@fredinero.com', { rol: 'GERENTE', plaza: 'TAMPICO' }));
  const madero = row('madero', profile('gerente.madero@fredinero.com', { rol: 'GERENTE', plaza: 'MADERO' }));
  for (const rows of [[tampico, madero], [madero, tampico]]) {
    const p = h.api.buildSupportNoticeDirectory(rows).projection;
    assert.equal(p.managers_by_plaza.MADERO, 'madero'); assert.equal(p.managers_by_plaza.TAMPICO, 'tampico');
  }
  for (const rows of [[tampico, row('other', profile('other@fredinero.com', { rol: 'GERENTE', plaza: 'TAMPICO' }))], [tampico, row('other', profile('other@fredinero.com', { rol: 'GERENTE', plaza: 'MANTE', managedPlazas: ['MADERO'] }))]]) {
    const report = h.api.buildSupportNoticeDirectory(rows); assert.equal(report.projection, null); assert.match(report.conflicts.join('\n'), /Gerencia ambigua/);
  }
});

test('100 perfiles grandes se recorren en 10 por página, una lectura cada página y terminación explícita', async t => {
  const rows = Array.from({ length: 100 }, (_, i) => row(`uid-${String(i).padStart(3, '0')}`, profile(`persona${i}@fredinero.com`, { data_usage_metrics: { heavy: 'x'.repeat(51200) } })));
  const h = harness(t, { rows }); await h.prepare();
  assert.equal(h.reads.length, 11, 'Diez páginas llenas y última vacía para probar completitud');
  assert.equal(h.api.state().prepared.count, 100);
  assert.equal(Object.keys(h.api.state().prepared.projection.by_uid).length, 100);
  for (let page = 1; page < 11; page++) assert.equal(h.reads[page].constraints.find(c => c.kind === 'startAfter').key, rows[page * 10 - 1].uid);
  assert.ok(h.domWrites.some(w => /Página 10: hasta 10 usuarios; 90 revisados/.test(String(w.value))));
  assert.ok(JSON.stringify(h.api.state().prepared.projection).length < 30000);
});

test('fallo en segunda página descarta datos parciales y errores brutos, sin guardar ni reintentar', async t => {
  const h = harness(t, { hooks: { get: async (_, call) => {
    if (call === 1) return snapshot(Array.from({ length: 10 }, (_, i) => row(`id-${i}`, profile(`u${i}@fredinero.com`))));
    throw new Error(PRIVATE);
  } } });
  await h.prepare(); blocked(h, /ningún índice parcial/); await h.save();
  await flush(); assert.equal(h.reads.length, 2);
});

test('doble clic durante preparación y guardado produce una sola operación por acción', async t => {
  const get = deferred(), set = deferred();
  const h = harness(t, { hooks: { get: () => get.promise, set: () => set.promise } });
  const pending = h.prepare(); await h.prepare(); await h.save();
  assert.equal(h.nodes.supportNoticeDirectoryPrepare.disabled, true); assert.equal(h.reads.length, 1); assert.equal(h.confirms.length, 1);
  get.resolve(snapshot([row('user')])); await pending;
  const saving = h.save(); await h.save(); await h.prepare();
  assert.equal(h.writes.length, 1); assert.equal(h.confirms.length, 2); assert.equal(h.nodes.supportNoticeDirectorySave.disabled, true);
  set.resolve(); await saving; assert.equal(h.api.state().prepared, null);
});

test('cancelar es real sin esperar SDK colgado; lectura tardía no publica ni guarda', async t => {
  const get = deferred(); const h = harness(t, { hooks: { get: () => get.promise } });
  const pending = h.prepare(); const controller = h.api.state().controller;
  h.cancel(); await pending; assert.equal(controller.signal.aborted, true); blocked(h, /cancelada/);
  const status = h.status.textContent; get.resolve(snapshot([row('late')])); await flush();
  assert.equal(h.status.textContent, status); assert.equal(h.preview.textContent, ''); assert.equal(h.reads.length, 1);
});

test('timeout de página y escritura no cuelga, no reintenta ni acepta respuestas tardías', async t => {
  const get = deferred(); const h = harness(t, { hooks: { get: () => get.promise } });
  const pending = h.prepare(); await h.timeout(); await pending; blocked(h, /20 segundos/);
  get.resolve(snapshot([row('late')])); await flush(); assert.equal(h.api.state().prepared, null);
  const set = deferred(); h.hooks.get = async () => snapshot([row('user')]); h.hooks.set = () => set.promise;
  await h.prepare(); const saving = h.save(); await h.timeout(); await saving;
  assert.match(h.status.textContent, /^TIMEOUT:.*no confirmó el guardado/); assert.equal(h.writes.length, 1);
  const status = h.status.textContent; set.resolve(); await flush(); assert.equal(h.status.textContent, status);
});

test('cambio de sesión durante lectura, antes de confirmar o entre preview/save impide escritura', async t => {
  for (const change of ['logout', 'replace', 'email']) {
    const gate = deferred(); const h = harness(t, { hooks: { get: () => gate.promise } });
    const pending = h.prepare();
    if (change === 'logout') h.auth.currentUser = null;
    if (change === 'replace') h.auth.currentUser = { ...h.operator };
    if (change === 'email') h.auth.currentUser.email = 'otro@fredinero.com';
    h.reset(); await pending; gate.resolve(snapshot([row('late')])); await flush(); await h.save();
    assert.equal(h.preview.textContent, ''); assert.equal(h.writes.length, 0);
  }
  const h = harness(t); await h.prepare(); h.auth.currentUser = { ...h.operator }; await h.save(); assert.equal(h.writes.length, 0);
  h.hooks.confirm = () => { h.auth.currentUser = null; return true; }; await h.prepare(); assert.equal(h.reads.length, 1);
});

test('confirmación rechazada no inicia lecturas ni escrituras; guardar vuelve a verificar sesión tras confirm', async t => {
  const h = harness(t, { hooks: { confirm: () => false } }); await h.prepare(); assert.equal(h.reads.length, 0);
  h.hooks.confirm = () => true; await h.prepare(); h.hooks.confirm = () => false; await h.save(); assert.equal(h.writes.length, 0);
  h.hooks.confirm = () => { h.auth.currentUser = { ...h.operator }; return true; }; await h.save(); assert.equal(h.writes.length, 0);
});

test('reset invalida preview y limpia caché; finally anterior no libera operación nueva', async t => {
  const old = deferred(), next = deferred();
  const h = harness(t, { hooks: { get: (_, count) => count === 1 ? old.promise : next.promise } });
  const first = h.prepare(); h.reset(); const second = h.prepare(); await first;
  assert.equal(h.api.state().busy, true); assert.equal(h.timers.size, 1);
  old.resolve(snapshot([row('old')])); await flush(); assert.equal(h.api.state().busy, true);
  next.resolve(snapshot([row('new')])); await second; assert.ok(h.api.state().prepared.projection.by_uid.new);
  h.reset(); assert.equal(h.api.state().cache, null); assert.equal(h.preview.textContent, ''); blocked(h);
});

test('caché fresca completa de privacidad evita red; no incorpora consentimientos sin perfil', async t => {
  const h = harness(t, { hooks: { get: async request => request.location === 'users' ? snapshot([row('actual-key', profile())]) : { val: () => ({ orphan: { accepted: true } }) } } });
  await h.sandbox.showPrivacyConsentAdmin();
  assert.equal(h.reads.length, 2, 'Sólo lecturas preexistentes del botón Privacidad');
  assert.deepEqual(plain(h.api.state().cache.rows).map(r => r.uid), ['actual-key']);
  await h.prepare(); assert.equal(h.reads.length, 2); assert.equal(h.api.state().prepared.count, 1);
  assert.ok(h.domWrites.some(w => /sin descargas adicionales/.test(String(w.value))));
});

test('caché vencida, otra sesión o rebuild explícito obliga páginas completas; preview expira', async t => {
  for (const mode of ['expired', 'session', 'explicit']) {
    const h = harness(t); h.api.cache([row('cached')], mode === 'session' ? { ...h.operator } : h.operator, mode === 'expired' ? h.now() - 300000 : h.now());
    h.nodes.supportNoticeDirectoryFresh.checked = mode === 'explicit';
    await h.prepare(); assert.equal(h.reads.length, 1); assert.ok(h.api.state().prepared.projection.by_uid['actual-child-key']);
    h.advance(300000); await h.save(); assert.equal(h.writes.length, 0); blocked(h);
  }
});

test('PERMISSION_DENIED instruye aplicar reglas futuras; no escritura parcial ni reintento automático', async t => {
  const error = Object.assign(new Error(PRIVATE), { code: 'PERMISSION_DENIED' });
  const h = harness(t, { hooks: { set: async () => { throw error; } } }); await h.prepare(); await h.save();
  assert.match(h.status.textContent, /PERMISSION_DENIED: aplica primero las reglas futuras/);
  assert.equal(h.writes.length, 1); await h.save(); assert.equal(h.writes.length, 1);
  h.hooks.get = async () => { throw error; }; await h.prepare(); assert.match(h.status.textContent, /Aplica primero las reglas futuras/);
});

test('cancelar oculto durante escritura no libera doble clic; cambio de sesión descarta resultado tardío', async t => {
  const gate = deferred(); const h = harness(t, { hooks: { set: () => gate.promise } });
  await h.prepare(); const saving = h.save();
  assert.equal(h.nodes.supportNoticeDirectoryCancel.hidden, true);
  h.cancel(); assert.equal(h.api.state().busy, true); await h.save(); assert.equal(h.writes.length, 1);
  h.auth.currentUser = null; h.reset(); gate.resolve(); await saving;
  assert.equal(h.status.textContent, ''); assert.equal(h.preview.textContent, ''); assert.equal(h.nodes.supportNoticeDirectoryEntry.style.display, 'none');
});

test('carga tardía de privacidad de otra sesión nunca instala caché del directorio', async t => {
  const gate = deferred(); const h = harness(t, { hooks: { get: request => request.location === 'users' ? gate.promise : Promise.resolve({ val: () => ({}) }) } });
  const loading = h.sandbox.showPrivacyConsentAdmin(); h.auth.currentUser = { ...h.operator }; h.reset();
  gate.resolve(snapshot([row('stale')])); await loading; assert.equal(h.api.state().cache, null);
});

test('UID duplicado y controles en plaza/cobertura fallan cerrados; gerente no inspecciona métricas técnicas', t => {
  const h = harness(t);
  const duplicate = h.api.buildSupportNoticeDirectory([row('same', profile('first@fredinero.com')), row('same', profile('second@fredinero.com'))]);
  assert.equal(duplicate.projection, null); assert.match(duplicate.conflicts.join('\n'), /UID repetido/);
  for (const extra of [{ plaza: 'TAMPICO\n' }, { managedPlazas: ['MADERO\t'] }, { managedPlazas: ['MADERO/FORBIDDEN'] }]) {
    const report = h.api.buildSupportNoticeDirectory([row('manager', profile('gerente.tampico@fredinero.com', { rol: 'GERENTE', ...extra }))]);
    assert.equal(report.projection, null);
  }
  const manager = profile('gerente.tampico@fredinero.com', { rol: 'GERENTE' });
  Object.defineProperty(manager, 'data_usage_metrics', { enumerable: true, get() { throw new Error(PRIVATE); } });
  const report = h.api.buildSupportNoticeDirectory([row('manager', manager)]);
  assert.deepEqual(plain(report.conflicts), []); assert.equal(report.projection.managers_by_plaza.MADERO, 'manager');
});

test('nodo sólo data_usage_metrics se excluye sin escribir users, copiar métricas o conceder identidad', async t => {
  const technical = row('aVBW2N3iFmbMnXKAEjmrFIUGxC42', { data_usage_metrics: { '2026-11-02': { metric: PRIVATE } } });
  const h = harness(t, { rows: [technical, row('valid-user', profile('valid@fredinero.com'))] });
  await h.prepare();
  assert.match(h.preview.textContent, /Usuarios revisados: 2\nIdentidades válidas: 1\nNodos sólo de métricas excluidos: 1\nConflictos\/bloqueos: 0/);
  const prepared = h.api.state().prepared;
  assert.equal(prepared.count, 1);
  assert.deepEqual(Object.keys(prepared.projection.by_uid), ['valid-user']);
  assert.equal(prepared.projection.by_uid[technical.uid], undefined);
  assert.ok(!JSON.stringify(prepared.projection).includes('data_usage_metrics'));
  assert.equal(h.writes.length, 0);
  await h.save();
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].request.location, 'notice_directory');
  assert.match(h.confirms.at(-1), /con 1 identidades/);
  assert.ok(!JSON.stringify(h.writes).includes(technical.uid));
});

test('perfiles parciales junto a métricas, métricas malformadas y flags falsificados siguen bloqueando', async t => {
  for (const p of [
    { data_usage_metrics: {}, rol: 'GESTOR', plaza: 'TAMPICO' },
    { data_usage_metrics: {}, correo: '' },
    { data_usage_metrics: {}, correo: 'external@example.test', rol: 'GESTOR', plaza: 'TAMPICO' },
    { data_usage_metrics: {}, legacy_unknown: true },
    { data_usage_metrics: null }, { data_usage_metrics: [] }, { data_usage_metrics: 'wrong' },
    { __notice_metrics_only: true },
    { data_usage_metrics: {}, __notice_metrics_only: true },
    { data_usage_metrics: {}, email: 'valid@fredinero.com' },
  ]) {
    const h = harness(t, { rows: [row('technical-or-invalid', p), row('valid-user', profile('valid@fredinero.com'))] });
    await h.prepare(); blocked(h, /Conflictos\/bloqueos: 1/);
    assert.match(h.preview.textContent, /Nodos sólo de métricas excluidos: 0/);
  }
});

test('fuente con sólo métricas no permite reemplazar el directorio con uno vacío', async t => {
  const h = harness(t, { rows: [row('technical', { data_usage_metrics: { '2026-11-02': {} } })] });
  await h.prepare(); blocked(h, /sin perfiles válidos/);
  assert.match(h.preview.textContent, /Identidades válidas: 0\nNodos sólo de métricas excluidos: 1/);
  await h.save(); assert.equal(h.writes.length, 0);
});

test('paginación avanza por todas las claves aunque una página completa tenga sólo métricas', async t => {
  const technical = Array.from({ length: 10 }, (_, i) => row(`a-${i}`, { data_usage_metrics: { '2026-11-02': { count: i } } }));
  const valid = row('z-valid', profile('valid@fredinero.com'));
  const h = harness(t, { rows: [...technical, valid] });
  h.nodes.supportNoticeDirectoryFresh.checked = true;
  await h.prepare();
  assert.equal(h.reads.length, 2);
  assert.equal(h.reads[1].constraints.find(c => c.kind === 'startAfter').key, 'a-9');
  assert.equal(h.api.state().prepared.count, 1);
  assert.deepEqual(Object.keys(h.api.state().prepared.projection.by_uid), ['z-valid']);
  assert.match(h.preview.textContent, /Nodos sólo de métricas excluidos: 10/);
});

test('un perfil válido conserva sus avisos aunque tenga métricas; UID técnico inválido no se salta', async t => {
  const h = harness(t, { rows: [row('valid', profile('valid@fredinero.com', { data_usage_metrics: { secret: PRIVATE } }))] });
  await h.prepare();
  assert.equal(h.api.state().prepared.count, 1);
  assert.match(h.preview.textContent, /Nodos sólo de métricas excluidos: 0/);
  assert.equal(h.api.state().prepared.projection.by_uid.valid.email, 'valid@fredinero.com');
  const bad = harness(t, { rows: [row('bad/key', { data_usage_metrics: {} }), row('valid', profile('valid@fredinero.com'))] });
  await bad.prepare(); blocked(bad, /UID o perfil inválido/);
});

test('guardar convierte mapas sin prototipo a JSON compatible, preservando cada identidad y timestamp', async t => {
  const h = harness(t, { rows: [row('gestor', profile('gestor@fredinero.com')), row('manager', profile('manager@fredinero.com', { rol: 'GERENTE' }))] });
  await h.prepare();
  const prepared = h.api.state().prepared.projection;
  assert.equal(Object.getPrototypeOf(prepared.by_uid), null);
  assert.equal(Object.getPrototypeOf(prepared.by_email), null);
  const expected = plain(prepared);
  function sdkCompatible(value) {
    if (!value || typeof value !== 'object') return;
    assert.equal(typeof value.hasOwnProperty, 'function', 'El SDK requiere hasOwnProperty en cada mapa');
    for (const key of Object.keys(value)) { assert.ok(value.hasOwnProperty(key)); sdkCompatible(value[key]); }
  }
  h.hooks.set = (_, payload) => {
    sdkCompatible(payload);
    assert.deepEqual(plain(payload), expected);
    return Promise.resolve();
  };
  await h.save();
  assert.equal(h.writes.length, 1);
  assert.match(h.status.textContent, /Directorio protegido guardado/);
  assert.equal(Object.getPrototypeOf(prepared.by_uid), null, 'No se debilita construcción original');
});

test('claves reservadas no pueden interferir con prototipos o hasOwnProperty del SDK', async t => {
  for (const uid of ['__proto__', 'prototype', 'constructor', 'hasOwnProperty']) {
    const h = harness(t, { rows: [row(uid)] });
    await h.prepare(); blocked(h, /UID o perfil inválido/);
  }
  for (const plaza of ['__proto__', 'prototype', 'constructor', 'hasOwnProperty']) {
    const h = harness(t, { rows: [row('manager', profile('manager@fredinero.com', { rol: 'GERENTE', plaza, managedPlazas: [plaza] }))] });
    await h.prepare(); blocked(h, /Plaza ausente o inválida/);
  }
});

test('fallo local de SDK se muestra sanitizado y no provoca reintentos automáticos', async t => {
  const h = harness(t, { hooks: { set: () => { throw new TypeError('obj.hasOwnProperty is not a function '+PRIVATE); } } });
  await h.prepare(); await h.save();
  assert.match(h.status.textContent, /^DIRECTORY_DATA_INVALID:/);
  assert.equal(h.writes.length, 1); await h.save(); assert.equal(h.writes.length, 1);
  assert.doesNotMatch(h.status.textContent, /obj\.hasOwnProperty|TEST_ONLY/);
});

test('timeout de escritura explica resultado ambiguo y no reintenta aunque la escritura termine tarde', async t => {
  const gate = deferred();
  const h = harness(t, { hooks: { set: () => gate.promise } });
  await h.prepare(); const saving = h.save();
  await h.timeout(); await saving;
  assert.match(h.status.textContent, /^TIMEOUT:.*puede terminar después/);
  assert.equal(h.writes.length, 1); await h.save(); assert.equal(h.writes.length, 1);
  gate.resolve(); await flush();
  assert.match(h.status.textContent, /^TIMEOUT:/);
});

test('payload del directorio sólo contiene las ramas admitidas por reglas, sin metadatos no usados', async t => {
  const h = harness(t); await h.prepare(); await h.save();
  const payload = h.writes[0].projection;
  assert.deepEqual(Object.keys(payload).sort(), ['by_uid', 'by_email', 'manager_coverage', 'managers_by_plaza'].sort());
  assert.ok(!Object.hasOwn(payload, 'version'));
  assert.ok(!Object.hasOwn(payload, 'updated_at'));
});

test('límites de nombre/correo/UID coinciden con reglas; valores fuera del contrato bloquean antes de set', async t => {
  for (const [uid, p] of [
    ['user', profile('valid@fredinero.com', { nombre_completo: 'N'.repeat(201) })],
    ['user', profile('name!test@fredinero.com')],
    ['user', profile('x'.repeat(101)+'@fredinero.com')],
    ['user:legacy', profile('valid@fredinero.com')],
    ['usuarioñ', profile('valid@fredinero.com')],
  ]) {
    const h = harness(t, { rows: [row(uid, p)] }); await h.prepare(); blocked(h); await h.save(); assert.equal(h.writes.length, 0);
  }
  for (const p of [profile('valid@fredinero.com', { nombre_completo: 'N'.repeat(200) }), profile('x'.repeat(100)+'@fredinero.com')]) {
    const h = harness(t, { rows: [row('valid', p)] }); await h.prepare(); assert.ok(h.api.state().prepared); await h.save(); assert.equal(h.writes.length, 1);
  }
});
