'use strict';

// Las comprobaciones de expresiones NO sustituyen al motor real de Firebase.
// Modo emulador opcional, exclusivamente localhost y proyecto demo dedicado.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const fragment = JSON.parse(fs.readFileSync(path.join(__dirname, '../firebase/users-profile-rules.fragment.json'), 'utf8'));
const users = fragment.users;
const profileRules = users.$uid;
const required = ['uid', 'nombre_completo', 'apellido_paterno', 'correo', 'rol', 'plaza'];
const roles = ['GESTOR', 'GESTOR DE COBRANZA', 'CANJES', 'LIDER A', 'LIDER B', 'LIDER C', 'GERENTE', 'ADMINISTRATIVO'];
const support = { uid: '__SUPPORT_AUTH_UID__', token: { email: 'soporte@fredinero.com' } };
const owner = { uid: 'owner', token: { email: 'owner@example.test' } };
const other = { uid: 'other', token: { email: 'other@example.test' } };
const fields = ['read_count', 'estimated_bytes', 'last_estimated_bytes', 'last_records', 'last_scope', 'last_at', 'source'];

function fresh(uid = 'owner', overrides = {}) {
  return { uid, nombre_completo: 'Nombre Prueba', apellido_paterno: 'Prueba', correo: `${uid}@example.test`, rol: 'GESTOR', plaza: 'MADERO', creado_en: 123, ...overrides };
}

