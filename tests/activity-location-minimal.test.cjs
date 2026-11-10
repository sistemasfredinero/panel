'use strict';
// Código real del panel, Firebase simulado; ninguna conexión o escritura.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function fn(name) {
  const result = html.match(new RegExp(`^  (?:async )?function ${name}\\([^\\n]*\\) \\{(?:[^\\n]*\\}$|\\n[\\s\\S]*?^  \\})`, 'm'));
  assert.ok(result, name); return result[0];
}
function action(name) {
  const result = html.match(new RegExp(`^  window\\.${name} = (?:async )?function\\([^\\n]*\\) \\{\\n[\\s\\S]*?^  \\};`, 'm'));
  assert.ok(result, name); return result[0];
}
function constant(name) {
  const result = html.match(new RegExp(`^  const ${name} = (?:[^\\n]+;|[\\s\\S]*?^  [^\\n]*;)`, 'm'));
  assert.ok(result, name); return result[0];
}
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function harness({ role = 'ADMINISTRATIVO', plaza = 'TAMPICO', email = 'administracion@fredinero.com', store = {}, beforeRead } = {}) {
  const reads = [], usage = [], opened = [], alerts = [], modal = { active: false, classList: { add() { modal.active = true; }, remove() { modal.active = false; } } };
  const map = { innerHTML: '' };
  let now = 100_000, groupsInput, analysisCalls = 0, active = 0, maximumActive = 0;
  const context = { Date: class extends Date { static now() { return now; } }, Map, Set, Promise, Number, JSON,
    auth: { currentUser: { uid: 'test-account', email } }, _activityProfile: { rol: role, plaza, correo: email },
    database: {}, ref: (_, route) => route,
    get: async route => {
      assert.match(route, /^gestor_activities\/[^.#$\[\]\/]+(?:\/[^.#$\[\]\/]+)?\/(latitud|longitud|plaza)$/);
      reads.push(route); active++; maximumActive = Math.max(maximumActive, active);
      try {
        if (beforeRead) await beforeRead(route, context);
        const value = route.split('/').reduce((parent, key) => parent?.[key], store);
        return { val: () => value ?? null };
      } finally { active--; }
    },
    recordPanelDataUsage: (key, value) => usage.push({ key, ...value }),
    window: { open: (...args) => opened.push(args) }, alert: message => alerts.push(message),
    document: { getElementById: id => id === 'activityRoutesMapModal' ? modal : map },
    currentActivityFilterCriteria: () => ({ start: 1, end: 2, actions: [] }),
    loadActivityAnalysisData: async () => { analysisCalls++; return Object.entries(store.gestor_activities || {}).map(([id, record]) => ({ id, plaza: record.plaza, tipo: 'GENERAL' })); },
    buildActivityRouteGroups: records => { groupsInput = records; return []; },
    renderEmptyActivityRoutesMap: () => { map.innerHTML = 'Sin rutas'; },
    activityRecordById: id => ({ id, plaza }),
    activityText: value => String(value),
  };
  vm.createContext(context);
  const names = ['normaliseActivityText', 'activityCanManageAll', 'activityIsManagerScope', 'activityIsAdministrative', 'isInManagerActivityScope', 'prospectSectionPlazas', 'activityRecordPath', 'activityFilterSignature',
    'activityBoundedRead', 'activityLocationContextKey', 'resetActivityLocationCache', 'hasActivityLocationCoordinates', 'loadActivityLocationRecord', 'loadActivityLocationRecords'];
  vm.runInContext([constant('PANEL_PLAZAS'), constant('TAMPICO_MADERO_MANAGER_EMAIL'),
    constant('ACTIVITY_LOCATION_CACHE_TTL_MS'), constant('ACTIVITY_LOCATION_CACHE_MAX'),
    'let _activityLightReads = 0; const _activityLightWaiters = [];',
    'const _activityLocationCache = new Map(); let _activityLocationGeneration = 0; let _activityRouteLoadRevision = 0;',
    ...names.map(fn), action('openActivityMap'), action('openActivityRoutesMap'), action('closeActivityRoutesMap')].join('\n'), context);
  return { context, reads, usage, opened, alerts, map, modal, advance: value => { now += value; },
    max: () => maximumActive, groups: () => groupsInput, analysisCalls: () => analysisCalls };
}
function record(id = 'payment-1', plaza = 'TAMPICO') { return { id, plaza, tipo: 'COBRANZA', actualizado_en: 10 }; }
function store(plaza = 'TAMPICO') { return { gestor_activities: { 'payment-1': { plaza, latitud: 22.2, longitud: -97.9, historial_expediente: { history: { comentario: 'x'.repeat(100_000) } }, firma_base64: 'a'.repeat(300_000) } } }; }

test('GPS lee únicamente tres hojas; nunca expediente, bitácora, foto ni firma', async () => {
  const h = harness({ store: store() });
  const result = await h.context.loadActivityLocationRecord(record());
  assert.equal(result.latitud, 22.2); assert.equal(result.longitud, -97.9);
  assert.deepEqual(h.reads.sort(), ['gestor_activities/payment-1/latitud', 'gestor_activities/payment-1/longitud', 'gestor_activities/payment-1/plaza']);
  assert.equal(result.historial_expediente, undefined); assert.equal(result.firma_base64, undefined);
  assert.equal(h.usage[0].key, 'PANEL_ACTIVITY_LOCATION_SCALARS');
});
test('Dos llamadas simultáneas y reapertura reutilizan la misma lectura en sesión', async () => {
  const gate = deferred(); const h = harness({ store: store(), beforeRead: () => gate.promise });
  const one = h.context.loadActivityLocationRecord(record()); const two = h.context.loadActivityLocationRecord(record());
  gate.resolve(); await Promise.all([one, two]); await h.context.loadActivityLocationRecord(record());
  assert.equal(h.reads.length, 3);
});
test('TTL, actualización forzada y nueva vigencia invalidan coordenadas cacheadas', async () => {
  const h = harness({ store: store() });
  await h.context.loadActivityLocationRecord(record()); h.advance(300_001);
  await h.context.loadActivityLocationRecord(record()); assert.equal(h.reads.length, 6);
  await h.context.loadActivityLocationRecord(record(), { force: true }); assert.equal(h.reads.length, 9);
  await h.context.loadActivityLocationRecord({ ...record(), actualizado_en: 11 }); assert.equal(h.reads.length, 12);
});
test('Gerencia Tampico puede Madero, no Chihuahua; no se solicita GPS fuera del alcance', async () => {
  const h = harness({ role: 'GERENTE', plaza: 'TAMPICO', email: 'gerente.tampico@fredinero.com', store: store('MADERO') });
  await h.context.loadActivityLocationRecord(record('payment-1', 'MADERO'));
  await assert.rejects(h.context.loadActivityLocationRecord(record('payment-2', 'CHIHUAHUA')), /alcance/);
  assert.equal(h.reads.length, 3);
});
test('Gerencia local no puede abrir el GPS si cambió la plaza canónica', async () => {
  const h = harness({ role: 'GERENTE', plaza: 'CHIHUAHUA', email: 'gerente.chihuahua@fredinero.com', store: store('TAMPICO') });
  await assert.rejects(h.context.loadActivityLocationRecord(record('payment-1', 'CHIHUAHUA')), /plaza.*cambió/);
});
test('Cambio de cuenta o limpieza invalida solicitudes tardías y no comparte la caché', async () => {
  const gate = deferred(); let block = true;
  const h = harness({ store: store(), beforeRead: () => block ? gate.promise : undefined });
  const pending = h.context.loadActivityLocationRecord(record());
  h.context.auth.currentUser.uid = 'other-account'; gate.resolve(); await assert.rejects(pending, /sesión/);
  block = false; await h.context.loadActivityLocationRecord(record()); assert.equal(h.reads.length, 6);
  h.context.resetActivityLocationCache(); await h.context.loadActivityLocationRecord(record()); assert.equal(h.reads.length, 9);
});
test('Errores no son caché negativa permanente; se permite reintentar manualmente', async () => {
  let failing = true; const h = harness({ store: store(), beforeRead: () => { if (failing) throw new Error('Sin señal'); } });
  await assert.rejects(h.context.loadActivityLocationRecord(record()), /Sin señal/);
  failing = false; assert.equal((await h.context.loadActivityLocationRecord(record())).latitud, 22.2);
  assert.equal(h.reads.length, 6);
});
test('Rutas arbitrarias o raíz no se consultan', async () => {
  const h = harness({ store: store() });
  for (const path of ['users/account', 'gestor_activities', 'gestor_activities/a/../b', 'gestor_photos/a', 'gestor_activities/a/b/c']) {
    await assert.rejects(h.context.loadActivityLocationRecord({ ...record(), _activity_path: path }), /ruta/);
  }
  assert.equal(h.reads.length, 0);
});
test('Históricos anidados usan sus hojas reales y conservan su ruta', async () => {
  const h = harness({ store: { gestor_activities: { legacy: { 'payment-1': { plaza: 'TAMPICO', latitud: 22, longitud: -97 } } } } });
  const result = await h.context.loadActivityLocationRecord({ ...record(), _activity_path: 'gestor_activities/legacy/payment-1' });
  assert.equal(result.latitud, 22); assert.ok(h.reads.every(route => route.startsWith('gestor_activities/legacy/payment-1/')));
});
test('Valores vacíos, booleanos y fuera de rango no producen puntos falsos 0,0', async () => {
  const h = harness();
  for (const coords of [{ latitud: null, longitud: null }, { latitud: '', longitud: '' }, { latitud: true, longitud: -97 }, { latitud: 91, longitud: 0 }, { latitud: 22, longitud: 181 }]) {
    assert.equal(h.context.hasActivityLocationCoordinates(coords), false);
  }
  assert.equal(h.context.hasActivityLocationCoordinates({ latitud: '22.0', longitud: '-97.0' }), true);
  assert.equal(h.context.hasActivityLocationCoordinates({ latitud: 0, longitud: 0 }), true);
});
test('Carga de 200 coincidencias en bloques de seis, GPS mínimo y caché de reuso', async () => {
  const full = {}; const previews = [];
  for (let index = 0; index < 200; index++) {
    full[`id-${index}`] = { ...store().gestor_activities['payment-1'], firma_base64: 'a'.repeat(1000), historial_expediente: { h: { comentario: 'b'.repeat(5000) } } };
    previews.push(record(`id-${index}`));
  }
  const h = harness({ store: { gestor_activities: full }, beforeRead: async () => { await Promise.resolve(); } });
  const result = await h.context.loadActivityLocationRecords(previews);
  assert.equal(result.length, 200); assert.equal(h.reads.length, 600); assert.ok(h.max() <= 6);
  await h.context.loadActivityLocationRecords(previews); assert.equal(h.reads.length, 600);
  const oldBytes = Buffer.byteLength(JSON.stringify(full));
  const newBytes = h.usage.reduce((sum, item) => sum + Buffer.byteLength(JSON.stringify(item.payload)), 0);
  assert.ok(newBytes < oldBytes / 50, `GPS ligero ${newBytes}, antes ${oldBytes}`);
});
test('Un fallo durante GPS deja error visible; no publica mapa parcial', async () => {
  const h = harness({ store: store(), beforeRead: () => { throw new Error('No autorizado'); } });
  await h.context.window.openActivityRoutesMap();
  assert.match(h.map.innerHTML, /No se pudieron cargar.*No autorizado/);
  assert.equal(h.groups(), undefined);
});
test('Cerrar el mapa durante una consulta evita repintarlo tarde', async () => {
  const gate = deferred(); const h = harness({ store: store(), beforeRead: () => gate.promise });
  const pending = h.context.window.openActivityRoutesMap();
  await Promise.resolve(); h.context.window.closeActivityRoutesMap(); gate.resolve(); await pending;
  assert.equal(h.modal.active, false); assert.equal(h.groups(), undefined);
});
test('Abrir mapa individual usa GPS puntual y no convierte coordenadas ausentes en enlace', async () => {
  const h = harness({ store: store() }); await h.context.window.openActivityMap('payment-1');
  assert.equal(h.opened[0][0], 'https://www.google.com/maps?q=22.2,-97.9');
  const absent = harness(); await absent.context.window.openActivityMap('missing');
  assert.equal(absent.opened.length, 0); assert.match(absent.alerts[0], /GPS válida/);
});
