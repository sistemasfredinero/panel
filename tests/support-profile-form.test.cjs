'use strict';

// Prueba las funciones REALES extraídas de index.html. No usa red, navegador,
// Firebase real, credenciales, paquetes externos ni una copia del algoritmo.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const html = readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const plain = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const PROFILE_KEYS = ['uid', 'correo', 'nombre_completo', 'apellido_paterno', 'rol', 'plaza'];
const ROLES = ['GERENTE', 'LIDER A', 'LIDER B', 'LIDER C', 'CANJES', 'GESTOR', 'GESTOR DE COBRANZA', 'ADMINISTRATIVO'];
const SERVER_TIMESTAMP = { '.sv': 'timestamp' };

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

function realConstant(name) {
  const match = html.match(new RegExp(`^  const ${name} = (?:[^\\n]+;|[\\s\\S]*?^  [)\\]]?;)$`, 'm'));
  assert.ok(match, `Constante real no encontrada: ${name}`);
  return match[0];
}

function input(extra = {}) {
  return {
    uid: 'AbC_Auth-UID9', correo: 'persona@example.test', nombre_completo: 'Ana María',
    apellido_paterno: 'Pérez', rol: 'GESTOR', plaza: 'MERIDA CENTRO', ...extra,
  };
}

function snapshot(value, key = '') {
  const data = value === undefined ? null : plain(value);
  return {
    key,
    exists: () => data !== null && (typeof data !== 'object' || Object.keys(data).length > 0),
    val: () => plain(data),
    size: data && typeof data === 'object' ? Object.keys(data).length : 0,
    forEach: callback => {
      for (const [id, record] of Object.entries(data || {})) {
        if (callback(snapshot(record, id)) === true) return true;
      }
      return false;
    },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function harness({ users = {}, support = true, confirmed = true, values = {}, hooks = {} } = {}) {
  const store = {
    users: plain(users),
    tokens: { legacy: { token: 'token-intacto' } },
    user_tokens: { legacy: { device: 'dispositivo-intacto' } },
    app_config: { data_usage: { reads: 17 } },
    metrics: { legacy: { bytes: 123 } },
  };
  const reads = [];
  const refs = [];
  const transactions = [];
  const commits = [];
  const forbidden = [];
  const alerts = [];
  let clock = 1800000000000;
  const fields = {
    uid: 'supportProfileUid', correo: 'supportProfileEmail', nombre_completo: 'supportProfileName',
    apellido_paterno: 'supportProfileSurname', rol: 'supportProfileRole', plaza: 'supportProfilePlaza',
  };
  function node() {
    return {
      value: '', checked: false, disabled: false, hidden: false,
      textContent: '', innerHTML: '', className: '', style: {}, dataset: {},
      setAttribute(name, value) { this[name] = String(value); },
      removeAttribute(name) { delete this[name]; },
      classList: { add() {}, remove() {}, toggle() {} },
      focus() {},
    };
  }
  const ids = Object.fromEntries([
    ...Object.values(fields), 'supportProfileAuthConfirmed', 'supportProfileCheckButton',
    'supportProfileSaveButton', 'supportProfilePreview', 'supportProfileStatus', 'supportProfileForm',
  ].map(id => [id, node()]));
  const fill = profile => Object.entries(profile).forEach(([key, value]) => {
    if (fields[key]) ids[fields[key]].value = value;
  });
  fill(input(values));
  ids.supportProfileAuthConfirmed.checked = confirmed;
  ids.supportProfileSaveButton.disabled = true;
  ids.supportProfileForm.reset = () => {
    Object.values(fields).forEach(id => { ids[id].value = ''; });
    ids.supportProfileAuthConfirmed.checked = false;
  };
  const readPath = route => route.split('/').filter(Boolean).reduce((node, key) => node?.[key], store);
  const setPath = (route, value) => {
    const parts = route.split('/');
    const last = parts.pop();
    let node = store;
    for (const key of parts) node = node[key] ||= {};
    node[last] = plain(value);
  };
  const deny = name => () => { forbidden.push(name); throw new Error(`Operación prohibida: ${name}`); };
  const auth = { currentUser: { uid: 'support-auth-uid', email: support ? 'soporte@fredinero.com' : 'gerente@example.test' } };
  const sandbox = {
    auth, database: {}, console,
    document: {
      getElementById: id => ids[id] || null,
      querySelectorAll: selector => selector.includes('supportProfile') ? Object.values(fields).map(id => ids[id]) : [],
    },
    Date: class extends Date { static now() { return clock; } },
    alert: message => alerts.push(String(message)),
    confirm: () => true,
    recordPanelDataUsage: () => {},
    ref: (_database, route = '') => { refs.push(route); return route; },
    orderByChild: field => ({ type: 'orderByChild', field }),
    equalTo: value => ({ type: 'equalTo', value }),
    limitToLast: value => ({ type: 'limitToLast', value }),
    query: (route, ...constraints) => ({ route, constraints }),
    get: async request => {
      reads.push(plain(request));
      if (hooks.onGet) await hooks.onGet(request, h);
      const route = typeof request === 'string' ? request : request.route;
      let value = plain(readPath(route));
      if (request?.constraints) {
        const order = request.constraints.find(item => item.type === 'orderByChild');
        const equal = request.constraints.find(item => item.type === 'equalTo');
        const limit = request.constraints.find(item => item.type === 'limitToLast');
        value = Object.fromEntries(Object.entries(value || {})
          .filter(([, record]) => record?.[order?.field] === equal?.value)
          .slice(-(limit?.value || Infinity)));
      }
      return snapshot(value, route.split('/').at(-1));
    },
    runTransaction: async (route, callback, options) => {
      transactions.push({ route, options: plain(options) });
      if (hooks.beforeTransaction) await hooks.beforeTransaction(route, h);
      const current = plain(readPath(route)) ?? null;
      const next = callback(current);
      if (next === undefined) return { committed: false, snapshot: snapshot(current) };
      setPath(route, next);
      commits.push({ route, value: plain(next) });
      return { committed: true, snapshot: snapshot(next) };
    },
    serverTimestamp: () => plain(SERVER_TIMESTAMP),
    set: deny('set'), update: deny('update'), remove: deny('remove'),
    createUserWithEmailAndPassword: deny('createUserWithEmailAndPassword'),
    signInWithEmailAndPassword: deny('signInWithEmailAndPassword'),
    fetchSignInMethodsForEmail: deny('fetchSignInMethodsForEmail'),
    sendPasswordResetEmail: deny('sendPasswordResetEmail'),
    sendEmailVerification: deny('sendEmailVerification'),
    getAuth: deny('getAuth'), initializeApp: deny('initializeApp'),
    fetch: deny('fetch'),
  };
  // En el navegador window y el global son el mismo objeto; conserva esa semántica.
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  const code = [
    realConstant('SUPPORT_PROFILE_ROLES'),
    ...['privacyIsSupport', 'privacyEscape', 'normalizedSupportProfile', 'supportProfileFingerprint',
      'supportProfileInput', 'supportProfileSetBusy', 'supportProfileMessage'].map(realFunction),
    'let _supportProfileChecked = null;',
    'let _supportProfileBusy = false;',
    'let _supportProfileLastAttemptAt = 0;',
    ...['resetSupportProfileCheck', 'checkSupportProfile', 'saveSupportProfile'].map(realWindowFunction),
    'globalThis.api = { normalizedSupportProfile, supportProfileFingerprint, supportProfileInput, supportProfileSetBusy, supportProfileMessage, privacyIsSupport, state: () => ({ checked: _supportProfileChecked, busy: _supportProfileBusy, lastAttemptAt: _supportProfileLastAttemptAt }) };',
  ].join('\n\n');
  vm.runInContext(code, context, { filename: 'index.html:real-support-profile' });
  const h = {
    api: context.api, window: sandbox, auth, store, ids, fields, reads, refs,
    transactions, commits, forbidden, alerts, fill, readPath, setPath,
    advance: (milliseconds = 60000) => { clock += milliseconds; },
    status: () => `${ids.supportProfileStatus.textContent} ${ids.supportProfileStatus.innerHTML} ${alerts.join(' ')}`,
    preview: () => `${ids.supportProfilePreview.textContent} ${ids.supportProfilePreview.innerHTML}`,
    check: () => sandbox.checkSupportProfile(),
    save: () => sandbox.saveSupportProfile(),
  };
  return h;
}

function assertBoundedReads(h) {
  for (const request of h.reads) {
    if (typeof request === 'string') {
      assert.match(request, /^users\/[^./#$\[\]\/\s\x00-\x1f\x7f]{1,128}$/, 'Lectura únicamente por UID válido; nunca users completo');
    } else {
      assert.equal(request.route, 'users');
      assert.equal(request.constraints.length, 3, 'Consulta acotada de correo');
      assert.deepEqual(request.constraints.find(item => item.type === 'orderByChild'), { type: 'orderByChild', field: 'correo' });
      assert.deepEqual(request.constraints.find(item => item.type === 'equalTo'), { type: 'equalTo', value: 'persona@example.test' });
      assert.deepEqual(request.constraints.find(item => item.type === 'limitToLast'), { type: 'limitToLast', value: 2 });
    }
  }
  assert.equal(h.forbidden.length, 0, 'Sin escrituras generales, Auth SDK ni envío de correos');
}

function assertNoWrites(h) {
  assert.equal(h.transactions.length, 0);
  assert.equal(h.commits.length, 0);
  assert.equal(h.forbidden.length, 0);
}

function assertUnchecked(h) {
  assert.equal(h.api.state().checked, null);
  assert.equal(h.ids.supportProfileSaveButton.disabled, true);
}

test('normaliza exactamente seis campos, conserva mayúsculas del UID y no modifica la entrada', () => {
  const h = harness();
  const original = input({ uid: '  AbC_Auth-UID9  ', correo: '  PERSONA@Example.Test  ', nombre_completo: '  Ana María  ', apellido_paterno: ' Pérez ', plaza: '  MÉRIDA   centro  ', password: 'NO-DEBE-COPIARSE', admin: true });
  const before = plain(original);
  assert.deepEqual(plain(h.api.normalizedSupportProfile(original)), input());
  assert.deepEqual(original, before);
  assert.deepEqual(Object.keys(h.api.normalizedSupportProfile(original)).sort(), [...PROFILE_KEYS].sort());
  assert.equal(h.api.normalizedSupportProfile(input({ uid: 12345 })).uid, '12345');
  assert.equal(h.reads.length, 0);
  assertNoWrites(h);
});

test('UID: límites 1 y 128; rechaza vacíos, whitespace interno, claves Firebase y controles', () => {
  const { api } = harness();
  for (const uid of ['A', 'A'.repeat(128)]) assert.equal(api.normalizedSupportProfile(input({ uid })).uid, uid);
  for (const uid of ['', '   ', 'A'.repeat(129), '.', '..', 'a.b', 'a#b', 'a$b', 'a[b', 'a]b', 'a/b', 'a b', 'a\tb', 'a\nb', 'a\u00a0b', 'a\x00b', 'a\x1fb', 'a\x7fb']) {
    assert.throws(() => api.normalizedSupportProfile(input({ uid })), /UID|identificador/i, JSON.stringify(uid));
  }
});

test('correo: trim/lowercase y rechazo de sintaxis inválida', () => {
  const { api } = harness();
  assert.equal(api.normalizedSupportProfile(input({ correo: '  PERSONA@EXAMPLE.TEST ' })).correo, 'persona@example.test');
  for (const correo of ['', 'persona', '@example.test', 'persona@', 'persona@example', 'persona example@test.com', 'persona@@example.test', 'persona@example.test\nOTRO']) {
    assert.throws(() => api.normalizedSupportProfile(input({ correo })), /correo|email/i, correo);
  }
});

test('nombre y apellido: límites, trim y controles inválidos', () => {
  const { api } = harness();
  for (const [field, min, max] of [['nombre_completo', 2, 120], ['apellido_paterno', 1, 80]]) {
    for (const length of [min, max]) assert.equal(api.normalizedSupportProfile(input({ [field]: 'A'.repeat(length) }))[field].length, length);
    for (const value of ['', ' ', 'A'.repeat(min - 1), 'A'.repeat(max + 1), 'Ana\x00María', 'Ana\x1fMaría', 'Ana\x7fMaría']) {
      assert.throws(() => api.normalizedSupportProfile(input({ [field]: value })), /nombre|apellido/i, `${field}: ${JSON.stringify(value)}`);
    }
  }
});

test('roles: permite sólo la lista de negocio, no roles privilegiados inventados', () => {
  const { api } = harness();
  for (const rol of ROLES) assert.equal(api.normalizedSupportProfile(input({ rol })).rol, rol);
  for (const rol of ['', 'ADMIN', 'SOPORTE', 'SUPERADMIN', 'LIDER', 'GESTOR/ADMIN']) {
    assert.throws(() => api.normalizedSupportProfile(input({ rol })), /rol/i, rol);
  }
});

test('plaza: mayúsculas, diacríticos, espacios y caracteres/límites permitidos', () => {
  const { api } = harness();
  assert.equal(api.normalizedSupportProfile(input({ plaza: '  MÉRIDA   región-_ 01  ' })).plaza, 'MERIDA REGION-_ 01');
  for (const plaza of ['A', 'A'.repeat(50), 'NORTE_01-2']) assert.equal(api.normalizedSupportProfile(input({ plaza })).plaza, plaza);
  for (const plaza of ['', ' ', 'A'.repeat(51), 'NORTE/SUR', 'NORTE.CENTRO', '<NORTE>', 'NORTE#1', 'NORTE@1']) {
    assert.throws(() => api.normalizedSupportProfile(input({ plaza })), /plaza/i, plaza);
  }
});

test('fingerprint JSON estable usa sólo los seis campos normalizados y detecta cambios', () => {
  const { api } = harness();
  const expected = input();
  const fingerprint = api.supportProfileFingerprint(expected);
  assert.equal(typeof fingerprint, 'string');
  const serialized = JSON.parse(fingerprint);
  assert.deepEqual(serialized, Array.isArray(serialized) ? PROFILE_KEYS.map(key => expected[key]) : expected);
  assert.equal(fingerprint, api.supportProfileFingerprint(api.normalizedSupportProfile(input({ correo: ' PERSONA@EXAMPLE.TEST ', plaza: ' mérida   centro ', ignored: 'dato' }))));
  assert.equal(fingerprint, api.supportProfileFingerprint(Object.fromEntries(Object.entries(expected).reverse())));
  for (const [key, value] of Object.entries(input({ uid: 'OtherUID', correo: 'other@example.test', nombre_completo: 'Otra Persona', apellido_paterno: 'Otro', rol: 'CANJES', plaza: 'SUR' }))) {
    assert.notEqual(api.supportProfileFingerprint(input({ [key]: value })), fingerprint, key);
  }
});

test('sin soporte, comprobar y guardar no leen ni escriben aunque se declare rol privilegiado', async () => {
  const h = harness({ support: false });
  h.window.currentUser = { rol: 'SOPORTE', email: 'soporte@fredinero.com' };
  h.window.currentUserRole = 'SOPORTE';
  assert.equal(h.api.privacyIsSupport(), false);
  await h.check();
  await h.save();
  assert.equal(h.reads.length, 0);
  assertNoWrites(h);
  assertUnchecked(h);
});

test('sin confirmación manual de Auth, comprobar/guardar no efectúan I/O', async () => {
  const h = harness({ confirmed: false });
  await h.check();
  await h.save();
  assert.equal(h.reads.length, 0);
  assertNoWrites(h);
  assertUnchecked(h);
  assert.match(h.status(), /confirm|Auth|Firebase/i);
});

test('UID malicioso y rol no permitido no construyen rutas ni consultan Firebase', async () => {
  for (const values of [{ uid: '../users' }, { uid: 'a/b' }, { uid: '' }, { uid: 'a.b' }, { rol: 'SUPERADMIN' }]) {
    const h = harness({ values });
    await h.check();
    await h.save();
    assert.equal(h.reads.length, 0, JSON.stringify(values));
    assert.equal(h.refs.length, 0, 'No se deriva ninguna ruta desde una entrada inválida');
    assertNoWrites(h);
    assertUnchecked(h);
  }
});

test('comprobación válida consulta UID exacto y correo con límite 2; nunca escribe', async () => {
  const h = harness();
  await h.check();
  assert.ok(h.api.state().checked);
  assert.deepEqual(plain(h.api.state().checked.profile), input());
  assert.equal(h.api.state().checked.fingerprint, h.api.supportProfileFingerprint(input()));
  assert.equal(h.ids.supportProfileSaveButton.disabled, false);
  assert.ok(h.reads.includes('users/AbC_Auth-UID9'), 'No convierte UID a minúsculas');
  assert.ok(h.reads.some(item => typeof item === 'object'), 'Consulta correo, no sólo UID');
  assertBoundedReads(h);
  assertNoWrites(h);
  assert.equal(h.api.state().busy, false);
});

test('UID existente, incluso con tokens y métricas históricos, nunca se sobrescribe', async () => {
  const existing = { correo: 'viejo@example.test', nombre_completo: 'Histórico', rol: 'GESTOR', tokens: { a: 'token' }, metrics: { reads: 23 } };
  const h = harness({ users: { AbC_Auth_UID9: { unrelated: true }, 'AbC_Auth-UID9': existing } });
  const before = plain(h.store);
  await h.check();
  await h.save();
  assertUnchecked(h);
  assertNoWrites(h);
  assert.deepEqual(h.store, before);
  assert.match(h.status(), /existe|existente|registrad|ocupad|comprob|verific|revis/i);
  assertBoundedReads(h);
});

test('correo ya asociado a otro UID o duplicado bloquea el alta sin elegir un registro', async () => {
  for (const count of [1, 2, 3]) {
    const users = Object.fromEntries(Array.from({ length: count }, (_, i) => [`old-${i}`, { correo: 'persona@example.test', tokens: { old: true } }]));
    const h = harness({ users });
    const before = plain(h.store);
    await h.check();
    await h.save();
    assertUnchecked(h);
    assertNoWrites(h);
    assert.deepEqual(h.store, before);
    assertBoundedReads(h);
  }
});

test('guardar sin una comprobación previa se rechaza sin consultar ni escribir', async () => {
  const h = harness();
  await h.save();
  assert.equal(h.reads.length, 0);
  assertNoWrites(h);
  assertUnchecked(h);
  assert.match(h.status(), /comprob|verific|revis/i);
});

test('guardar crea sólo users/UID con seis campos y creado_en de serverTimestamp', async () => {
  const stale = { correo: 'stale@example.test', tokens: { old: 'intacto' }, metrics: { reads: 7 } };
  const h = harness({ users: { legacy: stale } });
  const before = plain(h.store);
  await h.check();
  const checkedReadCount = h.reads.length;
  h.advance();
  await h.save();
  assert.equal(h.commits.length, 1);
  assert.equal(h.transactions.length, 1);
  assert.deepEqual(h.transactions[0], { route: 'users/AbC_Auth-UID9', options: { applyLocally: false } });
  assert.deepEqual(h.commits[0], { route: 'users/AbC_Auth-UID9', value: { ...input(), creado_en: SERVER_TIMESTAMP } });
  assert.ok(h.reads.slice(checkedReadCount).some(item => typeof item === 'object'), 'Reconsulta correo inmediatamente antes de la transacción');
  delete h.store.users['AbC_Auth-UID9'];
  assert.deepEqual(h.store, before, 'No modifica perfiles obsoletos, tokens ni métricas');
  assertBoundedReads(h);
  assertUnchecked(h);
  assert.equal(h.api.state().busy, false);
});

test('cada campo modificado tras comprobar exige una nueva comprobación sin I/O de guardado', async () => {
  const changes = input({ uid: 'DifferentUID', correo: 'different@example.test', nombre_completo: 'Persona Distinta', apellido_paterno: 'Distinto', rol: 'CANJES', plaza: 'SUR' });
  for (const [key, value] of Object.entries(changes)) {
    const h = harness();
    await h.check();
    const beforeReads = h.reads.length;
    h.ids[h.fields[key]].value = value; // Sin evento: la defensa también debe existir en save.
    h.advance();
    await h.save();
    assertNoWrites(h);
    assert.equal(h.reads.length, beforeReads, key);
    assertUnchecked(h);
    assert.match(h.status(), /comprob|verific|cambi|revis/i);
  }
});

test('quitar confirmación tras comprobar bloquea guardar', async () => {
  const h = harness();
  await h.check();
  const reads = h.reads.length;
  h.ids.supportProfileAuthConfirmed.checked = false;
  h.advance();
  await h.save();
  assertNoWrites(h);
  assert.equal(h.reads.length, reads);
  assertUnchecked(h);
});

test('reset invalida fingerprint y preview; un guardado posterior requiere comprobar', async () => {
  const h = harness();
  await h.check();
  h.window.resetSupportProfileCheck();
  assertUnchecked(h);
  assert.equal(h.preview().trim(), '');
  const reads = h.reads.length;
  h.advance();
  await h.save();
  assert.equal(h.reads.length, reads);
  assertNoWrites(h);
});

test('preview escapa contenido HTML controlado por el operador', async () => {
  const h = harness({ values: { nombre_completo: '<img src=x onerror=alert(1)>', apellido_paterno: '<b>Pérez</b>' } });
  await h.check();
  assert.ok(h.api.state().checked, 'El texto de un nombre no se interpreta como HTML');
  const preview = h.preview();
  assert.doesNotMatch(preview, /<img\b|<b>Pérez<\/b>/i);
  assert.match(preview, /&lt;img/);
  assert.match(preview, /&lt;b&gt;Pérez/);
  assertNoWrites(h);
});

test('correo que aparece entre comprobar y guardar bloquea la transacción', async () => {
  const h = harness();
  await h.check();
  h.store.users.concurrent = { correo: 'persona@example.test', tokens: { race: 'intacto' } };
  const before = plain(h.store);
  h.advance();
  await h.save();
  assertNoWrites(h);
  assertUnchecked(h);
  assert.deepEqual(h.store, before);
  assertBoundedReads(h);
});

test('transacción aborta si otro proceso crea el UID después de las lecturas', async () => {
  const raced = { correo: 'otra@example.test', tokens: { device: 'NO-BORRAR' }, metrics: { reads: 81 } };
  const h = harness({ hooks: { beforeTransaction: (route, h) => { h.setPath(route, raced); } } });
  await h.check();
  h.advance();
  await h.save();
  assert.equal(h.transactions.length, 1);
  assert.equal(h.commits.length, 0);
  assert.deepEqual(h.store.users['AbC_Auth-UID9'], raced);
  assertUnchecked(h);
  assert.equal(h.api.state().busy, false);
  assertBoundedReads(h);
});

test('doble clic de comprobar comparte la exclusión busy y no duplica las lecturas', async () => {
  const entered = deferred();
  const release = deferred();
  const h = harness({ hooks: { onGet: async () => { entered.resolve(); await release.promise; } } });
  const first = h.check();
  await entered.promise;
  assert.equal(h.api.state().busy, true);
  assert.equal(h.ids.supportProfileCheckButton.disabled, true);
  assert.equal(h.ids.supportProfileSaveButton.disabled, true);
  const before = h.reads.length;
  await h.check();
  assert.equal(h.reads.length, before);
  release.resolve();
  await first;
  assert.ok(h.api.state().checked);
  assert.equal(h.api.state().busy, false);
  assert.equal(h.reads.length, 2);
  assertBoundedReads(h);
});

test('doble clic de guardar produce una sola transacción y un solo commit', async () => {
  const entered = deferred();
  const release = deferred();
  let pause = false;
  const h = harness({ hooks: { onGet: async () => { if (pause) { entered.resolve(); await release.promise; } } } });
  await h.check();
  pause = true;
  h.advance();
  const first = h.save();
  await entered.promise;
  assert.equal(h.api.state().busy, true);
  assert.equal(h.ids.supportProfileSaveButton.disabled, true);
  await h.save();
  release.resolve();
  await first;
  assert.equal(h.transactions.length, 1);
  assert.equal(h.commits.length, 1);
  assert.equal(h.api.state().busy, false);
  assertBoundedReads(h);
});

test('cambio de sesión durante comprobar invalida el resultado', async () => {
  let changed = false;
  const h = harness({ hooks: { onGet: (_request, h) => {
    if (!changed) { changed = true; h.auth.currentUser = { uid: 'different-session', email: 'soporte@fredinero.com' }; }
  } } });
  await h.check();
  assertUnchecked(h);
  assertNoWrites(h);
  assert.equal(h.api.state().busy, false);
});

test('cambio de autor durante lectura previa a guardar impide escribir aunque conserve correo de soporte', async () => {
  let swap = false;
  const h = harness({ hooks: { onGet: (_request, h) => {
    if (swap) h.auth.currentUser = { uid: 'other-support-session', email: 'soporte@fredinero.com' };
  } } });
  await h.check();
  swap = true;
  h.advance();
  await h.save();
  assertNoWrites(h);
  assertUnchecked(h);
  assert.equal(h.api.state().busy, false);
});

test('cambio del formulario durante guardar no publica una comprobación obsoleta', async () => {
  let edit = false;
  const h = harness({ hooks: { onGet: (_request, h) => {
    if (edit) h.ids.supportProfileName.value = 'Nombre cambiado durante lectura';
  } } });
  await h.check();
  edit = true;
  h.advance();
  await h.save();
  assertNoWrites(h);
  assertUnchecked(h);
});

test('pérdida de soporte entre comprobar y guardar no lee ni escribe', async () => {
  const h = harness();
  await h.check();
  h.auth.currentUser = { uid: 'not-support', email: 'otro@example.test' };
  const reads = h.reads.length;
  h.advance();
  await h.save();
  assert.equal(h.reads.length, reads);
  assertNoWrites(h);
});

test('errores de lectura se comunican, limpian busy y no autorizan guardar', async () => {
  const h = harness({ hooks: { onGet: () => { throw new Error('Fallo sintético de permisos'); } } });
  await h.check();
  assertNoWrites(h);
  assertUnchecked(h);
  assert.equal(h.api.state().busy, false);
  assert.equal(h.ids.supportProfileCheckButton.disabled, false);
  assert.match(h.status(), /fallo|permis|error|no se pudo/i);
});

test('fallo transaccional nunca confirma el alta y libera los botones', async () => {
  const h = harness({ hooks: { beforeTransaction: () => { throw new Error('Fallo sintético de transacción'); } } });
  await h.check();
  h.advance();
  await h.save();
  assert.equal(h.commits.length, 0);
  assert.equal(h.store.users['AbC_Auth-UID9'], undefined);
  assert.equal(h.api.state().busy, false);
  assert.equal(h.ids.supportProfileCheckButton.disabled, false);
  assert.match(h.status(), /fallo|transacci|error|no se pudo/i);
  assertBoundedReads(h);
});

test('cambios de campos o confirmación durante comprobar invalidan el resultado', async () => {
  for (const change of [
    h => { h.ids.supportProfilePlaza.value = 'OTRA PLAZA'; },
    h => { h.ids.supportProfileAuthConfirmed.checked = false; },
  ]) {
    const h = harness({ hooks: { onGet: (_request, h) => change(h) } });
    await h.check();
    assertUnchecked(h);
    assertNoWrites(h);
    assert.equal(h.api.state().busy, false);
  }
});

test('la transacción vuelve a comprobar al autor y aborta si cambia después de la última lectura', async () => {
  const h = harness({ hooks: { beforeTransaction: (_route, h) => {
    h.auth.currentUser = { uid: 'new-support-session', email: 'soporte@fredinero.com' };
  } } });
  await h.check();
  h.advance();
  await h.save();
  assert.equal(h.transactions.length, 1);
  assert.equal(h.commits.length, 0);
  assert.equal(h.store.users['AbC_Auth-UID9'], undefined);
  assertUnchecked(h);
  assertBoundedReads(h);
});

test('reintento inmediato tras error se limita aun si se comprueba otra vez', async () => {
  const h = harness({ hooks: { beforeTransaction: () => { throw new Error('Fallo sintético temporal'); } } });
  await h.check();
  await h.save();
  assert.equal(h.transactions.length, 1);
  await h.check();
  assert.ok(h.api.state().checked);
  const reads = h.reads.length;
  await h.save();
  assert.equal(h.transactions.length, 1);
  assert.equal(h.reads.length, reads, 'El límite local rechaza antes de hacer lecturas');
  assert.equal(h.commits.length, 0);
  assert.match(h.status(), /esper|moment|reintent|frecuen|rápid|rapid/i);
});

test('el resultado de comprobar advierte que no verifica Authentication', async () => {
  const h = harness();
  await h.check();
  assert.match(h.status(), /no verific.{0,30}Auth|Auth.{0,30}no.{0,20}verific/i);
  assertBoundedReads(h);
  assertNoWrites(h);
});
