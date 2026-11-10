'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
function extract(name, action = false) {
  const pattern = action ? `^  window\\.${name} = (?:async )?function\\([^\\n]*\\) \\{\\n[\\s\\S]*?^  \\};` : `^  (?:async )?function ${name}\\([^\\n]*\\) \\{\\n[\\s\\S]*?^  \\}`;
  const match = html.match(new RegExp(pattern, 'm')); assert.ok(match, name); return match[0];
}
const helpers = [...html.matchAll(/^  (?:async )?function (vpAvailability\w+|vpTemporal\w+)\(/gm)].map(m => m[1]);
const dependencies = ['vacGetEstado', 'vacParseFecha', 'permGetEstado', 'vpIsAlfredo', 'vpIsCleonRequest', 'vpEsSoporte', 'vpCorreoActual', 'vpNormalizarTexto', 'vpDistanciaLevenshtein', 'vpCoincideToken', 'vpCoincideUsuarioFlexible', 'vpEtapaVisible', 'approvalStageLabel'];
const vacation = (id, extra = {}) => ({ confirmada_empleado: true, approval_stage: 'completado', fecha_inicio_aprobada: '09/11/2026', fecha_fin_aprobada: '11/11/2026', user_email: `${id}@example.test`, nombre_solicitante: `Persona ${id}`, rol: 'GESTOR', plaza: 'CHIHUAHUA', ...extra });
const permission = (id, extra = {}) => ({ estado: 'aprobado_final', visto_bueno_cleon: true, approval_stage: 'cleon', fecha_inicio: '10/11/2026', fecha_regreso: '10/11/2026', hora_salida: '10:00', hora_regreso: '14:00', dia_completo: false, correo: `${id}@example.test`, nombre: `Permiso ${id}`, rol: 'LIDER A', plaza: 'TAMPICO', ...extra });
function harness({ store = {}, email = 'admin@example.test', role = 'ADMINISTRATIVO', allow = true, beforeRead, badKeys, denied } = {}) {
  let clock = new Date(2026, 10, 10, 12).getTime(), concurrent = 0, maximum = 0;
  const calls = [], nodes = {}, timers = new Map(), authCallbacks = [], docCallbacks = {}, observers = [];
  const node = id => nodes[id] ||= { value: '', innerHTML: '', textContent: '', style: {}, hidden: false, addEventListener(event, fn) { this[event] = fn; } };
  node('vacPermSection').style.display = 'none'; node('vacPermTableContainer').innerHTML = 'BUSCAR PARA TABLA';
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [clock])); } static now() { return clock; } }
  const user = { uid: 'user', email, getIdToken: async () => 'OFFLINE_FAKE_ID_TOKEN' };
  const auth = { currentUser: user };
  const document = { getElementById: node, hidden: false, addEventListener: (event, fn) => { docCallbacks[event] = fn; } };
  const valueAt = route => {
    const root = route.startsWith('cleon_solicitudes/vacaciones') ? 'cleon_solicitudes/vacaciones' : route.split('/')[0];
    let value = store[root] || null;
    for (const key of route.slice(root.length + 1).split('/').filter(Boolean)) value = value?.[key] ?? null;
    return value;
  };
  async function read(route, kind) {
    concurrent++; maximum = Math.max(maximum, concurrent);
    try {
      await Promise.resolve();
      if (beforeRead) await beforeRead(route, kind);
      if (denied === route) throw new Error('PERMISSION_DENIED');
      const value = kind === 'REST_SHALLOW' ? (badKeys || (valueAt(route) && Object.fromEntries(Object.keys(valueAt(route)).map(key => [key, true])))) : valueAt(route);
      calls.push({ kind, path: route, payload: plain(value), responseJsonBytes: Buffer.byteLength(JSON.stringify(value)) });
      return value;
    } finally { concurrent--; }
  }
  const context = vm.createContext({ window: {}, auth, document, Date: Clock, database: {}, console, AbortController,
    onAuthStateChanged: (_, fn) => authCallbacks.push(fn), MutationObserver: class { constructor(fn) { observers.push(fn); } observe() {} },
    panelCanOpenModule: () => allow, branchKey: value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase(),
    showPanelModuleDenied: () => {}, setPanelHeader: () => {},
    vpPuedeGestionarFlujo: () => false, vpPuedeEditarVacacion: () => false, vpPuedeEliminarSolicitud: () => false, alfredoCanManageVacation: () => false,
    recordPanelDataUsage: () => {},
    ref: (_, route) => route === undefined ? { toString: () => 'https://offline.example.test' } : route,
    get: async route => { const value = await read(route, 'SDK_SCALAR'); return { val: () => value, exists: () => value !== null, forEach: fn => Object.entries(value || {}).forEach(([key, row]) => fn({ key, val: () => row })) }; },
    fetch: async (url, options) => {
      const parsed = new URL(url);
      assert.equal(parsed.origin, 'https://offline.example.test');
      assert.equal(parsed.searchParams.get('auth'), 'OFFLINE_FAKE_ID_TOKEN');
      assert.deepEqual([...parsed.searchParams.keys()].sort(), ['auth', 'shallow']);
      assert.equal(parsed.searchParams.get('shallow'), 'true'); assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error'); assert.equal(options.referrerPolicy, 'no-referrer');
      const route = decodeURIComponent(parsed.pathname.slice(1, -5));
      const value = await read(route, 'REST_SHALLOW'); return { ok: true, json: async () => value };
    },
    setTimeout: (fn, delay) => { const id = Symbol(); timers.set(id, { fn, delay }); return id; }, clearTimeout: id => timers.delete(id),
    setInterval: () => assert.fail('No polling'), onValue: () => assert.fail('No listener'), update: () => assert.fail('No writes'), set: () => assert.fail('No writes'), remove: () => assert.fail('No writes'),
  });
  const constants = ['VAC_ESTADO_CFG', 'PERM_ESTADO_CFG'].map(name => html.match(new RegExp(`^  const ${name} = \\{\\n[\\s\\S]*?^  \\};`, 'm'))[0]);
  vm.runInContext([
    html.slice(html.indexOf('  let _vpData = [];'), html.indexOf('  function vpAvailabilityContext()')),
    `let _panelProfile = ${JSON.stringify({ rol: role, plaza: 'CHIHUAHUA' })};`,
    "const VP_SOPORTE_EMAIL='soporte@fredinero.com', VP_CLEON_EMAIL='cleon@fredinero.com';",
    ...constants, ...helpers.concat(dependencies).map(name => extract(name)),
    ...['vpAvailabilityRefresh', 'vpAvailabilityLoad', 'vpAvailabilityInvalidate', 'vpAvailabilityCommitRecord', 'showVacPerm', 'buscarVacPerm', 'renderVacPerm'].map(name => extract(name, true)),
    html.slice(html.indexOf('  // Eventos locales: no listener RTDB'), html.indexOf('  function vpIsAlfredo()')),
    'globalThis.api = { final: vpAvailabilityFinal, board: () => _vpAvailabilityBoardSnapshot, table: () => _vpAvailabilitySnapshot, data: () => _vpData, scalar: vpAvailabilityScalar, keys: vpAvailabilityKeys, projection: vpAvailabilityProjection, context: vpAvailabilityContext };',
  ].join('\n'), context);
  return { context, api: context.api, window: context.window, auth, document, node, nodes, calls, timers,
    maximum: () => maximum, now: date => { clock = date.getTime(); }, authChange: () => authCallbacks.forEach(fn => fn()), hide: () => { node('vacPermSection').style.display = 'none'; observers.forEach(fn => fn()); },
    show: () => { node('vacPermSection').style.display = 'block'; }, visibility: () => docCallbacks.visibilitychange(),
  };
}

