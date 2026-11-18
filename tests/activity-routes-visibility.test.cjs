'use strict';
// Sólo funciones REALES de index.html en VM. No red, Firebase, Leaflet ni writes.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const NAMES = ['normaliseActivityText', 'activityCategory', 'activityCreatedTimestamp', 'firebasePushIdTimestamp', 'validCoordinates', 'activityDateInput', 'activityRouteIdentity', 'activityRouteManagement', 'activityRouteUser', 'buildActivityRouteManagementFilters', 'buildActivityRouteUserFilters', 'activityRouteColor', 'distanceInMeters', 'calculateActivityRouteMetrics', 'buildActivityRouteGroups', 'activityRoutesVisibility', 'escapeMapHtml', 'formatActivityDistance'];
function fn(name) {
  const match = html.match(new RegExp(`^  (?:async )?function ${name}\\([^\\n]*\\) \\{(?:[^\\n]*\\}$|\\n[\\s\\S]*?^  \\})`, 'm'));
  assert.ok(match, `CONTRACT MISSING: function ${name} en index.html; incorporar helper y reejecutar, sin fallback simulado`);
  return match[0];
}
function decl(name) {
  const match = html.match(new RegExp(`^  (?:const|let) ${name} = (?:[^\\n]+;|[\\s\\S]*?^  [^\\n]*;)`, 'm'));
  assert.ok(match, name); return match[0];
}
function harness() {
  const calls = [];
  const deny = name => () => { calls.push(name); throw Error(`Prohibido ${name}`); };
  const context = vm.createContext({ Map, Set, Date, console,
    fetch: deny('fetch'), get: deny('get'), onValue: deny('onValue'), set: deny('set'), update: deny('update'), remove: deny('remove'),
    setTimeout: deny('setTimeout'), setInterval: deny('setInterval'), document: new Proxy({}, { get: deny('DOM') }), window: {},
  });
  vm.runInContext([decl('FIREBASE_PUSH_ID_CHARS'), decl('ACTIVITY_ROUTE_COLORS'), ...NAMES.map(fn), `globalThis.api = { ${NAMES.join(',')} };`].join('\n'), context, { filename: 'index.html[actual-route-visibility]' });
  return { api: context.api, calls };
}
function freeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
const plain = value => JSON.parse(JSON.stringify(value));
const ids = groups => Array.from(groups, g => [g.key, Array.from(g.records, r => r.id)]);
function row(uid, day, index, overrides = {}) {
  return { id: `${uid}-${day}-${index}`, user_uid: uid, uid, nombre_usuario: uid === 'BLANCO' ? 'Blanco' : uid === 'VANESSA' ? 'Vanessa' : `Usuario ${uid}`,
    created_at: new Date(`${day}T10:00:00`).getTime() + index * 60000,
    tipo: index % 2 ? 'GENERAL' : 'COBRANZA', gestion_realizada: index % 2 ? 'Llamáda' : 'Visita',
    latitud: 22.2 + index / 1000, longitud: -97.8, rol: 'GESTOR', plaza: 'TAMPICO',
    nested: { unchanged: ['coords/fechas originales'] }, ...overrides };
}
function selections(api, groups) {
  return { users: new Set(api.buildActivityRouteUserFilters(groups).map(f => f.key)),
    managements: new Set(api.buildActivityRouteManagementFilters(groups).map(f => f.key)), routes: new Set(groups.map(g => g.key)) };
}
function apply(api, groups, s) { return api.activityRoutesVisibility(groups, s.users, s.managements, s.routes); }
const sum = map => Array.from(map.values()).reduce((a, b) => a + b, 0);
function oracle(api, groups, s) {
  const entries = [], routeRows = [], managementCounts = new Map(), userCounts = new Map();
  for (const group of groups) {
    // Invariante independiente: cada punto pasa simultáneamente los tres criterios.
    const selectedUserRecords = Array.from(group.records).filter(r => s.users.has(api.activityRouteIdentity(r)));
    if (!selectedUserRecords.length) continue;
    const selected = s.routes.has(group.key);
    const records = selectedUserRecords.filter(r => selected && s.managements.has(api.normaliseActivityText(api.activityRouteManagement(r)) || 'SIN_GESTION_CAPTURADA'));
    routeRows.push([group.key, records.map(r => r.id), selected]);
    if (records.length) entries.push([group.key, records.map(r => r.id)]);
    for (const record of records) {
      const u = api.activityRouteIdentity(record), m = api.normaliseActivityText(api.activityRouteManagement(record)) || 'SIN_GESTION_CAPTURADA';
      userCounts.set(u, (userCounts.get(u) || 0) + 1); managementCounts.set(m, (managementCounts.get(m) || 0) + 1);
    }
  }
  return { entries, routeRows, managementCounts, userCounts };
}
function check(api, groups, s, result) {
  const expected = oracle(api, groups, s);
  assert.deepEqual(ids(result.groups), expected.entries);
  assert.deepEqual(Array.from(result.routeRows, g => [g.key, Array.from(g.records, r => r.id), g.selected]), expected.routeRows);
  assert.ok(result.managementCounts instanceof Map); assert.ok(result.userCounts instanceof Map);
  for (const [actual, wanted] of [[result.managementCounts, expected.managementCounts], [result.userCounts, expected.userCounts]]) {
    for (const key of new Set([...actual.keys(), ...wanted.keys()])) assert.equal(actual.get(key) || 0, wanted.get(key) || 0, `conteo realmente visible: ${key}`);
    for (const count of actual.values()) assert.ok(Number.isInteger(count) && count >= 0);
  }
  assert.equal(result.totalRecords, expected.entries.reduce((n, [, records]) => n + records.length, 0));
  assert.equal(result.totalRecords, sum(result.managementCounts)); assert.equal(result.totalRecords, sum(result.userCounts));
  assert.equal(result.totalRoutes, expected.entries.length);
  assert.ok(Array.from(result.groups).every(g => g.records.length > 0), 'groups excluye vacíos');
  for (const group of [...result.groups, ...result.routeRows]) {
    const metrics = api.calculateActivityRouteMetrics(group.records);
    assert.equal(group.totalMeters, metrics.totalMeters, `métrica recalculada: ${group.key}`);
    assert.deepEqual(plain(group.segments), plain(metrics.segments));
    for (const [field, category] of [['generalCount', 'GENERAL'], ['cobranzaCount', 'COBRANZA'], ['prospeccionCount', 'PROSPECCION']]) {
      assert.equal(group[field], group.records.filter(r => api.activityCategory(r) === category).length, `categoría visible: ${field}`);
    }
    assert.equal(group.generalCount + group.cobranzaCount + group.prospeccionCount, group.records.length);
  }
  for (const group of result.groups) {
    const original = groups.find(g => g.key === group.key);
    assert.notEqual(group, original, 'no reemplazar records de grupo fuente');
    assert.notEqual(group.records, original.records);
    for (const record of group.records) assert.ok(original.records.includes(record), 'preservar objeto, coordenadas y fecha');
    const metrics = api.calculateActivityRouteMetrics(group.records);
    assert.equal(metrics.segments.length, Math.max(0, group.records.length - 1));
    assert.ok(Number.isFinite(metrics.totalMeters) && metrics.totalMeters >= 0);
    assert.equal(metrics.totalMeters, Array.from(metrics.segments).reduce((n, segment) => n + segment.meters, 0));
  }
}

