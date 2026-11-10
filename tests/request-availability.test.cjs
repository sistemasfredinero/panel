'use strict';

// Código real del panel; reloj, DOM y RTDB sintéticos. No red ni escrituras.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
function fn(name) {
  const match = html.match(new RegExp(`^  function ${name}\\([^\\n]*\\) \\{\\n[\\s\\S]*?^  \\}`, 'm'));
  assert.ok(match, `Helper real ${name}`); return match[0];
}
function action(name) {
  const match = html.match(new RegExp(`^  window\\.${name} = (?:async )?function\\([^\\n]*\\) \\{\\n[\\s\\S]*?^  \\};`, 'm'));
  assert.ok(match, `Acción real ${name}`); return match[0];
}
function constant(name) {
  const match = html.match(new RegExp(`^  const ${name} = \\{\\n[\\s\\S]*?^  \\};`, 'm'));
  assert.ok(match, `Config real ${name}`); return match[0];
}
const helperNames = [...html.matchAll(/^  function (vpAvailability\w+|vpTemporal\w+)\(/gm)].map(m => m[1]);
const legacyNames = ['vacGetEstado', 'vacParseFecha', 'permGetEstado', 'vpIsAlfredo', 'vpIsCleonRequest', 'vpEsSoporte', 'vpCorreoActual', 'vpNormalizarTexto', 'vpDistanciaLevenshtein', 'vpCoincideToken', 'vpCoincideUsuarioFlexible', 'vpEtapaVisible', 'approvalStageLabel'];
function snapshot(value, key = '') {
  return { key, val: () => value, exists: () => value != null && Object.keys(value).length > 0, forEach: cb => Object.entries(value || {}).forEach(([id, row]) => cb(snapshot(row, id))) };
}
function harness({ email = 'admin@example.test', role = 'ADMINISTRATIVO', plaza = 'CHIHUAHUA', allow = true, store = {}, beforeGet = null, now = new Date(2026, 10, 10, 12) } = {}) {
  let clock = now.getTime(), uid = 0;
  const reads = [], writes = [], timers = new Map(), nodes = {}, authListeners = [], documentListeners = {}, observers = [];
  const node = id => nodes[id] ||= { value: '', textContent: '', innerHTML: '', style: {}, hidden: false, addEventListener() {} };
  node('vacPermSection').style.display = 'block';
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  }
  const auth = { currentUser: { uid: 'actor', email } };
  const document = { getElementById: node, hidden: false, addEventListener: (name, callback) => { documentListeners[name] = callback; } };
  const context = vm.createContext({
    window: {}, document, auth, Date: ClockDate, console, database: {},
    onAuthStateChanged: (_, callback) => authListeners.push(callback),
    MutationObserver: class { constructor(callback) { observers.push(callback); } observe() {} },
    panelCanOpenModule: () => allow,
    branchKey: value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase(),
    vpPuedeGestionarFlujo: () => false, vpPuedeEditarVacacion: () => false, vpPuedeEliminarSolicitud: () => false, alfredoCanManageVacation: () => false,
    recordPanelDataUsage: () => {},
    ref: (_, route) => { assert.ok(route, 'No raíz'); return route; },
    get: async route => { reads.push(route); assert.ok(['vacation_requests', 'permission_requests', 'cleon_solicitudes/vacaciones'].includes(route)); if (beforeGet) await beforeGet(route, auth); return snapshot(store[route]); },
    setTimeout: (callback, delay) => { const id = ++uid; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id),
    setInterval: () => assert.fail('No polling'),
    update: (...args) => { writes.push(args); assert.fail('No update'); },
    set: () => assert.fail('No set'), remove: () => assert.fail('No remove'), fetch: () => assert.fail('No HTTP'), onValue: () => assert.fail('No listener RTDB'),
  });
  vm.runInContext([
    'let _vpData = [], _vpAvailabilitySnapshot = null, _vpAvailabilityTimer = null, _vpAvailabilityGeneration = 0;',
    `let _panelProfile = ${JSON.stringify({ rol: role, plaza })};`,
    "const VP_SOPORTE_EMAIL='soporte@fredinero.com', VP_CLEON_EMAIL='cleon@fredinero.com';",
    ...['VAC_ESTADO_CFG', 'PERM_ESTADO_CFG'].map(constant),
    ...[...helperNames, ...legacyNames].map(fn),
    ...['vpAvailabilityRefresh', 'buscarVacPerm', 'renderVacPerm'].map(action),
    html.slice(html.indexOf('  // Eventos locales: no listener RTDB'), html.indexOf('  function vpIsAlfredo()')),
    `globalThis.api = { ${helperNames.concat(legacyNames).join(', ')},
      cache: () => _vpAvailabilitySnapshot, data: () => _vpData,
      seed: records => { _vpAvailabilitySnapshot = { records, user: auth.currentUser, types: ['vacaciones', 'permisos'], loadedAt: new Date() }; },
      reset: () => { vpAvailabilityStop(); _vpAvailabilityGeneration++; _vpAvailabilitySnapshot = null; _vpData = []; }
    };`,
  ].join('\n\n'), context);
  return { api: context.api, window: context.window, node, nodes, auth, document, context, reads, writes, timers, authChange: () => authListeners.forEach(cb => cb(auth.currentUser)), visibilityChange: () => documentListeners.visibilitychange(), sectionChange: () => observers.forEach(cb => cb()), at: date => { clock = date.getTime(); }, tick: date => { clock = date.getTime(); const timer = [...timers.values()][0]; timers.clear(); assert.ok(timer, 'Timer programado'); timer.callback(); } };
}
function vacation(id = 'vac', extra = {}) {
  return { id, _tipo: 'vacaciones', user_email: 'empleado@example.test', nombre_solicitante: 'Juana García', rol: 'GESTOR', plaza: 'CHIHUAHUA', confirmada_empleado: true, approval_stage: 'completado', fecha_inicio_aprobada: '09/11/2026', fecha_fin_aprobada: '11/11/2026', timestamp_creacion: new Date(2026, 9, 1).getTime(), ...extra };
}
function permission(id = 'perm', extra = {}) {
  return { id, _tipo: 'permisos', correo: 'empleado@example.test', nombre: 'Pedro López', rol: 'GESTOR', plaza: 'CHIHUAHUA', estado: 'aprobado_final', visto_bueno_cleon: true, approval_stage: 'cleon', fecha_inicio: '10/11/2026', fecha_regreso: '10/11/2026', hora_inicio: '08:00', hora_salida: '10:00', hora_regreso: '14:00', dia_completo: false, timestamp: new Date(2026, 9, 1).getTime(), ...extra };
}
const ids = rows => rows.map(row => row.sol.id);