test('abrir automáticamente: cobertura de todos los tipos autorizados, sin tabla ni detalles y con burbujas de color', async () => {
  const h = harness({ store: { vacation_requests: { v: vacation('v', { motivo: 'PRIVADO', fotos: ['secret'] }) }, permission_requests: { p: permission('p') } } });
  h.authChange(); assert.equal(h.calls.length, 0);
  h.node('vpTipo').value = 'vacaciones'; await h.window.showVacPerm();
  assert.deepEqual(plain(h.api.board().types), ['vacaciones', 'permisos']); assert.equal(h.api.board().records.length, 2);
  assert.equal(h.api.table(), null); assert.equal(h.api.data().length, 0); assert.equal(h.node('vacPermTableContainer').innerHTML.includes('<table'), false);
  assert.deepEqual(h.calls.filter(c => c.kind === 'REST_SHALLOW').map(c => c.path), ['vacation_requests', 'permission_requests']);
  assert.ok(h.calls.filter(c => c.kind === 'SDK_SCALAR').every(c => c.path.split('/').length === 3));
  assert.doesNotMatch(JSON.stringify(h.calls), /motivo|fotos|secret|PRIVADO|bitacora|OFFLINE_FAKE_ID_TOKEN/);
  assert.match(h.node('vpAvailabilityCards').innerHTML, /vp-av-chip/); assert.match(h.node('vpAvailabilityCards').innerHTML, /vp-av-departure/); assert.match(h.node('vpAvailabilityCards').innerHTML, /vp-av-return/);
  h.node('vpTipo').value = ''; h.window.vpAvailabilityRefresh(); assert.match(h.node('vpAvailabilityCards').innerHTML, /Permiso p/);
});

