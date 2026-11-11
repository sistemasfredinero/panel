'use strict';
// Sólo código local y fixtures sintéticos. Sin Firebase, navegador, credenciales ni escrituras.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const plain = x => JSON.parse(JSON.stringify(x));
function fn(name) {
  const match = html.match(new RegExp(`^  (?:async )?function ${name}\\([^\\n]*\\) \\{(?:[^\\n]*\\}$|\\n[\\s\\S]*?^  \\})`, 'm'));
  assert.ok(match, `Función original ${name}`); return match[0];
}
const block = (start, end) => html.slice(html.indexOf(start), html.indexOf(end, html.indexOf(start)));
const ts = (day, hour = 8, minute = 0, second = 0, ms = 0) => new Date(2026, 10, day, hour, minute, second, ms).getTime();
const now = ts(10, 20);
class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
function fixtures() {
  const users = {
    rh: { nombre_completo: 'Cleon RH', correo: 'cleon@fredinero.com', rol: 'ADMINISTRATIVO', plaza: 'ADMINISTRATIVO' },
    other: { nombre_completo: 'Otra persona', correo: 'other@example.test', rol: 'ADMINISTRATIVO', plaza: 'ADMINISTRATIVO' },
  };
  const row = (user_uid, day, tipo, hour = 8, extra = {}) => ({ user_uid, tipo, timestamp: ts(day, hour), latitud: 22.3, longitud: -97.8, ...extra });
  const records = {
    own1: row('rh', 5, 'ENTRADA', 8, { uso_vehiculo: true }), own2: row('rh', 5, 'SALIDA', 18),
    own3: row('rh', 6, 'ENTRADA'), own4: row('rh', 10, 'ENTRADA', 8, { uso_vehiculo: true }),
    own5: row('rh', 10, 'SALIDA', 18), foreign: row('other', 6, 'ENTRADA'),
  };
  const trip = (user_uid, day, extra = {}) => ({ user_uid, timestamp_inicio: ts(day, 9), km_inicio: 0, latitud_inicio: 22.3, longitud_inicio: -97.8, ...extra });
  const trips = {
    complete: trip('rh', 5, { estado: 'completado', km_fin: 12, timestamp_fin: ts(5, 11) }),
    open: trip('rh', 6), latest: trip('rh', 10, { estado: 'completado', km_fin: 99 }),
    foreignComplete: trip('other', 5, { estado: 'completado', km_fin: 999 }), foreignOpen: trip('other', 6),
  };
  return { users, records, trips };
}
function harness(data = fixtures()) {
  const nodes = {}, reads = [], charts = {}, forbidden = [], alerts = [], blobs = [], downloads = [];
  const node = id => nodes[id] ||= { id, value: '', textContent: '', innerHTML: '', style: {}, parentElement: { style: {} }, attributes: {}, classList: { toggle() {} }, setAttribute(k, v) { this.attributes[k] = v; } };
  const deny = name => () => { forbidden.push(name); throw Error(`Prohibido ${name}`); };
  const snap = rows => ({ exists: () => rows.length > 0, forEach: cb => rows.forEach(([key, value]) => cb({ key, val: () => value })) });
  const auth = { currentUser: { uid: 'rh', email: ' CLEON@FREDINERO.COM ' } };
  const context = vm.createContext({
    Date: Clock, console, window: {}, auth, database: {}, document: { getElementById: node, createElement: () => ({ click() { downloads.push(this.download); } }) },
    Blob, URL: { createObjectURL(blob) { blobs.push(blob); return 'blob:offline'; }, revokeObjectURL() {} },
    alert: message => alerts.push(message), recordPanelDataUsage() {},
    fetch: deny('fetch'), set: deny('set'), update: deny('update'), remove: deny('remove'), push: deny('push'), onValue: deny('onValue'), setInterval: deny('setInterval'),
    ref: (_, route) => route, orderByChild: field => ({ type: 'orderByChild', field }),
    startAt: value => ({ type: 'startAt', value }), endAt: value => ({ type: 'endAt', value }),
    query: (route, ...constraints) => ({ route, constraints }),
    get: async request => {
      reads.push(plain(request)); await Promise.resolve();
      if (typeof request === 'string') {
        if (request === 'users') return snap(Object.entries(data.users));
        assert.match(request, /^users\/rh\/(rol|role|plaza)$/);
        return { val: () => data.users.rh?.[request.split('/').pop()] ?? null };
      }
      assert.ok(['attendance_records', 'vehicle_trips'].includes(request.route));
      const field = request.constraints.find(c => c.type === 'orderByChild').field;
      const start = request.constraints.find(c => c.type === 'startAt').value;
      const end = request.constraints.find(c => c.type === 'endAt').value;
      return snap(Object.entries(request.route === 'attendance_records' ? data.records : data.trips).filter(([, r]) => r[field] >= start && r[field] <= end));
    },
    Chart: class { constructor(element, config) { charts[element.id] = plain(config); } destroy() {} },
  });
  const functions = ['activityText', 'normaliseActivityText', 'branchKey', 'privacyIsSupport', 'panelRole', 'panelIsActivityOnlyUser', 'panelCanOpenModule', 'applyPanelRoleAccess', 'resetPanelSessionProfile', 'loadPanelSessionProfile', 'loadData', 'filterAndRender', 'renderStats', 'renderCards', 'renderCharts', 'renderOutsideBranchReport', 'renderTripRoutesReport', 'distanceInMeters', 'validCoordinates', 'formatRecordDateTime', 'escapeMapHtml', 'fmtHour', 'formatDate', 'calcPuntualidadTexto', 'puntualidadChip', 'csvQ'];
  const declarations = [html.match(/^  const PANEL_ACTIVITY_ONLY_ROLES = [^\n]+;/m)[0], html.match(/^  const PANEL_PLAZAS = [^\n]+;/m)[0], html.match(/^  const BRANCH_CENTERS = Object.freeze\([\s\S]*?^  \}\);/m)[0], html.match(/^  const OUTSIDE_BRANCH_RADIUS_METERS = [^\n]+;/m)[0], 'let allRecords=[], usersMap={}, _panelProfile={rol:"ADMINISTRATIVO"}; let chartLinea=null, chartSucursal=null, chartKm=null, _tripsCache=null; const PANEL_SESSION_PROFILE_TTL_MS=300000; let _panelSessionProfileCache=null, _panelSessionProfileGeneration=0;'];
  vm.runInContext([...declarations, ...functions.map(fn),
    block('  // ── Alertas / Inconsistencias', '  // ── Descarga masiva de fotos'),
    html.match(/^  window\.openAttendanceWorkspace = function\(\) \{[\s\S]*?^  \};/m)[0],
    html.match(/^  window\.exportExcel = function\(\) \{[\s\S]*?^  \};/m)[0],
    'function setPanelHeader() {} function showPanelModuleDenied() {}',
    // Observa la promesa no-awaited de loadData; ejecuta íntegramente la función original.
    'let pending; const originalFilter=filterAndRender; filterAndRender=function(){return pending=originalFilter();}; globalThis.api={loadData,filterAndRender,loadPanelSessionProfile,panelCanOpenModule,applyPanelRoleAccess,setProfile(p){_panelProfile=p;},wait(){return pending;}};',
  ].join('\n'), context);
  node('fechaInicio').value = '2026-11-05'; node('fechaFin').value = '2026-11-10';
  node('filtroUsuario').value = 'cleon@fredinero.com';
  return { api: context.api, window: context.window, node, reads, charts, forbidden, alerts, blobs, downloads, async run() { await context.api.loadData(); await context.api.wait(); }, async csv() { context.window.exportExcel(); return blobs.length ? blobs.at(-1).text() : ''; } };
}

