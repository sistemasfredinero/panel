'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function fn(name) {
  const match = html.match(new RegExp(`^  (?:async )?function ${name}\\([^\\n]*\\) \\{(?:[^\\n]*\\}$|\\n[\\s\\S]*?^  \\})`, 'm'));
  assert.ok(match, name); return match[0];
}
function harness({ store = {}, manager = false, beforeRead } = {}) {
  const reads = [], usage = [], nodes = new Map();
  const photos = [], details = [];
  let active = 0, maximum = 0;
  const context = vm.createContext({
    auth: { currentUser: { uid: 'synthetic', email: 'synthetic@example.test' } }, database: {},
    window: { viewActivityAttachments: id => photos.push(id), viewActivityDetail: id => details.push(id) },
    alert: message => details.push({ error: message }),
    activityQueryContextKey: () => context.auth.currentUser?.uid || '',
    activityFilterSignature: () => 'f', currentActivityFilterCriteria: () => ({}),
    renderFullActivityDetail: record => details.push(record),
    ref: (_, route) => route,
    get: async route => {
      assert.match(route, /^gestor_activities\/(?:[^/]+\/)?[^/]+(?:\/plaza)?$/);
      assert.ok(!/^gestor_activities$/.test(route)); reads.push(route); active++; maximum = Math.max(maximum, active);
      try {
        await Promise.resolve(); if (beforeRead) await beforeRead(route);
        const value = route.split('/').reduce((parent, key) => parent?.[key], store);
        return { exists: () => value !== undefined && value !== null, val: () => value ?? null };
      } finally { active--; }
    },
    activityIsManagerScope: () => manager,
    isInManagerActivityScope: record => !manager || record.plaza === 'CHIHUAHUA',
    recordPanelDataUsage: (action, data) => usage.push({ action, ...data }),
    document: { getElementById: id => { if (!nodes.has(id)) { const classes = new Set(); nodes.set(id, { innerHTML: '', textContent: '', style: {}, removeAttribute() {}, classList: { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value) } }); } return nodes.get(id); } },
  });
  const names = ['normaliseActivityText', 'activityCategory', 'activityRecordPath', 'activityDisplayLinkedPath', 'activityDisplayPaymentLinks', 'activityBoundedRead', 'loadFullActivityRecord', 'loadActivityBoardPaymentDetail', 'activityText', 'activityCreatedTimestamp', 'firebasePushIdTimestamp', 'activityCategoryLabel', 'activityBoardAction', 'activityBoardDateLabel', 'activityBoardMovementLabel', 'activityBoardTimeline', 'renderActivityBoardPaymentDetail'];
  const chars = html.match(/^  const FIREBASE_PUSH_ID_CHARS = [^\n]+;/m)[0];
  const actions = ['viewActivityBoardDetail', 'viewActivityBoardEvidence'].map(name => { const match = html.match(new RegExp(`^  window\\.${name} = async function\\([^\\n]*\\) \\{\\n[\\s\\S]*?^  \\};`, 'm')); assert.ok(match, name); return match[0]; });
  vm.runInContext([chars, 'let _activityLightReads=0;const _activityLightWaiters=[];const _activityDetailCache=new Map();const _calendarDetailRecords=new Map();const _activityBoardItems=new Map();let _activityBoardContext="synthetic|f";', ...names.map(fn), fn('activityBoardSelectedItem'), ...actions, `globalThis.api={loadActivityBoardPaymentDetail,renderActivityBoardPaymentDetail,calendar:_calendarDetailRecords,items:_activityBoardItems};`].join('\n'), context);
  return { api: context.api, reads, usage, nodes, photos, details, context, max: () => maximum };
}
const time = new Date(2026, 10, 6, 10).getTime();
function record(id, action, fields = {}) { return { id, tipo: 'COBRANZA', plaza: 'CHIHUAHUA', gestion_realizada: action, nombre_contacto: 'Distribuidora', nombre_usuario: 'Autor ' + id, created_at: time, ...fields }; }
function fixture(base = '') {
  const rows = { p: record('p', 'PROMESA DE PAGO', { recepcion_pago_id: 'r', ultima_llamada_control_id: 'l', renuencia_pago_id: 'n' }), r: record('r', 'RECEPCION DE PAGO', { promesa_pago_id: 'p', comprobacion_id: 'c' }), c: record('c', 'COMPROBACION DE PAGO', { recepcion_pago_id: 'r' }), l: record('l', 'LLAMADA DE CONTROL', { promesa_pago_id: 'p' }), n: record('n', 'RENUENCIA DE PAGO', { promesa_pago_id: 'p' }) };
  const route = `gestor_activities/${base ? base + '/' : ''}p`;
  return { store: { gestor_activities: base ? { [base]: rows } : rows }, rows, item: { root_path: route, record: { ...rows.r, _activity_path: route.replace(/p$/, 'r') }, relatedRecords: [], owner: { name: 'Autor original', plaza: 'CHIHUAHUA' } } };
}
for (const base of ['', 'legacy']) test(`bitácora ${base || 'plana'} recorre sólo enlaces explícitos sin duplicar lecturas ni descargar colecciones/fotos`, async () => {
  const f = fixture(base); const h = harness({ store: f.store });
  const results = await h.api.loadActivityBoardPaymentDetail(f.item);
  assert.equal(results.length, 5); assert.equal(h.reads.length, 5); assert.equal(new Set(h.reads).size, 5);
  assert.ok(h.reads.every(route => route.startsWith(`gestor_activities/${base ? base + '/' : ''}`)));
  assert.ok(h.max() <= 6); assert.equal(h.api.calendar.size, 5);
  await h.api.loadActivityBoardPaymentDetail(f.item); assert.equal(h.reads.length, 5, 'Detalle de sesión reutilizado');
});
test('gerente valida plaza escalar antes del expediente completo y rechaza la raíz trasladada', async () => {
  const f = fixture(); f.store.gestor_activities.p.plaza = 'TAMPICO'; const h = harness({ store: f.store, manager: true });
  await assert.rejects(h.api.loadActivityBoardPaymentDetail(f.item), /fuera de tu plaza/);
  assert.deepEqual(h.reads, ['gestor_activities/p/plaza']); assert.equal(h.api.calendar.size, 0);
});
test('gerente permite sólo sus movimientos, plaza seguida de expediente por ruta', async () => {
  const f = fixture(); const h = harness({ store: f.store, manager: true });
  assert.equal((await h.api.loadActivityBoardPaymentDetail(f.item)).length, 5);
  for (const id of ['p', 'r', 'c', 'l', 'n']) assert.ok(h.reads.indexOf(`gestor_activities/${id}/plaza`) < h.reads.indexOf(`gestor_activities/${id}`));
  assert.equal(h.reads.length, 10); assert.ok(h.max() <= 6);
});
test('ruta arbitraria o tercer nivel bloquea antes de consultar', async () => {
  for (const route of ['users/p', 'gestor_activities', 'gestor_activities/a/b/p']) {
    const h = harness(); await assert.rejects(h.api.loadActivityBoardPaymentDetail({ record: { id: 'p' }, root_path: route }), /enlace/); assert.equal(h.reads.length, 0);
  }
});
for (const problem of ['missing', 'denied', 'wrongType']) test(`movimiento ${problem} muestra fallo, nunca registra una bitácora parcial`, async () => {
  const f = fixture();
  if (problem === 'missing') delete f.store.gestor_activities.c;
  if (problem === 'wrongType') f.store.gestor_activities.c.tipo = 'GENERAL';
  const h = harness({ store: f.store, beforeRead: route => { if (problem === 'denied' && route.endsWith('/c')) throw new Error('No autorizado'); } });
  await assert.rejects(h.api.loadActivityBoardPaymentDetail(f.item), /movimiento|flujo|autorizado/);
  assert.equal(h.api.calendar.size, 0);
});
test('cancelación durante await evita publicar resultados de una consulta cerrada', async () => {
  const f = fixture(); let canceled = false;
  const h = harness({ store: f.store, beforeRead: async () => { canceled = true; } });
  await assert.rejects(h.api.loadActivityBoardPaymentDetail(f.item, () => { if (canceled) throw new Error('Cancelado'); }), /Cancelado/);
  assert.equal(h.api.calendar.size, 0);
});
test('render de bitácora usa responsables originales y no muestra botones de foto cuando no hay evidencia', async () => {
  const f = fixture(); const h = harness({ store: f.store }); const records = await h.api.loadActivityBoardPaymentDetail(f.item);
  h.api.renderActivityBoardPaymentDetail(f.item, records);
  const output = h.nodes.get('modalInfo').innerHTML;
  assert.match(output, /Autor original/); assert.match(output, /Autor r/); assert.match(output, /LLAMADA DE CONTROL/);
  assert.doesNotMatch(output, /viewActivityAttachments|<img/);
  records[2].tiene_evidencia = true; records[2].comentarios = '<script>malicioso</script>';
  h.api.renderActivityBoardPaymentDetail(f.item, records);
  const withPhoto = h.nodes.get('modalInfo').innerHTML;
  assert.equal((withPhoto.match(/viewActivityAttachments/g) || []).length, 1);
  assert.ok(!withPhoto.includes('<script>')); assert.match(withPhoto, /&lt;script&gt;/);
});