test('presupuesto medido: históricos sólo regreso, pendientes sin identidad, una sola rama nombre; sin truncar futuros', async () => {
  const rows = {};
  for (let i = 0; i < 160; i++) rows[`past${i}`] = vacation(`past${i}`, { fecha_fin_aprobada: '09/11/2026', motivo: 'x'.repeat(10000) });
  for (let i = 0; i < 16; i++) rows[`pending${i}`] = vacation(`pending${i}`, { confirmada_empleado: false, motivo: 'x'.repeat(10000) });
  for (let i = 0; i < 28; i++) rows[`future${i}`] = vacation(`future${i}`, { fecha_inicio_aprobada: '20/11/2026', fecha_fin_aprobada: '25/11/2026', motivo: 'x'.repeat(10000) });
  const h = harness({ store: { vacation_requests: rows } }); await h.window.showVacPerm();
  assert.equal(h.api.board().records.length, 28);
  for (let i = 0; i < 160; i++) assert.deepEqual(h.calls.filter(c => c.path.startsWith(`vacation_requests/past${i}/`)).map(c => c.path.split('/').pop()), ['fecha_fin_aprobada']);
  assert.ok(h.calls.filter(c => c.path.includes('/pending')).every(c => !/nombre|correo|email|rol|plaza/.test(c.path)));
  assert.ok(!h.calls.some(c => /future\d+\/nombre$/.test(c.path)));
  assert.ok(h.maximum() <= 6);
  const old = harness({ store: { vacation_requests: rows } }); old.show(); await old.window.buscarVacPerm();
  const unpruned = harness({ store: { vacation_requests: rows } });
  vm.runInContext(extract('vpAvailabilityProjection').replace('    if (returnDate && returnDate < today) return null;', ''), unpruned.context);
  await unpruned.window.showVacPerm();
  const stats = { fixtureRecords: 204, automatic: { restShallowRequests: h.calls.filter(c => c.kind === 'REST_SHALLOW').length, sdkScalarRequests: h.calls.filter(c => c.kind === 'SDK_SCALAR').length, requestsTotal: h.calls.length, responseJsonBytes: h.calls.reduce((n,c) => n + c.responseJsonBytes, 0), maxConcurrent: h.maximum() }, oldManualBuscarSameFixture: { sdkRootRequests: old.calls.length, responseJsonBytes: old.calls.reduce((n,c) => n + c.responseJsonBytes, 0) }, sameProjectionWithoutEarlyPastSkip: { sdkScalarRequests: unpruned.calls.filter(c => c.kind === 'SDK_SCALAR').length, restShallowRequests: unpruned.calls.filter(c => c.kind === 'REST_SHALLOW').length, responseJsonBytes: unpruned.calls.reduce((n,c) => n + c.responseJsonBytes, 0) }, notes: 'Solicitudes y JSON de fixture, no lecturas facturadas ni bytes TLS. Buscar usa menos solicitudes pero descarga detalles de todo el historial; auto usa más solicitudes escalares y payload mucho menor. Sin índice vigente no se puede combinar proyección con descarga de raíz.' };
  assert.ok(stats.automatic.sdkScalarRequests < 700); assert.ok(stats.automatic.sdkScalarRequests < stats.sameProjectionWithoutEarlyPastSkip.sdkScalarRequests / 3); assert.ok(stats.automatic.responseJsonBytes < stats.oldManualBuscarSameFixture.responseJsonBytes / 20);
  fs.writeFileSync('/tmp/request-availability-budget.json', JSON.stringify({ ...stats, requests: h.calls }, null, 2) + '\n');
  console.log('PRESUPUESTO', JSON.stringify(stats));
});