test('HTML incluye resumen separado, cobertura explícita y filtros temporales de permisos', () => {
  for (const id of ['boardAvailability', 'vpAvailabilityCoverage', 'vpAvailabilityCards']) assert.equal([...html.matchAll(new RegExp(`id="${id}"`, 'g'))].length, 1);
  assert.match(html, /value="perm_activo"/); assert.match(html, /value="perm_gozados"/);
  assert.match(html, /no confirma que la persona ya checó asistencia/);
});

test('fechas estrictas locales, formatos legacy y horas existentes; inválidos nunca se normalizan a otra fecha', () => {
  const h = harness();
  for (const value of ['2026-02-31', '31/2/2026', '2026-13-01', '2026-11-10T00:00:00Z', 1794304800000, {}, '']) assert.equal(h.api.vpTemporalFecha(value), null);
  assert.equal(h.api.vpTemporalFecha('3/1/2026').getDate(), 3);
  assert.equal(h.api.vpTemporalFecha('2026-11-10').getHours(), 0);
  assert.equal(h.api.vpTemporalFecha('29/02/2024').getDate(), 29);
  for (const [value, expected] of [['9am', '09:00'], ['2pm', '14:00'], ['12am', '00:00'], ['12pm', '12:00'], ['a las 14 hrs', '14:00'], ['9.30', '09:30'], ['08:07', '08:07']]) assert.equal(h.api.vpTemporalHora(value).label, expected);
  for (const value of ['24:00', '9:60', '13pm', '0am', {}, null, '']) assert.equal(h.api.vpTemporalHora(value), null);
});

test('vacaciones terminan exactamente al inicio del día aprobado de regreso, no un día después', () => {
  const h = harness(), sol = vacation();
  assert.equal(h.api.vacGetEstado(sol, new Date(2026, 10, 8, 23, 59)), 'confirmada');
  assert.equal(h.api.vacGetEstado(sol, new Date(2026, 10, 9)), 'activo');
  assert.equal(h.api.vacGetEstado(sol, new Date(2026, 10, 10, 23, 59, 59)), 'activo');
  assert.equal(h.api.vacGetEstado(sol, new Date(2026, 10, 11)), 'gozados');
  assert.equal(h.api.vacGetEstado(sol, new Date(2026, 10, 12)), 'gozados');
});