// API mínima de snapshots solo para evaluar estas expresiones conocidas.
// No modela autorización/cascada/multipath/validación del servidor Firebase.
function snapshot(tree, keys = []) {
  let value = tree;
  for (const key of keys) value = value == null ? null : value[key];
  return {
    val: () => value ?? null,
    exists: () => value !== undefined && value !== null,
    child: key => snapshot(tree, keys.concat(String(key).split('/'))),
    parent: () => snapshot(tree, keys.slice(0, -1)),
    hasChildren: list => value != null && typeof value === 'object' && (list ? list.every(key => value[key] !== undefined && value[key] !== null) : Object.keys(value).length > 0),
    isString: () => typeof value === 'string',
    isNumber: () => typeof value === 'number' && Number.isFinite(value),
  };
}
function expr(rule, { before = {}, after = before, keys = ['users', 'owner'], auth = owner, uid = 'owner', day = '2026-11-02', action = 'LECTURA' } = {}) {
  if (typeof rule === 'boolean') return rule;
  assert.equal(typeof rule, 'string');
  // JS match tiene la misma verdad/falsedad para las regex usadas aquí, no es
  // una implementación general del lenguaje de reglas (RE2) de Firebase.
  const source = rule.replace(/\.matches\(/g, '.match(');
  return !!vm.runInNewContext(`(${source})`, {
    auth, $uid: uid, $day: day, $action: action,
    root: snapshot(before), data: snapshot(before, keys), newData: snapshot(after, keys), now: 123,
  }, { timeout: 100 });
}
function walk(node, prefix = '', visit = () => {}) {
  visit(node, prefix);
  for (const [key, value] of Object.entries(node)) {
    if (!key.startsWith('.') && value && typeof value === 'object') walk(value, `${prefix}/${key}`, visit);
  }
}

test('fragmento aislado: solo users, lectura e índices conservados; sin permiso padre heredable', () => {
  assert.deepEqual(Object.keys(fragment), ['users']);
  assert.equal(users['.read'], true);
  assert.equal(users['.write'], false);
  assert.deepEqual(users['.indexOn'], ['correo', 'rol', 'plaza', 'uid']);
  assert.equal(profileRules.app_connection['.write'], false);
  assert.equal(profileRules.data_usage_metrics['.write'], false);
  assert.equal(profileRules.data_usage_metrics.$day.$action['.write'], false);
});

test('autoridad: UID exacto y email del token, nunca perfil mutable ni rol', () => {
  const rule = profileRules['.write'];
  assert.ok(expr(rule, { auth: support }));
  for (const auth of [null, owner, other,
    { uid: 'impostor', token: { email: 'soporte@fredinero.com' } },
    { uid: support.uid, token: { email: 'another@example.test' } },
    { uid: support.uid, token: {} },
    { uid: 'admin', token: { email: 'admin@example.test', rol: 'ADMINISTRATIVO' } },
  ]) assert.equal(expr(rule, { auth, before: { users: { [auth?.uid || 'x']: { correo: 'soporte@fredinero.com', rol: 'ADMINISTRATIVO' } } } }), false);
  assert.match(rule, /auth\.uid === '__SUPPORT_AUTH_UID__'/);
  assert.match(rule, /auth\.token\.email === 'soporte@fredinero\.com'/);
  assert.doesNotMatch(rule, /root|\.child|rol|correo/);
});

test('todos los permisos técnicos son explícitos, owner-only y requieren perfil previo', () => {
  const permitted = new Set([
    '/app_connection/version', '/app_connection/version_code', '/app_connection/last_connected_at',
    '/fcm_token', '/expo_push_token', '/data_usage_metrics/$day',
    ...fields.map(field => `/data_usage_metrics/$day/$action/${field}`),
  ]);
  const found = [];
  walk(profileRules, '', (node, route) => {
    if (route && typeof node['.write'] === 'string') {
      found.push(route);
      assert.ok(permitted.has(route), route);
      assert.match(node['.write'], /auth != null && auth\.uid === \$uid/);
      assert.match(node['.write'], /root\.child\('users'\)\.child\(\$uid\)\.exists\(\)/);
      assert.doesNotMatch(node['.write'], /correo|rol|support|SUPPORT/);
      if (route !== '/data_usage_metrics/$day') assert.match(node['.write'], /newData\.exists\(\)/);
    }
  });
  assert.deepEqual(found.sort(), [...permitted].sort());
  for (const field of required.concat(['creado_en'])) assert.equal(profileRules[field]['.write'], undefined, field);
  assert.equal(profileRules.$other, undefined, 'Sin permiso comodín para flags o datos anidados nuevos');
});

test('alta completa, obligatorios y validación de campos modificados, con históricos tolerados', () => {
  const rule = profileRules['.validate'];
  const after = { users: { owner: fresh() } };
  assert.ok(expr(rule, { before: {}, after }));
  for (const key of required) {
    const incomplete = fresh(); delete incomplete[key];
    assert.equal(expr(rule, { before: {}, after: { users: { owner: incomplete } } }), false, key);
  }
  const before = { users: { owner: { uid: 'legacy-wrong', rol: 'ROL HISTORICO', otro: { actividad: 1 } } } };
  const updated = { users: { owner: { ...before.users.owner, fcm_token: 'token' } } };
  assert.ok(expr(rule, { before, after: updated }), 'La telemetría no exige una migración');
  for (const field of ['uid', 'rol']) assert.ok(expr(profileRules[field]['.validate'], { before, after: updated, keys: ['users', 'owner', field] }));
  assert.equal(expr(profileRules.uid['.validate'], { before, after: { users: { owner: { uid: 'different' } } }, keys: ['users', 'owner', 'uid'] }), false);
  assert.ok(expr(profileRules.uid['.validate'], { before, after: { users: { owner: { uid: 'owner' } } }, keys: ['users', 'owner', 'uid'] }));
  for (const rol of roles) assert.ok(expr(profileRules.rol['.validate'], { before: {}, after: { users: { owner: { rol } } }, keys: ['users', 'owner', 'rol'] }), rol);
  for (const [field, value] of [['rol', 'SUPERADMIN'], ['correo', 'USER@EXAMPLE.TEST'], ['correo', 'bad'], ['nombre_completo', '   '], ['apellido_paterno', ''], ['plaza', 'madero']]) {
    assert.equal(expr(profileRules[field]['.validate'], { before: {}, after: { users: { owner: { [field]: value } } }, keys: ['users', 'owner', field] }), false, field);
  }
});

test('conexión y tokens: dueño existente únicamente, no crea perfil ni permite borrar hojas', () => {
  const before = { users: { owner: { uid: 'legacy-wrong' } } };
  for (const [keys, value, rule] of [
    [['users', 'owner', 'app_connection', 'version'], '1.6.7', profileRules.app_connection.version],
    [['users', 'owner', 'app_connection', 'version_code'], 67, profileRules.app_connection.version_code],
    [['users', 'owner', 'app_connection', 'last_connected_at'], 123, profileRules.app_connection.last_connected_at],
    [['users', 'owner', 'fcm_token'], 'fcm-test', profileRules.fcm_token],
    [['users', 'owner', 'expo_push_token'], 'expo-test', profileRules.expo_push_token],
  ]) {
    const after = JSON.parse(JSON.stringify(before));
    let node = after; for (const key of keys.slice(0, -1)) node = node[key] ??= {};
    node[keys.at(-1)] = value;
    assert.ok(expr(rule['.write'], { before, after, keys }));
    assert.ok(expr(rule['.validate'], { before, after, keys }));
    for (const auth of [null, other]) assert.equal(expr(rule['.write'], { before, after, keys, auth }), false);
    assert.equal(expr(rule['.write'], { before: {}, after, keys }), false);
    assert.equal(expr(rule['.write'], { before, after: before, keys }), false);
  }
});

test('retención de un día no puede borrar el último contenido de un perfil histórico', () => {
  const keys = ['users', 'owner', 'data_usage_metrics', '2026-10-02'];
  const rule = profileRules.data_usage_metrics.$day['.write'];
  const before = { users: { owner: { uid: 'legacy-wrong', data_usage_metrics: { '2026-10-02': { LECTURA: { read_count: 1 } } } } } };
  assert.ok(expr(rule, { before, after: { users: { owner: { uid: 'legacy-wrong' } } }, keys }));
  assert.equal(expr(rule, { before, after: {}, keys }), false);
  assert.equal(expr(rule, { before, after: { users: { owner: { uid: 'legacy-wrong' } } }, keys, auth: other }), false);
});

test('métricas: nombres reales y valores actuales APP/PANEL; sin campos extra autorizados', () => {
  const actionRules = profileRules.data_usage_metrics.$day.$action;
  assert.deepEqual(Object.keys(actionRules).filter(key => !key.startsWith('.')).sort(), fields.slice().sort());
  const values = { read_count: 1, estimated_bytes: 80, last_estimated_bytes: 80, last_records: 1, last_scope: 'MADERO', last_at: 123, source: 'APP' };
  const after = { users: { owner: { data_usage_metrics: { '2026-11-02': { LECTURA: values } } } } };
  for (const field of fields) assert.ok(expr(actionRules[field]['.validate'], { before: {}, after, keys: ['users', 'owner', 'data_usage_metrics', '2026-11-02', 'LECTURA', field] }), field);
  after.users.owner.data_usage_metrics['2026-11-02'].LECTURA.source = 'PANEL';
  assert.ok(expr(actionRules.source['.validate'], { after, keys: ['users', 'owner', 'data_usage_metrics', '2026-11-02', 'LECTURA', 'source'] }));
  assert.ok(expr(profileRules.data_usage_metrics.$day['.validate'], { day: '2026-11-02' }));
  assert.equal(expr(profileRules.data_usage_metrics.$day['.validate'], { day: 'rol' }), false);
  assert.equal(expr(actionRules['.validate'], { action: 'rol/privilegio' }), false);
});

const emulatorRequested = process.env.USERS_RULES_RUN_EMULATOR === '1';
test('MOTOR REAL RTDB: matriz local demo (opcional; no confundir con tests de expresiones)', { skip: !emulatorRequested, timeout: 120000 }, async t => {
  const hostValue = process.env.FIREBASE_DATABASE_EMULATOR_HOST || '';
  const hostMatch = /^(127\.0\.0\.1|localhost):([0-9]+)$/.exec(hostValue);
  assert.ok(hostMatch, 'Solo se acepta FIREBASE_DATABASE_EMULATOR_HOST local explícito');
  const port = Number(hostMatch[2]);
  assert.ok(port > 0 && port <= 65535);
  const loader = process.env.USERS_RULES_TEST_MODULES
    ? createRequire(path.join(path.resolve(process.env.USERS_RULES_TEST_MODULES), '__users_rules_test__.cjs'))
    : require;
  const { initializeTestEnvironment, assertSucceeds, assertFails } = loader('@firebase/rules-unit-testing');
  const { ref, set, update, get, remove, increment, runTransaction, serverTimestamp } = loader('firebase/database');
  const testUid = 'support-test';
  const rules = JSON.stringify({ rules: { users } }).replaceAll('__SUPPORT_AUTH_UID__', testUid);
  const env = await initializeTestEnvironment({ projectId: 'demo-users-profile-rules', database: { host: hostMatch[1], port, rules } });
  const db = uid => env.authenticatedContext(uid, { email: `${uid}@example.test` }).database();
  const supportDb = env.authenticatedContext(testUid, { email: 'soporte@fredinero.com' }).database();
  const ownerDb = db('owner');
  const otherDb = db('other');
  const anonDb = env.unauthenticatedContext().database();
  const fakeEmailDb = env.authenticatedContext('impostor', { email: 'soporte@fredinero.com' }).database();
  const wrongEmailDb = env.authenticatedContext(testUid, { email: 'wrong@example.test' }).database();
  const oldDay = '2026-10-02';
  const day = '2026-11-02';
  const base = { users: {
    owner: { uid: 'legacy-wrong', rol: 'ROL HISTORICO', desconocido: { actividad: { id: 1 } }, data_usage_metrics: { [oldDay]: { ANTIGUA: { read_count: 1 } } } },
    other: fresh('other'),
    impostor: fresh('impostor', { correo: 'soporte@fredinero.com', rol: 'ADMINISTRATIVO' }),
    metricsOnly: { data_usage_metrics: { [oldDay]: { ANTIGUA: { read_count: 1 } } } },
  } };
  async function reset() {
    await env.clearDatabase();
    await env.withSecurityRulesDisabled(ctx => set(ref(ctx.database()), base));
  }
  try {
    await t.test('lectura pública, alta por transacción soporte y todos los roles canónicos', async () => {
      await reset();
      await assertSucceeds(get(ref(anonDb, 'users')));
      for (let i = 0; i < roles.length; i++) {
        const uid = `created${i}`;
        const result = await assertSucceeds(runTransaction(ref(supportDb, `users/${uid}`), current => current === null ? fresh(uid, { rol: roles[i], creado_en: serverTimestamp() }) : undefined));
        assert.equal(result.committed, true);
      }
      const unchanged = (await get(ref(supportDb, 'users/owner'))).val();
      const result = await runTransaction(ref(supportDb, 'users/owner'), current => current === null ? fresh() : undefined);
      assert.equal(result.committed, false);
      assert.deepEqual((await get(ref(supportDb, 'users/owner'))).val(), unchanged);
      const metricsResult = await runTransaction(ref(supportDb, 'users/metricsOnly'), current => current === null ? fresh('metricsOnly') : undefined);
      assert.equal(metricsResult.committed, false);
    });
    await t.test('altas incompletas/UID inválido y rol no canónico denegados', async () => {
      await reset();
      for (const field of required) {
        const value = fresh('new'); delete value[field];
        await assertFails(set(ref(supportDb, 'users/new'), value));
      }
      await assertFails(set(ref(supportDb, 'users/new'), fresh('wrong')));
      await assertFails(set(ref(supportDb, 'users/new'), fresh('new', { rol: 'SUPERADMIN' })));
    });
    await t.test('no alta ni CRUD ordinary/anonymous; no suplantación por email o perfil', async () => {
      await reset();
      for (const client of [ownerDb, otherDb, anonDb, fakeEmailDb, wrongEmailDb]) {
        await assertFails(set(ref(client, 'users/new'), fresh('new')));
        await assertFails(set(ref(client, 'users/owner'), fresh()));
        await assertFails(remove(ref(client, 'users/owner')));
        for (const [field, value] of [['uid', 'owner'], ['correo', 'soporte@fredinero.com'], ['rol', 'ADMINISTRATIVO'], ['plaza', 'TAMPICO'], ['nombre_completo', 'Nuevo nombre'], ['apellido_paterno', 'Apellido'], ['is_admin', true]]) {
          await assertFails(update(ref(client, 'users/owner'), { [field]: value }));
        }
      }
      await assertFails(set(ref(ownerDb, 'users'), { owner: fresh() }));
      await assertFails(remove(ref(ownerDb, 'users')));
    });
    await t.test('conexión, tokens atómicos, métricas incrementales y retención sobre histórico incompleto', async () => {
      await reset();
      await assertSucceeds(update(ref(ownerDb, 'users/owner/app_connection'), { version: '1.6.7', version_code: 67, last_connected_at: 123 }));
      await assertSucceeds(update(ref(ownerDb, 'users/owner'), { fcm_token: 'fcm-test', expo_push_token: 'fcm-test' }));
      const metrics = { [oldDay]: null, [`${day}/LECTURA/read_count`]: increment(1), [`${day}/LECTURA/estimated_bytes`]: increment(80), [`${day}/LECTURA/last_estimated_bytes`]: 80, [`${day}/LECTURA/last_records`]: 1, [`${day}/LECTURA/last_scope`]: 'MADERO', [`${day}/LECTURA/last_at`]: 123, [`${day}/LECTURA/source`]: 'APP' };
      await assertSucceeds(update(ref(ownerDb, 'users/owner/data_usage_metrics'), metrics));
      await assertSucceeds(update(ref(ownerDb, 'users/owner/data_usage_metrics'), { ...metrics, [`${day}/LECTURA/source`]: 'PANEL' }));
      const result = (await get(ref(ownerDb, 'users/owner'))).val();
      assert.equal(result.uid, 'legacy-wrong');
      assert.equal(result.rol, 'ROL HISTORICO');
      assert.deepEqual(result.desconocido, base.users.owner.desconocido);
      assert.equal(result.data_usage_metrics[oldDay], undefined);
      assert.equal(result.data_usage_metrics[day].LECTURA.read_count, 2);
      assert.equal(result.data_usage_metrics[day].LECTURA.estimated_bytes, 160);
    });
    await t.test('no writes técnicos ajenos, sin perfil, campos extra, tipos inválidos o elevación mixta', async () => {
      await reset();
      for (const client of [otherDb, anonDb]) {
        await assertFails(update(ref(client, 'users/owner/app_connection'), { version: '1.6.7' }));
        await assertFails(update(ref(client, 'users/owner'), { fcm_token: 'token' }));
        await assertFails(set(ref(client, `users/owner/data_usage_metrics/${day}/LECTURA/read_count`), 1));
      }
      const missing = db('missing');
      await assertFails(update(ref(missing, 'users/missing/app_connection'), { version: '1.6.7' }));
      await assertFails(update(ref(missing, 'users/missing'), { fcm_token: 'token', expo_push_token: 'token' }));
      await assertFails(set(ref(missing, `users/missing/data_usage_metrics/${day}/LECTURA/read_count`), 1));
      await assertFails(update(ref(ownerDb, 'users/owner/app_connection'), { is_admin: true }));
      await assertFails(update(ref(ownerDb, 'users/owner/app_connection'), { version_code: 'bad' }));
      await assertFails(set(ref(ownerDb, `users/owner/data_usage_metrics/${day}/LECTURA/is_admin`), true));
      await assertFails(set(ref(ownerDb, `users/owner/data_usage_metrics/${day}/LECTURA/read_count`), -1));
      await assertFails(update(ref(ownerDb, 'users/owner'), { fcm_token: 'new-token', rol: 'ADMINISTRATIVO' }));
      assert.equal((await get(ref(ownerDb, 'users/owner/fcm_token'))).exists(), false, 'El payload mixto no escribió ni la parte técnica');
      await assertFails(remove(ref(ownerDb, 'users/owner/desconocido')));
      await assertFails(remove(ref(db('metricsOnly'), `users/metricsOnly/data_usage_metrics/${oldDay}`)));
    });
    await t.test('CRUD de soporte conserva hojas ajenas con update, borrado de perfil autorizado', async () => {
      await reset();
      await assertSucceeds(update(ref(supportDb, 'users/owner'), { rol: 'GERENTE', plaza: 'MADERO' }));
      assert.deepEqual((await get(ref(supportDb, 'users/owner/desconocido'))).val(), base.users.owner.desconocido);
      await assertSucceeds(set(ref(supportDb, 'users/new'), fresh('new')));
      await assertSucceeds(remove(ref(supportDb, 'users/new')));
    });
  } finally {
    await env.cleanup();
  }
});