test('dateMx/ISO approved overrides y regreso hoy conservados; pasado original con futuro aprobado nunca se pierde', async () => {
  const h = harness({ store: { vacation_requests: {
    future: vacation('future', { fecha_fin: '01/11/2026', fecha_inicio_aprobada: '20/11/2026', fecha_fin_aprobada: '25/11/2026' }),
    today: vacation('today', { fecha_fin_aprobada: '2026-11-10' }),
    legacy: vacation('legacy', { fecha_fin_aprobada: '', fecha_fin: '11/11/2026', approval_stage: null }),
    invalid: vacation('invalid', { fecha_fin_aprobada: '31/11/2026' }),
  } } });
  await h.window.showVacPerm(); assert.equal(h.api.board().records.length, 4);
  assert.match(h.node('vpAvailabilityCards').innerHTML, /Regreso programado HOY \(1\)/);
  assert.match(h.node('vpAvailabilityCoverage').textContent, /1 solicitud\(es\) final\(es\) sin fecha\/hora válida/);
});

test('caché TTL cinco minutos, dedup en vuelo, filtros/reloj cero lecturas; actualización manual fuerza una carga', async () => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const h = harness({ store: { vacation_requests: { v: vacation('v') } }, beforeRead: () => gate });
  const one = h.window.showVacPerm(), two = h.window.showVacPerm(); release(); await Promise.all([one, two]);
  assert.equal(h.calls.filter(c => c.kind === 'REST_SHALLOW').length, 2);
  const count = h.calls.length; h.hide(); await h.window.showVacPerm(); assert.equal(h.calls.length, count);
  h.node('vpRol').change(); h.node('vpUsuario').input(); h.window.vpAvailabilityRefresh(); assert.equal(h.calls.length, count);
  h.now(new Date(2026, 10, 10, 12, 4, 59)); h.hide(); await h.window.showVacPerm(); assert.equal(h.calls.length, count);
  h.now(new Date(2026, 10, 10, 12, 5)); h.hide(); await h.window.showVacPerm(); assert.equal(h.calls.length, count * 2);
  await h.window.vpAvailabilityLoad(true); assert.equal(h.calls.length, count * 3);
});

test('fallo/denegación no produce cero falso ni cobertura parcial y nunca vuelve a descarga completa', async () => {
  const h = harness({ store: { vacation_requests: { v: vacation('v') }, permission_requests: { p: permission('p') } }, denied: 'permission_requests/p/estado' });
  await h.window.showVacPerm(); assert.equal(h.api.board(), null); assert.equal(h.node('vpAvailabilityCards').innerHTML, '');
  assert.match(h.node('vpAvailabilityCoverage').textContent, /Disponibilidad no verificada/);
  assert.ok(h.calls.filter(c => c.kind === 'SDK_SCALAR').every(c => c.path.split('/').length === 3));
});

test('ocultar/logout/cambio de perfil cancela sesión en vuelo sin repoblar datos ni lecturas en segundo plano', async () => {
  for (const cancel of ['hide', 'logout', 'profile']) {
    let release; const gate = new Promise(resolve => { release = resolve; });
    const h = harness({ store: { vacation_requests: { v: vacation('v') } }, beforeRead: () => gate });
    const loading = h.window.showVacPerm();
    if (cancel === 'hide') h.hide();
    if (cancel === 'logout') { h.auth.currentUser = null; h.authChange(); }
    if (cancel === 'profile') vm.runInContext("_panelProfile.rol = 'SOPORTE';", h.context);
    release(); await loading;
    assert.equal(h.api.board(), null); assert.equal(h.node('vpAvailabilityCards').innerHTML, ''); assert.ok(h.calls.length <= 1);
  }
});