test('permiso parcial empieza cuando se retira (no hora de entrada) y termina exactamente al regreso aprobado', () => {
  const h = harness(), sol = permission();
  assert.equal(h.api.permGetEstado(sol, new Date(2026, 10, 10, 9, 59)), 'aprobado_final');
  assert.equal(h.api.permGetEstado(sol, new Date(2026, 10, 10, 10)), 'activo');
  assert.equal(h.api.permGetEstado(sol, new Date(2026, 10, 10, 13, 59, 59)), 'activo');
  assert.equal(h.api.permGetEstado(sol, new Date(2026, 10, 10, 14)), 'gozados');
  assert.equal(h.api.permGetEstado(sol, new Date(2026, 10, 11)), 'gozados');
});

test('campos aprobados prevalecen; regreso de permiso no usa fecha_fin y false aprobado prevalece sobre día completo original', () => {
  const h = harness();
  const sol = permission('changed', { dia_completo: true, dia_completo_aprobado: false, fecha_inicio_aprobada: '11/11/2026', hora_salida_aprobada: '15:30', fecha_regreso_aprobada: '12/11/2026', hora_regreso_aprobada: '09:20', fecha_fin: '30/11/2026' });
  const dates = h.api.vpTemporalVentana(sol);
  assert.equal(dates.start.getDate(), 11); assert.equal(dates.start.getHours(), 15); assert.equal(dates.start.getMinutes(), 30);
  assert.equal(dates.end.getDate(), 12); assert.equal(dates.end.getHours(), 9); assert.equal(dates.end.getMinutes(), 20);
  assert.equal(h.api.permGetEstado(sol, new Date(2026, 10, 12, 9, 20)), 'gozados');
  assert.equal(h.api.vpTemporalVentana(vacation('v', { fecha_fin: '30/11/2026', fecha_fin_aprobada: '12/11/2026' })).end.getDate(), 12);
});

test('permiso día completo empieza a medianoche, pero conserva la hora obligatoria de regreso', () => {
  const h = harness(), sol = permission('all', { dia_completo_aprobado: true, fecha_regreso_aprobada: '11/11/2026', hora_regreso_aprobada: '08:00' });
  assert.equal(h.api.vpTemporalVentana(sol).start.getHours(), 0);
  assert.equal(h.api.permGetEstado(sol, new Date(2026, 10, 11, 7, 59)), 'activo');
  assert.equal(h.api.permGetEstado(sol, new Date(2026, 10, 11, 8)), 'gozados');
});

test('aprobaciones intermedias, propuestas, flags prematuros y devoluciones no se convierten en salidas futuras', () => {
  const h = harness();
  const rejected = [
    vacation('v1', { approval_stage: 'jaguayo' }), vacation('v2', { approval_stage: 'lgallegos' }), vacation('v3', { approval_stage: 'cleon' }),
    vacation('v4', { confirmada_empleado: false }), vacation('v5', { cancelado: true }), vacation('v6', { devolucion_desde: 'cleon' }),
    permission('p1', { visto_bueno_cleon: false, estado: 'pendiente_vobo', confirmada_empleado: true }),
    permission('p2', { visto_bueno_cleon: false, estado: 'confirmada', confirmada_empleado: true }),
    permission('p3', { visto_bueno_cleon: false, estado: 'propuesta_rh', respondida_lgallegos: true, aprobado_lgallegos: false }),
    permission('p4', { visto_bueno_cleon: false, estado: 'sin_responder', rol: 'ADMINISTRATIVO', confirmada_empleado: true }),
    permission('p5', { cancelado: true }), permission('p6', { estado: 'cancelada' }),
  ];
  for (const sol of rejected) assert.equal(h.api.vpAvailabilityFinal(sol), false, sol.id);
  const board = h.api.vpAvailabilityBoard(rejected, new Date(2026, 10, 1));
  assert.equal(board.future.length, 0); assert.equal(board.absent.length, 0);
});