test('contrato puro real, helper y reutilización de identidad/gestión/normalización', () => {
  const { api, calls } = harness();
  for (const helper of ['activityRouteIdentity', 'activityRouteManagement', 'normaliseActivityText']) assert.match(fn('activityRoutesVisibility'), new RegExp(`\\b${helper}\\(`));
  assert.doesNotMatch(fn('activityRoutesVisibility'), /\b(?:fetch|onValue|loadActivityRoutesData|loadActivityLocationRecords|setTimeout|setInterval)\s*\(/);
  const groups = freeze([]), s = { users: new Set(), managements: new Set(), routes: new Set() };
  check(api, groups, s, apply(api, groups, s)); assert.deepEqual(calls, []);
});

test('Blanco 7 actividades de dos tipos: al quitar otros usuarios no conservar el conteo global 358', () => {
  const { api, calls } = harness();
  const records = [...Array.from({ length: 7 }, (_, i) => row('BLANCO', '2026-11-17', i)), ...Array.from({ length: 351 }, (_, i) => row('OTRO', '2026-11-17', i))];
  const groups = freeze(api.buildActivityRouteGroups(records)), before = JSON.stringify(groups), s = selections(api, groups);
  assert.equal(apply(api, groups, s).totalRecords, 358);
  s.users = new Set(['blanco']); const result = apply(api, groups, s); check(api, groups, s, result);
  assert.equal(result.totalRecords, 7); assert.equal(result.managementCounts.get('VISITA'), 4); assert.equal(result.managementCounts.get('LLAMADA'), 3);
  assert.equal(result.userCounts.get('blanco'), 7); assert.equal(result.userCounts.get('otro') || 0, 0);
  assert.equal(result.totalRoutes, 1); assert.equal(result.routeRows.length, 1);
  assert.equal(JSON.stringify(groups), before); assert.deepEqual(calls, []);
});

test('Vanessa 13 el 17/11 y 4 el 18: AND, rutas recuperables, distancia dinámica y restauración', () => {
  const { api, calls } = harness();
  const records = [...Array.from({ length: 13 }, (_, i) => row('VANESSA', '2026-11-17', i)), ...Array.from({ length: 4 }, (_, i) => row('VANESSA', '2026-11-18', i)), ...Array.from({ length: 7 }, (_, i) => row('OTRO', '2026-11-18', i))];
  const groups = freeze(api.buildActivityRouteGroups(records)), before = JSON.stringify(groups), s = selections(api, groups);
  s.users = new Set(['vanessa']); const initial = apply(api, groups, s); check(api, groups, s, initial); assert.equal(initial.totalRecords, 17);
  s.routes.delete('vanessa::2026-11-17'); let result = apply(api, groups, s); check(api, groups, s, result);
  assert.equal(result.totalRecords, 4); assert.equal(result.totalRoutes, 1); assert.equal(result.routeRows.length, 2);
  const hidden = result.routeRows.find(g => g.key === 'vanessa::2026-11-17'); assert.equal(hidden.selected, false); assert.deepEqual(Array.from(hidden.records), []);
  const fullDistance = api.calculateActivityRouteMetrics(result.groups[0].records).totalMeters;
  s.managements.delete('LLAMADA'); result = apply(api, groups, s); check(api, groups, s, result);
  assert.equal(result.totalRecords, 2); assert.equal(result.userCounts.get('vanessa'), 2); assert.equal(result.managementCounts.get('LLAMADA') || 0, 0);
  const partialDistance = api.calculateActivityRouteMetrics(result.groups[0].records).totalMeters;
  assert.ok(partialDistance > 0 && partialDistance < fullDistance, 'distancia sólo puntos visibles; no métricas de 4/17 puntos');
  s.managements.clear(); result = apply(api, groups, s); check(api, groups, s, result); assert.equal(result.totalRoutes, 0); assert.equal(result.routeRows.length, 2);
  assert.equal(result.routeRows.find(g => g.day === '2026-11-18').selected, true, 'cero por gestión NO desmarca ruta');
  s.managements = selections(api, groups).managements; s.routes.add('vanessa::2026-11-17');
  assert.deepEqual(ids(apply(api, groups, s).groups), ids(initial.groups));
  s.routes.clear(); result = apply(api, groups, s); check(api, groups, s, result); assert.equal(result.routeRows.length, 2); assert.ok(result.routeRows.every(g => !g.selected && !g.records.length));
  s.routes = selections(api, groups).routes; s.users.clear(); result = apply(api, groups, s); check(api, groups, s, result); assert.equal(result.routeRows.length, 0);
  s.users = selections(api, groups).users; result = apply(api, groups, s); check(api, groups, s, result); assert.equal(result.totalRecords, 24);
  assert.equal(JSON.stringify(groups), before); assert.deepEqual(calls, []);
});

test('normalización gestión, UID independiente del nombre, fallback, prospección y textos maliciosos no alterados', () => {
  const { api, calls } = harness();
  const malicious = '<img src=x onerror="window.__visibilityInjected=1"> & \' <svg onload="window.__visibilityInjected=2">';
  const records = [row(' SAME-UID ', '2026-11-17', 0, { nombre_usuario: malicious, gestion_realizada: ' Gestión telefónica ' }),
    row('same-uid', '2026-11-17', 1, { nombre_usuario: 'Nombre cambiado', gestion_realizada: 'GESTION TELEFONICA' }),
    row('different-uid', '2026-11-17', 2, { nombre_usuario: malicious, gestion_realizada: '' }),
    row('same-uid', '2026-11-17', 3, { tipo: 'PROSPECCION', gestion_realizada: 'texto ignorado' }),
    row('', '2026-11-17', 4, { uid: '', correo_usuario: ' TEST@EXAMPLE.TEST ', nombre_usuario: malicious })];
  const groups = freeze(api.buildActivityRouteGroups(records)), before = JSON.stringify(groups), s = selections(api, groups);
  s.users = new Set(['same-uid']); s.managements = new Set(['GESTION TELEFONICA']); const result = apply(api, groups, s); check(api, groups, s, result);
  assert.equal(result.totalRecords, 2); assert.equal(result.managementCounts.get('GESTION TELEFONICA'), 2);
  assert.equal(api.activityRouteIdentity(records[4]), 'test@example.test');
  assert.equal(api.activityRouteManagement(records[2]), 'Sin gestión capturada'); assert.equal(api.activityRouteManagement(records[3]), 'Prospección');
  const escaped = api.escapeMapHtml(malicious); assert.doesNotMatch(escaped, /<img|<svg/); assert.match(escaped, /&lt;img/); assert.match(escaped, /&amp;/); assert.match(escaped, /&quot;/);
  assert.equal(result.groups[0].records[0].nombre_usuario, malicious, 'escapar al render, NO mutar fuente');
  assert.equal(JSON.stringify(groups), before); assert.deepEqual(calls, []);
});

test('4.000 registros / 250 interacciones deterministas: counts, métricas, opciones, orden, no mutación ni red', () => {
  const { api, calls } = harness();
  const records = Array.from({ length: 4000 }, (_, i) => row(`UID-${i % 20}`, `2026-11-${15 + Math.floor(i / 20) % 4}`, i, { tipo: ['GENERAL', 'COBRANZA', 'PROSPECCION'][i % 3], gestion_realizada: ['Visita', 'Llamada', 'Gestión telefónica'][Math.floor(i / 3) % 3] }));
  const recordsBefore = JSON.stringify(records), groups = freeze(api.buildActivityRouteGroups(records)), before = JSON.stringify(groups), all = selections(api, groups), s = selections(api, groups);
  const optionsBefore = JSON.stringify([api.buildActivityRouteUserFilters(groups), api.buildActivityRouteManagementFilters(groups)]);
  assert.equal(apply(api, groups, s).totalRecords, 4000);
  let seed = 0x51a7;
  const random = max => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
  const toggle = (set, key) => set.has(key) ? set.delete(key) : set.add(key);
  for (let interaction = 0; interaction < 250; interaction++) {
    const dimension = ['users', 'managements', 'routes'][interaction % 3], keys = [...all[dimension]];
    if (interaction % 31 === 0) s[dimension].clear();
    else if (interaction % 29 === 0) s[dimension] = new Set(all[dimension]);
    else toggle(s[dimension], keys[random(keys.length)]);
    const setsBefore = JSON.stringify([Array.from(s.users), Array.from(s.managements), Array.from(s.routes)]);
    const result = apply(api, groups, s); check(api, groups, s, result);
    assert.equal(JSON.stringify([Array.from(s.users), Array.from(s.managements), Array.from(s.routes)]), setsBefore, `sin mutar selecciones ${interaction}`);
    assert.equal(JSON.stringify(groups), before, `sin mutar grupos/coords/fechas ${interaction}`);
  }
  Object.assign(s, selections(api, groups)); const restored = apply(api, groups, s); check(api, groups, s, restored); assert.equal(restored.totalRecords, 4000);
  assert.equal(JSON.stringify([api.buildActivityRouteUserFilters(groups), api.buildActivityRouteManagementFilters(groups)]), optionsBefore, 'opciones completas siguen disponibles aun 0');
  assert.equal(JSON.stringify(records), recordsBefore); assert.deepEqual(calls, []);
});