test('roles activity-only bloqueados; Cleon/RH sólo Alfredo y Soporte; propuesta requiere aceptación', async () => {
  for (const role of ['GERENTE', 'LIDER A', 'LIDER B', 'LIDER C', 'GESTOR', 'CANJES']) {
    const h = harness({ role, allow: false }); await h.window.showVacPerm(); h.show(); await h.window.vpAvailabilityLoad(true); assert.equal(h.calls.length, 0);
  }
  const store = { permission_requests: { cleon: permission('cleon', { correo: 'cleon@fredinero.com', alfredo_estado: 'aprobada_alfredo', alfredo_fecha_inicio_propuesta: '10/11/2026', aceptada_propuesta_cleon: true }) }, 'cleon_solicitudes/vacaciones': { rh: vacation('rh', { estado: 'aprobada_alfredo' }) } };
  const normal = harness({ store }); await normal.window.showVacPerm(); assert.equal(normal.api.board().records.length, 0); assert.ok(!normal.calls.some(c => c.path.startsWith('cleon_solicitudes')));
  for (const email of ['alfredo@fredinero.com', 'soporte@fredinero.com']) {
    const h = harness({ email, store }); await h.window.showVacPerm(); assert.equal(h.api.board().records.length, 2); assert.equal(h.api.board().types.length, 3);
  }
  store.permission_requests.cleon.aceptada_propuesta_cleon = false;
  const h = harness({ email: 'alfredo@fredinero.com', store }); await h.window.showVacPerm(); assert.equal(h.api.board().records.length, 1);
});

test('lector whitelist exacto, claves inválidas/traversal y escalares objeto se rechazan sin fallback', async () => {
  const h = harness();
  for (const route of ['users', 'vacation_requests/x', 'vacation_requests/../users', 'permission_requests/', 'cleon_solicitudes/vacaciones/x']) await assert.rejects(h.api.keys(route, () => {}));
  for (const key of ['../users', 'a/b', 'a.b', 'a#b', 'a\u0000b', '']) await assert.rejects(h.api.scalar('vacation_requests', key, 'estado', () => {}));
  await assert.rejects(h.api.scalar('vacation_requests', 'safe', 'motivo', () => {})); assert.equal(h.calls.length, 0);
  const invalid = harness({ badKeys: { 'bad/path': true } }); await invalid.window.showVacPerm(); assert.equal(invalid.api.board(), null); assert.match(invalid.node('vpAvailabilityCoverage').textContent, /no verificada/);
  const object = harness({ store: { vacation_requests: { v: vacation('v', { fecha_fin_aprobada: { hidden: 'secret' } }) } } }); await object.window.showVacPerm(); assert.equal(object.api.board(), null);
});

test('Buscar por un tipo no sustituye el tablero mínimo ni su cobertura; invalidación confirmada refresca sólo mínimos', async () => {
  const h = harness({ store: { vacation_requests: { v: vacation('v') }, permission_requests: { p: permission('p') } } }); await h.window.showVacPerm();
  const board = h.api.board(); h.node('vpTipo').value = 'vacaciones'; await h.window.buscarVacPerm();
  assert.equal(h.api.board(), board); assert.equal(h.api.board().records.length, 2); assert.equal(h.api.table().types.length, 1);
  const count = h.calls.length; await h.window.vpAvailabilityInvalidate(); assert.ok(h.calls.length > count); assert.equal(h.api.board().types.length, 2);
  h.hide(); const hiddenCount = h.calls.length; await h.window.vpAvailabilityInvalidate(); assert.equal(h.calls.length, hiddenCount); assert.equal(h.api.board(), null);
});