test('RH móvil final, propuesta RH aceptada y vacaciones legacy se reconocen sin exigir completado inexistente', () => {
  const h = harness();
  for (const sol of [vacation('accepted', { approval_stage: 'cleon', tipo_respuesta: 'aceptada' }), vacation('proposal', { approval_stage: 'cleon', respondida: true, propuesta_por: 'cleon' }), vacation('legacy', { approval_stage: undefined }), permission('direct', { confirmada_empleado: false })]) assert.equal(h.api.vpAvailabilityFinal(sol), true, sol.id);
});

test('regreso hoy incluye antes/después de hora, ausencia sólo antes; próximas salidas nunca propuestas', () => {
  const h = harness();
  const rows = [permission('today'), vacation('today-v', { fecha_fin_aprobada: '10/11/2026' }), vacation('future', { fecha_inicio_aprobada: '20/11/2026', fecha_fin_aprobada: '25/11/2026' })];
  let board = h.api.vpAvailabilityBoard(rows, new Date(2026, 10, 10, 12));
  assert.deepEqual(plain(ids(board.absent)), ['today']);
  assert.deepEqual(plain(ids(board.returningToday)), ['today-v', 'today']);
  assert.deepEqual(plain(ids(board.future)), ['future']);
  board = h.api.vpAvailabilityBoard(rows, new Date(2026, 10, 10, 14));
  assert.equal(board.absent.length, 0); assert.equal(board.returningToday.length, 2);
});

test('fechas, horas o cronologías incompletas no inventan ausentes ni límites', () => {
  const h = harness();
  const rows = [permission('no-hour', { hora_regreso: '' }), permission('bad-approved', { hora_regreso_aprobada: '25:00' }), permission('no-departure', { hora_salida: '' }), vacation('bad', { fecha_fin_aprobada: '31/11/2026' }), permission('reverse', { hora_regreso: '09:00' })];
  const board = h.api.vpAvailabilityBoard(rows);
  assert.equal(board.absent.length, 0); assert.equal(board.future.length, 0); assert.equal(board.returningToday.length, 0); assert.equal(board.incomplete.length, rows.length);
  assert.equal(h.api.permGetEstado(rows[0]), 'aprobado_final');
});

test('plaza/rol/nombre y tipo filtran el resumen; estado/rango de creación no ocultan vacaciones en curso', () => {
  const h = harness();
  h.node('vpPlaza').value = ' chihuáhua '; h.node('vpRol').value = 'GESTOR'; h.node('vpUsuario').value = 'juana garcia';
  h.node('vpEstado').value = 'perm_gozados'; h.node('vpFechaIni').value = '2026-11-10'; h.node('vpFechaFin').value = '2026-11-10';
  const rows = [vacation('yes'), vacation('plaza', { plaza: 'TAMPICO' }), vacation('role', { rol: 'CANJES' }), vacation('name', { nombre_solicitante: 'Otro' })];
  assert.deepEqual(plain(ids(h.api.vpAvailabilityBoard(rows).absent)), ['yes']);
  h.node('vpTipo').value = 'permisos'; assert.equal(h.api.vpAvailabilityBoard(rows).absent.length, 0);
});

test('alcance de sesión bloquea llamadas directas y no expone Cleon ni plazas ajenas a líderes', async () => {
  const blocked = harness({ role: 'LIDER A', allow: false });
  blocked.api.seed([vacation()]); blocked.window.renderVacPerm(); await blocked.window.buscarVacPerm();
  assert.equal(blocked.reads.length, 0); assert.equal(blocked.nodes.vpAvailabilityCards.innerHTML, '');
  const scoped = harness({ role: 'LIDER A', allow: true });
  assert.equal(scoped.api.vpAvailabilityAuthorized(vacation('other', { plaza: 'TAMPICO' })), false);
  assert.equal(scoped.api.vpAvailabilityAuthorized(vacation('own')), true);
  const normal = harness();
  assert.equal(normal.api.vpAvailabilityAuthorized(permission('rh', { correo: 'cleon@fredinero.com' })), false);
  assert.equal(normal.api.vpAvailabilityAuthorized({ _tipo: 'vac_rh' }), false);
});