test('perfil escalar ADMINISTRATIVO autoriza menú/módulo; rol operativo conserva bloqueo', async () => {
  const h = harness(); const profile = await h.api.loadPanelSessionProfile();
  assert.deepEqual(plain(profile), { rol: 'ADMINISTRATIVO', plaza: 'ADMINISTRATIVO' });
  assert.deepEqual(h.reads, ['users/rh/rol', 'users/rh/plaza']);
  h.api.setProfile(profile); h.api.applyPanelRoleAccess(); assert.equal(h.node('moduleAttendanceCard').disabled, false);
  assert.equal(h.api.panelCanOpenModule('attendance'), true); h.window.openAttendanceWorkspace(); assert.equal(h.node('attendanceWorkspace').style.display, 'block');
  h.api.setProfile({ rol: 'GERENTE' }); assert.equal(h.api.panelCanOpenModule('attendance'), false);
});

test('Cleon con UID canónico llega a filas, estadísticas, tarjetas, gráficas, reportes, alertas y CSV reales', async () => {
  const h = harness(); await h.run();
  assert.equal(h.window.__filteredRecords.length, 5); assert.equal(h.node('statTotal').textContent, 5);
  assert.equal(h.node('statEntradas').textContent, 3); assert.equal(h.node('statSalidas').textContent, 2); assert.equal(h.node('statUsuarios').textContent, 1);
  assert.equal((h.node('tableContainer').innerHTML.match(/rec-nombre/g) || []).length, 5);
  assert.match(h.node('tableContainer').innerHTML, /Cleon RH/); assert.doesNotMatch(h.node('tableContainer').innerHTML, /Otra persona|btn-edit|btn-del/);
  assert.deepEqual(h.charts.chartLinea.data.datasets[0].data, [1, 1, 1]); assert.deepEqual(h.charts.chartLinea.data.datasets[1].data, [1, 0, 1]);
  assert.deepEqual(h.charts.chartSucursal.data.labels, ['ADMINISTRATIVO']);
  assert.deepEqual(h.charts.chartKm.data.labels, ['Cleon RH']); assert.deepEqual(h.charts.chartKm.data.datasets[0].data, [12]);
  assert.equal(h.window.__outsideBranchRecords.length, 5); assert.match(h.node('outsideBranchReport').innerHTML, /Cleon RH/);
  assert.equal(h.window.__mappableTrips.length, 3); assert.ok(h.window.__mappableTrips.every(t => t.uid === 'rh'));
  assert.equal(h.node('badgeEntradaSinSalida').textContent, 1); assert.equal(h.node('badgeViajeSinFin').textContent, 1);
  assert.match(h.node('listEntradaSinSalida').innerHTML, /Cleon RH/); assert.match(h.node('listViajeSinFin').innerHTML, /Cleon RH/);
  const csv = await h.csv(); assert.equal(csv.trim().split('\n').length, 6); assert.match(csv, /cleon@fredinero.com/); assert.doesNotMatch(csv, /other@example.test/);
  assert.equal(h.reads.length, 4, 'users + asistencia por fecha + dos consultas de viajes preexistentes'); assert.deepEqual(h.forbidden, []);
});