test('proyección progresiva equivale a FINAL real, incluidos flags prematuros, legacy, devoluciones y estados RH', async () => {
  const cases = [
    ['vacaciones', { approval_stage: 'jaguayo' }], ['vacaciones', { approval_stage: 'lgallegos' }], ['vacaciones', { approval_stage: 'cleon' }],
    ['vacaciones', { confirmada_empleado: false }], ['vacaciones', { cancelado: true }], ['vacaciones', { devolucion_desde: 'cleon' }],
    ['vacaciones', { approval_stage: 'cleon', tipo_respuesta: 'aceptada' }], ['vacaciones', { approval_stage: 'cleon', respondida: true, propuesta_por: 'cleon' }],
    ['vacaciones', { approval_stage: null }], ['vacaciones', { approval_stage: null, propuesta_por: 'jaguayo' }], ['vacaciones', { approval_stage: 'gerente_plaza', visto_bueno_cleon: true }],
    ['permisos', { estado: 'pendiente_vobo', visto_bueno_cleon: false, confirmada_empleado: true }],
    ['permisos', { estado: 'confirmada', visto_bueno_cleon: false, confirmada_empleado: true }],
    ['permisos', { estado: 'propuesta_rh', visto_bueno_cleon: false, respondida_lgallegos: true, aprobado_lgallegos: false }],
    ['permisos', { respondida_lgallegos: true, aprobado_lgallegos: false, confirmada_empleado: true }],
    ['permisos', { cancelado: true }], ['permisos', { estado: 'cancelada' }], ['permisos', { estado: 'aprobado_final', visto_bueno_cleon: false }],
    ['permisos', { estado: 'sin_responder', approval_stage: 'completado', visto_bueno_cleon: false }],
    ['permisos', { correo: 'cleon@fredinero.com', alfredo_estado: 'aprobada_alfredo', alfredo_fecha_inicio_propuesta: '10/11/2026', aceptada_propuesta_cleon: true }],
    ['permisos', { correo: 'cleon@fredinero.com', alfredo_estado: 'aprobada_alfredo', alfredo_fecha_inicio_propuesta: '10/11/2026', aceptada_propuesta_cleon: false }],
    ['vac_rh', { estado: 'aprobada_alfredo' }], ['vac_rh', { estado: 'rechazada_alfredo' }], ['vac_rh', { estado: 'pendiente_alfredo' }],
  ];
  for (let index = 0; index < cases.length; index++) {
    const [tipo, extra] = cases[index], root = tipo === 'permisos' ? 'permission_requests' : tipo === 'vac_rh' ? 'cleon_solicitudes/vacaciones' : 'vacation_requests';
    const record = tipo === 'permisos' ? permission('case', extra) : vacation('case', extra);
    const h = harness({ email: 'soporte@fredinero.com', store: { [root]: { case: record } } }); h.show();
    const expected = h.api.final({ ...record, _tipo: tipo });
    const result = await h.api.projection(root, 'case', tipo, new Date(2026, 10, 10), () => {});
    assert.equal(!!result, expected, `case ${index} ${tipo} ${JSON.stringify(extra)}`);
  }
});

test('aprobación/edición confirmadas actualizan sólo la ficha local sin nuevas descargas ni contaminar tabla', async () => {
  const h = harness({ store: { vacation_requests: { existing: vacation('existing') }, permission_requests: {} } });
  await h.window.showVacPerm(); const count = h.calls.length, loadedAt = h.api.board().loadedAt.getTime();
  const confirmed = vacation('new', { nombre_solicitante: 'Aprobación final recién guardada', motivo: 'NO RETENER', foto_base64: 'NO RETENER', historial_expediente: { privado: true } });
  h.window.vpAvailabilityCommitRecord('vacaciones', 'new', confirmed);
  assert.equal(h.api.board().records.length, 2); assert.equal(h.calls.length, count); assert.equal(h.api.data().length, 0); assert.equal(h.api.table(), null);
  const saved = h.api.board().records.find(sol => sol.id === 'new');
  assert.equal(saved.nombre_solicitante, confirmed.nombre_solicitante);
  for (const key of ['motivo', 'foto_base64', 'historial_expediente']) assert.equal(saved[key], undefined);
  assert.equal(h.api.board().loadedAt.getTime(), loadedAt, 'No rejuvenece el TTL de otras solicitudes');
  h.window.vpAvailabilityCommitRecord('vacaciones', 'new', { ...confirmed, fecha_fin_aprobada: '09/11/2026' });
  assert.equal(h.api.board().records.length, 1); assert.equal(h.calls.length, count);
});

test('devolución y borrado confirmados retiran la ficha sin reconsultar colecciones', async () => {
  const h = harness({ store: { vacation_requests: { v: vacation('v') }, permission_requests: { p: permission('p') } } });
  await h.window.showVacPerm(); const count = h.calls.length;
  h.window.vpAvailabilityCommitRecord('vacaciones', 'v', { ...vacation('v'), confirmada_empleado: false, devolucion_desde: 'cleon' });
  assert.equal(h.api.board().records.length, 1);
  h.window.vpAvailabilityCommitRecord('permisos', 'p');
  assert.equal(h.api.board().records.length, 0); assert.equal(h.calls.length, count);
});

test('datos locales de RH no abren cobertura privada y rutas inválidas no disparan consultas', async () => {
  const h = harness({ store: { vacation_requests: {}, permission_requests: {} } });
  await h.window.showVacPerm(); const count = h.calls.length;
  h.window.vpAvailabilityCommitRecord('vac_rh', 'private', { ...vacation('private'), estado: 'aprobada_alfredo', correo: 'cleon@fredinero.com' });
  h.window.vpAvailabilityCommitRecord('vacaciones', 'bad/path', vacation('bad'));
  assert.equal(h.api.board().records.length, 0); assert.equal(h.calls.length, count);
});