test('Cleon final sólo Alfredo/Soporte; propuesta pendiente no figura hasta aceptar', () => {
  const h = harness({ email: 'alfredo@fredinero.com' });
  const rh = { ...vacation('rh'), _tipo: 'vac_rh', estado: 'aprobada_alfredo', fecha_inicio: '09/11/2026', fecha_fin: '11/11/2026', fecha_inicio_aprobada: undefined, fecha_fin_aprobada: undefined };
  assert.equal(h.api.vpAvailabilityFinal(rh), true);
  assert.equal(h.api.vpAvailabilityEstadoKey(rh, new Date(2026, 10, 11)), 'gozados');
  const sol = permission('cleon', { correo: 'cleon@fredinero.com', alfredo_estado: 'aprobada_alfredo', alfredo_fecha_inicio_propuesta: '10/11/2026' });
  assert.equal(h.api.vpAvailabilityFinal(sol), false);
  assert.equal(h.api.vpAvailabilityFinal({ ...sol, aceptada_propuesta_cleon: true }), true);
});

test('búsqueda conserva universo autorizado anterior al rango y estado usando EXACTAMENTE lecturas existentes', async () => {
  const h = harness({ store: { vacation_requests: { old: vacation('old') }, permission_requests: { p: permission('p') } } });
  h.node('vpFechaIni').value = '2026-11-10'; h.node('vpFechaFin').value = '2026-11-10';
  await h.window.buscarVacPerm();
  assert.deepEqual(h.reads, ['vacation_requests', 'permission_requests']);
  assert.equal(h.api.cache().records.length, 2); assert.equal(h.api.data().length, 0);
  assert.match(h.node('vpAvailabilityCards').innerHTML, /Juana García/); assert.match(h.node('vpAvailabilityCards').innerHTML, /Pedro López/);
  assert.match(h.node('vpAvailabilityCoverage').textContent, /antes del rango de creación/);
  assert.equal(h.writes.length, 0);
});

test('cobertura parcial por tipo es explícita y no agrega raíces ni lecturas para completar el universo', async () => {
  const h = harness({ store: { vacation_requests: { v: vacation() } } }); h.node('vpTipo').value = 'vacaciones';
  await h.window.buscarVacPerm(); assert.deepEqual(h.reads, ['vacation_requests']);
  assert.deepEqual(plain(h.api.cache().types), ['vacaciones']);
  assert.match(h.node('vpAvailabilityCoverage').textContent, /Cobertura: vacaciones,/);
  h.node('vpTipo').value = ''; h.window.vpAvailabilityRefresh(); assert.equal(h.reads.length, 1);
});

test('render recalcula estadoKEY y filtro sin Firebase; timer único dispara exactamente en regreso', async () => {
  const h = harness({ store: { permission_requests: { p: permission() } } }); h.node('vpTipo').value = 'permisos';
  await h.window.buscarVacPerm(); assert.equal(h.api.data()[0]._estadoKey, 'activo');
  assert.equal(h.timers.size, 1); assert.equal([...h.timers.values()][0].delay, 2 * 60 * 60 * 1000);
  const reads = h.reads.length; h.tick(new Date(2026, 10, 10, 14));
  assert.equal(h.api.data()[0]._estadoKey, 'gozados'); assert.equal(h.reads.length, reads); assert.equal(h.timers.size, 1);
  assert.match(h.node('vpAvailabilityCards').innerHTML, /Ausentes ahora \(0\)/);
  h.node('vpEstado').value = 'perm_activo'; h.window.renderVacPerm(); assert.equal(h.api.data().length, 0);
  h.node('vpEstado').value = 'perm_gozados'; h.window.renderVacPerm(); assert.equal(h.api.data().length, 1);
});

test('timer también recalcula en salida y medianoche usando fecha local', () => {
  const h = harness({ now: new Date(2026, 10, 10, 9) }); h.api.seed([permission()]); h.window.renderVacPerm();
  assert.equal([...h.timers.values()][0].delay, 60 * 60 * 1000);
  h.tick(new Date(2026, 10, 10, 10)); assert.equal(h.api.data()[0]._estadoKey, 'activo');
  const v = harness({ now: new Date(2026, 10, 10, 23, 59) }); v.api.seed([vacation()]); v.window.renderVacPerm();
  assert.equal([...v.timers.values()][0].delay, 60 * 1000);
  v.tick(new Date(2026, 10, 11)); assert.equal(v.api.data()[0]._estadoKey, 'gozados'); assert.match(v.node('vpAvailabilityCards').innerHTML, /Regreso programado HOY \(1\)/);
});