test('botón de prospecto carga raíz fuera de rango, no el último seguimiento asignado al líder', async () => {
  const original = { id: 'p', tipo: 'PROSPECCION', plaza: 'CHIHUAHUA', nombre_usuario: 'Gerente original', nombre_prospecto: 'Prospecto', historial_expediente: { h: { comentario: 'Historia original' } } };
  const h = harness({ store: { gestor_activities: { p: original } }, manager: true });
  h.api.items.set('prospect:p', { kind: 'prospect', root_path: 'gestor_activities/p', record: { id: 'follow-up', tipo: 'PROSPECCION', plaza: 'CHIHUAHUA', nombre_usuario: 'Líder' } });
  await h.context.window.viewActivityBoardDetail('prospect:p');
  assert.deepEqual(h.reads, ['gestor_activities/p/plaza', 'gestor_activities/p']);
  assert.equal(h.details[0].id, 'p'); assert.equal(h.details[0].nombre_usuario, 'Gerente original');
});

test('foto de raíz fuera de rango se abre por su ID, sólo si evidencia exacta y plaza permitida', async () => {
  const h = harness({ store: { gestor_activities: { p: { plaza: 'CHIHUAHUA' } } }, manager: true });
  const item = { kind: 'payment', root_id: 'p', root_path: 'gestor_activities/p', hasEvidence: false, record: { id: 'r', plaza: 'CHIHUAHUA' }, relatedRecords: [], owner: { name: 'Original', plaza: 'CHIHUAHUA' } };
  h.api.items.set('payment:p', item); await h.context.window.viewActivityBoardEvidence('payment:p');
  assert.equal(h.reads.length, 0); assert.equal(h.photos.length, 0);
  item.hasEvidence = true; await h.context.window.viewActivityBoardEvidence('payment:p');
  assert.deepEqual(h.reads, ['gestor_activities/p/plaza']); assert.deepEqual(h.photos, ['p']);
  assert.equal(h.api.calendar.get('p')._activity_path, 'gestor_activities/p');
});

test('cambio de sesión bloquea acciones antiguas antes de leer detalles o fotos', async () => {
  const h = harness(); h.api.items.set('old', { kind: 'payment', hasEvidence: true, record: { id: 'p' } });
  h.context.auth.currentUser = { uid: 'other' };
  await h.context.window.viewActivityBoardDetail('old'); await h.context.window.viewActivityBoardEvidence('old');
  assert.equal(h.reads.length, 0); assert.equal(h.photos.length, 0); assert.equal(h.details.length, 2);
});

test('invalidación de caché limpia tarjetas y bloquea acciones antiguas aunque la misma cuenta siga activa', async () => {
  const h = harness(); h.api.items.set('old', { kind: 'payment', hasEvidence: true, record: { id: 'p' } });
  vm.runInContext(fn('resetActivityBoardState') + '\nresetActivityBoardState();', h.context);
  assert.equal(h.api.items.size, 0);
  assert.match(fn('invalidateActivityQueryCache'), /window\.resetActivityBoard\(\)/);
  await h.context.window.viewActivityBoardEvidence('old');
  assert.equal(h.reads.length, 0); assert.equal(h.photos.length, 0);
});