test('búsqueda de correo insensible a mayúsculas no amplía usuarios ni lecturas al repetir', async () => {
  const h = harness(); h.node('filtroUsuario').value = ' CLEON@FREDINERO.COM '; await h.run();
  assert.ok(h.window.__filteredRecords.every(r => r.user_uid === 'rh'));
  const count = h.reads.length; await h.run(); assert.equal(h.reads.length - count, 3, 'directorio en memoria sin recarga extra');
  assert.equal(h.window.__filteredRecords.length, 5); assert.deepEqual(h.forbidden, []);
});

test('rol/plaza ADMINISTRATIVO funcionan; plaza normaliza espacios pero rol de fila no trim/alias', async () => {
  const data = fixtures(); data.users.rh.plaza = ' administrátivo ';
  const h = harness(data); h.node('filtroRol').value = 'ADMINISTRATIVO'; h.node('filtroPlaza').value = 'ADMINISTRATIVO'; await h.run(); assert.equal(h.window.__filteredRecords.length, 5);
  const odd = fixtures(); odd.users.rh.rol = ' ADMINISTRATIVO '; const g = harness(odd); g.node('filtroRol').value = 'ADMINISTRATIVO'; await g.run(); assert.equal(g.window.__filteredRecords.length, 0, 'limitación real, no perfil supuesto');
  g.node('filtroRol').value = ''; await g.api.filterAndRender(); assert.equal(g.window.__filteredRecords.length, 5);
});

test('tipo ENTRADA filtra tarjetas/CSV pero empareja SALIDA en alertas sin falsos positivos', async () => {
  const h = harness(); h.node('filtroTipo').value = 'ENTRADA'; await h.run();
  assert.equal(h.window.__filteredRecords.length, 3); assert.equal(h.node('badgeEntradaSinSalida').textContent, 1);
  assert.deepEqual(h.charts.chartLinea.data.datasets[1].data, [0, 0, 0]);
  const csv = await h.csv(); assert.equal(csv.trim().split('\n').length, 4); assert.doesNotMatch(csv, /"SALIDA"/);
});

test('UID ausente/no coincidente no inventa identidad; sin búsqueda sólo muestra Usuario desconocido', async () => {
  const data = fixtures(); data.users.legacy = data.users.rh; delete data.users.rh;
  const h = harness(data); await h.run(); assert.equal(h.window.__filteredRecords.length, 0);
  h.node('filtroUsuario').value = ''; await h.api.filterAndRender(); assert.equal(h.window.__filteredRecords.length, 6);
  assert.match(h.node('tableContainer').innerHTML, /Usuario desconocido/); assert.doesNotMatch(h.node('tableContainer').innerHTML, /Cleon RH/);
});

test('rango temporal real: segundo final incluido, milisegundos finales no; km excluye último día y alertas excluyen hoy', async () => {
  const data = fixtures(); data.records.before = { ...data.records.own1, timestamp: ts(4, 23, 59, 59) };
  data.records.lastSecond = { ...data.records.own5, timestamp: ts(10, 23, 59, 59) };
  data.records.lastMillis = { ...data.records.own5, timestamp: ts(10, 23, 59, 59, 999) };
  data.records.after = { ...data.records.own1, timestamp: ts(11) }; delete data.records.own5;
  const h = harness(data); await h.run();
  assert.ok(h.window.__filteredRecords.some(r => r.id === 'lastSecond')); assert.ok(!h.window.__filteredRecords.some(r => ['before', 'lastMillis', 'after'].includes(r.id)));
  assert.deepEqual(h.charts.chartKm.data.datasets[0].data, [12], '99km del último día no forman parte de esta gráfica');
  assert.equal(h.node('badgeEntradaSinSalida').textContent, 1, 'hoy excluido incluso si falta salida');
  assert.deepEqual(h.reads.filter(r => typeof r === 'object').map(r => r.route), ['attendance_records', 'vehicle_trips', 'vehicle_trips']);
  assert.deepEqual(h.forbidden, []);
});