test('timer se reemplaza, detiene oculto/logout y rechaza callbacks de sesión anterior', () => {
  const h = harness(); h.api.seed([permission()]); h.window.renderVacPerm();
  const old = [...h.timers.values()][0]; h.window.renderVacPerm(); assert.equal(h.timers.size, 1);
  h.document.hidden = true; h.window.renderVacPerm(); assert.equal(h.timers.size, 0);
  h.document.hidden = false; h.window.renderVacPerm(); assert.equal(h.timers.size, 1);
  h.node('vacPermSection').style.display = 'none'; h.window.renderVacPerm(); assert.equal(h.timers.size, 0);
  h.node('vacPermSection').style.display = 'block'; h.window.renderVacPerm();
  h.auth.currentUser = { uid: 'other', email: 'other@example.test' }; old.callback();
  assert.equal(h.reads.length, 0); h.window.renderVacPerm(); assert.equal(h.node('vpAvailabilityCards').innerHTML, '');
  h.api.reset(); assert.equal(h.timers.size, 0); assert.equal(h.api.cache(), null);
});

test('resumen escapa texto de usuario y no interpreta HTML, nombre/plaza/rol se conservan seguros', () => {
  const h = harness(); h.api.seed([vacation('v', { nombre_solicitante: '<img src=x onerror=alert(1)>', plaza: '<svg>' })]); h.window.renderVacPerm();
  assert.doesNotMatch(h.node('vpAvailabilityCards').innerHTML, /<img|<svg/); assert.match(h.node('vpAvailabilityCards').innerHTML, /&lt;img/);
});

test('hooks reales cancelan ocultar sección/pestaña y logout; reabrir pestaña recalcula sin lectura', () => {
  const h = harness(); h.api.seed([permission()]); h.window.renderVacPerm();
  assert.equal(h.timers.size, 1);
  h.document.hidden = true; h.visibilityChange(); assert.equal(h.timers.size, 0);
  h.at(new Date(2026, 10, 10, 14)); h.document.hidden = false; h.visibilityChange();
  assert.equal(h.api.data()[0]._estadoKey, 'gozados'); assert.equal(h.timers.size, 1); assert.equal(h.reads.length, 0);
  h.node('vacPermSection').style.display = 'none'; h.sectionChange(); assert.equal(h.timers.size, 0);
  h.node('vacPermSection').style.display = 'block'; h.window.renderVacPerm(); assert.equal(h.timers.size, 1);
  h.auth.currentUser = null; h.authChange();
  assert.equal(h.timers.size, 0); assert.equal(h.api.cache(), null); assert.equal(h.api.data().length, 0);
  assert.equal(h.node('vpAvailabilityCards').innerHTML, ''); assert.equal(h.node('vacPermTableContainer').innerHTML, '');
});

test('búsqueda en vuelo no repone solicitudes de una sesión anterior después del logout', async () => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const h = harness({ store: { vacation_requests: { old: vacation() } }, beforeGet: () => gate });
  const search = h.window.buscarVacPerm();
  h.auth.currentUser = null; h.authChange(); release(); await search;
  assert.deepEqual(h.reads, ['vacation_requests']); assert.equal(h.api.cache(), null); assert.equal(h.api.data().length, 0);
  assert.equal(h.node('vpAvailabilityCards').innerHTML, ''); assert.equal(h.node('vacPermTableContainer').innerHTML, '');
});

test('helpers y timer no escriben, leen Firebase, emiten avisos ni utilizan intervalos; hooks cancelan sesión/visibilidad/reemplazo', () => {
  for (const name of helperNames) assert.doesNotMatch(fn(name), /(?<![.\w])(?:get|ref|update|set|remove|push|fetch|onValue|setInterval)\s*\(|panelNotices|panelNoticeCanonical/, name);
  assert.doesNotMatch(action('vpAvailabilityRefresh'), /buscarVacPerm|\bget\(/);
  const hooks = html.slice(html.indexOf('  // Eventos locales: no listener RTDB'), html.indexOf('  function vpIsAlfredo()'));
  assert.match(hooks, /onAuthStateChanged\(auth/); assert.match(hooks, /visibilitychange/); assert.match(hooks, /MutationObserver/); assert.match(hooks, /vpAvailabilityStop\(\)/);
  assert.match(hooks, /_vpAvailabilitySnapshot = null/); assert.match(hooks, /_vpAvailabilityGeneration\+\+/);
});
