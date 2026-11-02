'use strict';

// Ejecuta el código real del panel, no una copia de sus algoritmos. No carga
// scripts remotos, credenciales, DOM real ni SDK de Firebase.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const html = readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const plain = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

function realFunction(name) {
  const match = html.match(new RegExp(`^  (?:async )?function ${name}\\([^\\n]*\\) \\{(?:[^\\n]*\\}$|\\n[\\s\\S]*?^  \\})`, 'm'));
  assert.ok(match, `Función real no encontrada: ${name}`);
  return match[0];
}

function realWindowFunction(name) {
  const match = html.match(new RegExp(`^  window\\.${name} = (?:async )?function\\([^\\n]*\\) \\{[\\s\\S]*?^  \\};`, 'm'));
  assert.ok(match, `Acción real no encontrada: ${name}`);
  return match[0];
}

function realConstant(name) {
  const match = html.match(new RegExp(`^  const ${name} = [^\\n]+;`, 'm'));
  assert.ok(match, `Constante real no encontrada: ${name}`);
  return match[0];
}

function snapshot(value, key = '') {
  const data = plain(value);
  return {
    key,
    exists: () => data !== undefined && data !== null && (typeof data !== 'object' || Object.keys(data).length > 0),
    val: () => plain(data),
    forEach: callback => Object.entries(data || {}).forEach(([id, item]) => callback(snapshot(item, id))),
  };
}

function harness({ records = {}, users = {}, initial = {}, tamper, support = true, confirm = true, failWrite = 0 } = {}) {
  const store = { gestor_activities: plain(records), users: plain(users), ...plain(initial) };
  const writes = [];
  const reads = [];
  const alerts = [];
  const button = { disabled: false, textContent: 'Reconstruir Prospección' };
  const state = { detail: null, fullRecords: [], filtered: [] };
  const readPath = route => route.split('/').filter(Boolean).reduce((node, key) => node?.[key], store);
  function writePath(route, value) {
    const parts = route.split('/');
    const last = parts.pop();
    let node = store;
    parts.forEach(key => { node = node[key] ||= {}; });
    if (value === null || (typeof value === 'object' && !Object.keys(value).length)) delete node[last];
    else node[last] = plain(value);
  }
  const context = vm.createContext({
    window: {},
    database: {},
    auth: { currentUser: { email: 'support@example.test' } },
    document: { querySelectorAll: () => [button], getElementById: () => ({ value: '2026-01-01' }) },
    privacyIsSupport: () => support,
    activityCanManageAll: () => true,
    alert: message => alerts.push(message),
    confirm: () => confirm,
    recordPanelDataUsage: () => {},
    ref: (_database, route = '') => route,
    orderByChild: field => ({ type: 'orderByChild', field }),
    equalTo: value => ({ type: 'equalTo', value }),
    query: (route, ...constraints) => ({ route, constraints }),
    get: async request => {
      const route = typeof request === 'string' ? request : request.route;
      reads.push(plain(request));
      let value = plain(readPath(route));
      if (request?.constraints) {
        const order = request.constraints.find(item => item.type === 'orderByChild');
        const equal = request.constraints.find(item => item.type === 'equalTo');
        value = Object.fromEntries(Object.entries(value || {}).filter(([, record]) => record?.[order.field] === equal.value));
      }
      if (tamper) value = tamper(route, value, writes);
      return snapshot(value);
    },
    update: async (route, changes) => {
      assert.equal(route, '', 'Sólo actualizaciones multipath de prueba');
      writes.push(plain(changes));
      if (failWrite === writes.length) throw new Error('Fallo sintético de escritura');
      Object.entries(changes).forEach(([key, value]) => writePath(key, value));
    },
    loadFullActivityRecord: async preview => state.detail || preview,
    loadFullActivityRecords: async () => state.fullRecords,
  });
  const start = html.indexOf('  function prospectCounterKey(value) {');
  const end = html.indexOf('  window.rebuildActivitySummaries =', start);
  assert.ok(start >= 0 && end > start);
  const exports = [
    'projectProspectRecord', 'prospectVerificationEmail', 'pendingProspectVerifications',
    'pendingProspectVerifierIds', 'pendingProspectVerifierEmailKeys', 'prospectLeaderEmailKey',
    'canonicalProspectStage', 'prospectWorkflowStage', 'prospectVerificationVisible', 'isActiveProspectRecord',
    'flushActivitySummaryBatch', 'activitySummaryDeletionChanges', 'deleteActivityRecordAndIndexes',
  ];
  const code = [
    html.slice(start, end),
    realConstant('PROSPECT_FINAL_STAGES'),
    realConstant('PROSPECT_VERIFICATION_STAGES'),
    realConstant('FIREBASE_PUSH_ID_CHARS'),
    ...['normaliseActivityText', 'prospectWorkflowStage', 'prospectVerificationVisible', 'firebasePushIdTimestamp', 'activityCreatedTimestamp', 'isStoredActivityRecord'].map(realFunction),
    realFunction('activitySummaryDeletionChanges'),
    realFunction('deleteActivityRecordAndIndexes'),
    realWindowFunction('rebuildActiveProspectCounters'),
    realWindowFunction('deleteActivitiesByRange'),
    'let _activitiesFiltered = [];',
    'window.searchActivities = async () => {};',
    `globalThis.api = { ${exports.join(', ')}, setFiltered: value => { _activitiesFiltered = value; } };`,
  ].join('\n\n');
  vm.runInContext(code, context, { filename: 'index.html:real-prospect-helpers' });
  return { api: context.api, window: context.window, store, readPath, writes, reads, alerts, button, state };
}

function user(authUid = 'verifier-current', correo = 'verifier@example.test', extra = {}) {
  return { authUid, profileUid: 'profile-old', correo, nombre: 'Same Name', plaza: 'NORTE', rol: 'GESTOR', ...extra };
}

function profile(directoryUser) {
  return { uid: directoryUser.profileUid, correo: directoryUser.correo, nombre: directoryUser.nombre, plaza: directoryUser.plaza, rol: directoryUser.rol };
}

function prospect(id = 'case-1', extra = {}) {
  return {
    id, tipo: 'PROSPECCION', es_expediente_prospeccion: true, nombre_prospecto: 'Synthetic prospect',
    user_uid: 'creator', lider_asignado_uid: 'leader', lider_asignado_correo: 'leader@example.test',
    plaza: 'NORTE', estado_expediente: 'PENDIENTE_VERIFICACION', timestamp: 1780000000000,
    verificacion_domiciliaria: { requerida: true, estado: 'PENDIENTE', asignado_uid: 'auth-deleted', asignado_correo: ' Verifier@Example.Test ' },
    ...extra,
  };
}

function project(verification, users = [user()]) {
  const { api } = harness();
  const record = prospect('case-1', { verificacion_domiciliaria: verification });
  const before = structuredClone(record);
  const result = plain(api.projectProspectRecord(record, users).record.verificacion_domiciliaria);
  assert.deepEqual(record, before, 'La proyección no modifica el expediente original');
  return result;
}

test('correo explícito normalizado y único tiene prioridad sobre UID antiguo o perteneciente a otra persona', () => {
  for (const field of ['asignado_email', 'asignado_correo']) {
    for (const uid of ['auth-deleted', 'other-current', '', undefined]) {
      const result = project({ asignado_uid: uid, [field]: '  VeRiFiEr@Example.Test  ', requerida: true }, [user(), user('other-current', 'other@example.test', { profileUid: 'other-profile' })]);
      assert.equal(result.asignado_uid, 'verifier-current');
      assert.equal(result.asignado_email, 'verifier@example.test');
    }
  }
});

test('coincidencia exacta de correo, no por encoding, nombres ni plaza', () => {
  const verification = { asignado_uid: 'missing', asignado_email: 'a.b@example.test', asignado_nombre: 'Same Name', plaza: 'NORTE' };
  const result = project(verification, [user('wrong', 'a+b@example.test')]);
  assert.equal(result.asignado_uid, 'missing');
  assert.equal(result.asignado_email, 'a.b@example.test');
  const withoutIdentity = project({ asignado_nombre: 'Same Name', plaza: 'NORTE' });
  assert.equal(withoutIdentity.asignado_uid, undefined);
  assert.equal(withoutIdentity.asignado_email, undefined);
});

test('sin correo explícito resuelve Auth UID vigente antes de profileUid, y completa email inequívoco', () => {
  assert.equal(project({ asignado_uid: 'profile-old' }).asignado_uid, 'verifier-current');
  assert.equal(project({ asignado_uid: 'verifier-current' }).asignado_email, 'verifier@example.test');
  const result = project({ asignado_uid: 'verifier-current' }, [user('alias-owner', 'alias@example.test', { profileUid: 'verifier-current' }), user()]);
  assert.equal(result.asignado_uid, 'verifier-current');
  assert.equal(result.asignado_email, 'verifier@example.test');
});

test('UID no localizado se conserva con correo, sin inventar identidad; valores no objeto se conservan', () => {
  assert.deepEqual(project({ asignado_uid: 'missing', asignado_correo: 'Unknown@Example.Test' }), {
    asignado_uid: 'missing', asignado_correo: 'Unknown@Example.Test', asignado_email: 'unknown@example.test',
  });
  assert.deepEqual(project({ asignado_uid: 'missing' }), { asignado_uid: 'missing' });
  for (const value of [undefined, null, false, 'legacy']) assert.equal(project(value), value);
});

test('UID localizado con correo en conflicto no recibe la tarea ni sobrescribe correo explícito', () => {
  const result = project({ asignado_uid: 'profile-old', asignado_correo: 'external@example.test' });
  assert.equal(result.asignado_uid, '');
  assert.equal(result.asignado_email, 'external@example.test');
});

test('correos duplicados del directorio no eligen la primera persona; UID exacto sin conflicto permite resolver', () => {
  const users = [user(), user('duplicate', 'verifier@example.test', { profileUid: 'duplicate-profile' })];
  assert.equal(project({ asignado_uid: 'missing', asignado_email: 'verifier@example.test' }, users).asignado_uid, 'missing');
  assert.equal(project({ asignado_email: 'verifier@example.test' }, users).asignado_uid, undefined);
  assert.equal(project({ asignado_uid: 'duplicate-profile', asignado_email: 'verifier@example.test' }, users).asignado_uid, 'duplicate');
});

test('alias de correo incompatibles no acreditan UID ni ruta de correo; alias iguales normalizados sí', () => {
  const { api } = harness();
  const result = project({ asignado_uid: 'verifier-current', asignado_email: 'verifier@example.test', asignado_correo: 'other@example.test' });
  assert.equal(result.asignado_uid, '');
  assert.deepEqual(plain(api.pendingProspectVerifierEmailKeys(prospect('case-1', { verificacion_domiciliaria: result }))), []);
  assert.equal(project({ asignado_correo: ' VERIFIER@example.test ', asignado_email: 'Verifier@Example.Test' }).asignado_uid, 'verifier-current');
});

test('sólo PENDIENTE_VERIFICACION y VERIFICACION_PARCIAL generan tareas UID/correo', () => {
  const { api } = harness();
  for (const stage of ['PENDIENTE_VERIFICACION', 'VERIFICACION_PARCIAL', ' pendiente_verificacion ']) {
    const record = prospect('case-1', { estado_expediente: stage });
    assert.deepEqual(plain(api.pendingProspectVerifierIds(record)), ['auth-deleted']);
    assert.deepEqual(plain(api.pendingProspectVerifierEmailKeys(record)), ['verifier_example_test']);
  }
  for (const stage of ['CITA_PROGRAMADA', 'PENDIENTE_RAFIK', 'PENDIENTE_ASIGNACION_GERENTE', 'PENDIENTE_VOBO_GERENTE', 'PENDIENTE_REVISION_CREDITO_RIESGO', 'DEVUELTA_A_GERENTE', 'AUTORIZADA', 'PENDIENTE_ACTIVACION', 'ALTA', 'CANCELADA', 'RECHAZADA_CREDITO_RIESGO', 'NO_ASISTIO', undefined]) {
    const record = prospect('case-1', { estado_expediente: stage });
    assert.deepEqual(plain(api.pendingProspectVerifierIds(record)), [], stage);
    assert.deepEqual(plain(api.pendingProspectVerifierEmailKeys(record)), [], stage);
  }
  for (const extra of [{ tipo: 'COBRANZA' }, { es_expediente_prospeccion: false }]) {
    assert.deepEqual(plain(api.pendingProspectVerifierIds(prospect('case-1', extra))), []);
    assert.deepEqual(plain(api.pendingProspectVerifierEmailKeys(prospect('case-1', extra))), []);
  }
});

test('alias históricos de verificación pendiente/parcial proyectan la misma etapa, visibilidad y rutas UID/correo', async () => {
  const stages = [
    ['PENDIENTE_VERIFICACION', ['Verificación', 'Pendiente de verificación', 'Pendiente verificación', '  PENDIENTE DE VERIFICACIÓN  ']],
    ['VERIFICACION_PARCIAL', ['Verificación parcial', 'Verificacion parcial', '  VERIFICACIÓN PARCIAL  ']],
  ];
  for (const kind of ['verificacion_domiciliaria', 'verificacion_comercial']) {
    for (const emailField of ['asignado_email', 'asignado_correo']) {
      for (const [canonical, aliases] of stages) {
        const sourceFor = stage => prospect('case-1', {
          estado_expediente: stage,
          verificacion_domiciliaria: { requerida: false },
          verificacion_comercial: { requerida: false },
          [kind]: { requerida: true, estado: ' pendiente ', asignado_uid: 'auth-deleted', [emailField]: ' VeRiFiEr@Example.Test ' },
        });
        const baseline = harness();
        await baseline.api.flushActivitySummaryBatch([sourceFor(canonical)], [user()]);
        for (const stage of [canonical, ...aliases]) {
          const source = sourceFor(stage);
          const before = plain(source);
          const h = harness({ records: { 'case-1': source } });
          assert.equal(h.api.canonicalProspectStage(source), canonical, stage);
          const projected = h.api.projectProspectRecord(source, [user()]).record;
          assert.equal(projected.estado_expediente, canonical, stage);
          assert.equal(h.api.prospectWorkflowStage(projected), canonical, stage);
          assert.equal(h.api.isActiveProspectRecord(projected), true, stage);
          assert.equal(h.api.prospectVerificationVisible(projected), true, stage);
          assert.deepEqual(plain(h.api.pendingProspectVerifierIds(projected)), ['verifier-current'], stage);
          assert.deepEqual(plain(h.api.pendingProspectVerifierEmailKeys(projected)), ['verifier_example_test'], stage);
          await h.api.flushActivitySummaryBatch([source], [user()]);
          const writes = h.writes[0];
          assert.deepEqual(Object.keys(writes).sort(), Object.keys(baseline.writes[0]).sort(), `Rutas idénticas: ${stage}`);
          const uidRoute = 'activity_summaries/active_prospects_by_verifier/verifier-current/case-1';
          const emailRoute = 'activity_summaries/active_prospects_by_verifier_email/verifier_example_test/case-1';
          assert.deepEqual(writes[uidRoute], writes[emailRoute], `Misma ficha UID/correo: ${stage}`);
          assert.equal(writes[uidRoute].estado_expediente, canonical, stage);
          assert.equal(writes[uidRoute][kind].asignado_email, 'verifier@example.test', stage);
          assert.equal(writes['activity_summaries/active_prospects_by_verifier/auth-deleted/case-1'], null, stage);
          assert.equal(writes['activity_summaries/rejected_prospects/users/creator/case-1'], null, stage);
          assert.deepEqual(source, before, 'Etiqueta e identidad originales intactas');
          assert.deepEqual(h.store.gestor_activities, { 'case-1': before });
          assert.ok(Object.keys(writes).every(route => route.startsWith('activity_summaries/')));
          assert.equal(h.reads.length, 0, 'Proyección sin lecturas remotas');
        }
      }
    }
  }
});

test('VERIFICACION_PARCIAL permite mostrar datos; la visibilidad histórica no convierte cierres en tareas', () => {
  const { api } = harness();
  for (const stage of ['PENDIENTE_VERIFICACION', 'VERIFICACION_PARCIAL', 'ALTA', 'NO_ASISTIO', 'RECHAZADA_CREDITO_RIESGO']) {
    const record = prospect('case-1', { estado_expediente: stage });
    assert.equal(api.prospectVerificationVisible(record), true, stage);
    if (['ALTA', 'NO_ASISTIO', 'RECHAZADA_CREDITO_RIESGO'].includes(stage)) {
      assert.deepEqual(plain(api.pendingProspectVerifierIds(record)), [], stage);
      assert.deepEqual(plain(api.pendingProspectVerifierEmailKeys(record)), [], stage);
    }
  }
  assert.equal(api.prospectVerificationVisible(prospect('case-1', { estado_expediente: 'PENDIENTE_RAFIK' })), false);
});

test('finales, otras etapas y etiquetas desconocidas no generan tareas aunque ambos verificadores estén asignados', async () => {
  const finals = ['ALTA', 'NO_ASISTIO', 'RECHAZADA_POR_PROSPECTO', 'RECHAZADA_CREDITO_RIESGO', 'CANCELADA'];
  const otherStages = [
    'CITA_PROGRAMADA', 'PENDIENTE_RAFIK', 'PENDIENTE_CIRCULO_CREDITO', 'PENDIENTE_DOCUMENTACION',
    'PENDIENTE_ONBOARDING', 'PENDIENTE_ASIGNACION_GERENTE', 'PENDIENTE_VOBO_GERENTE',
    'PENDIENTE_REVISION_CREDITO_RIESGO', 'DEVUELTA_A_GERENTE', 'AUTORIZADA', 'PENDIENTE_ACTIVACION',
    'Rechazada por prospecto', 'Rechazada por Crédito y Riesgo', 'Verificación inventada', undefined,
  ];
  for (const stage of [...finals, ...otherStages]) {
    const assigned = { requerida: true, estado: 'PENDIENTE', asignado_uid: 'auth-deleted', asignado_correo: 'verifier@example.test', asignado_nombre: 'Same Name', plaza: 'NORTE' };
    const source = prospect('case-1', { estado_expediente: stage, verificacion_domiciliaria: assigned, verificacion_comercial: { ...assigned } });
    const before = structuredClone(source);
    const h = harness({ records: { 'case-1': source } });
    const projected = h.api.projectProspectRecord(source, [user()]).record;
    if (finals.includes(stage)) assert.equal(h.api.isActiveProspectRecord(projected), false, stage);
    if (stage === 'Verificación inventada' || stage === undefined) assert.equal(projected.estado_expediente, 'RECHAZADA_POR_PROSPECTO', 'No se infiere etapa desde nombre, plaza ni asignación');
    assert.deepEqual(plain(h.api.pendingProspectVerifications(projected)), [], stage);
    assert.deepEqual(plain(h.api.pendingProspectVerifierIds(projected)), [], stage);
    assert.deepEqual(plain(h.api.pendingProspectVerifierEmailKeys(projected)), [], stage);
    await h.api.flushActivitySummaryBatch([source], [user()]);
    const writes = h.writes[0];
    for (const route of [
      'activity_summaries/active_prospects_by_verifier/auth-deleted/case-1',
      'activity_summaries/active_prospects_by_verifier/verifier-current/case-1',
      'activity_summaries/active_prospects_by_verifier_email/verifier_example_test/case-1',
    ]) assert.equal(writes[route], null, `${stage}: ${route}`);
    assert.deepEqual(source, before);
    assert.deepEqual(h.store.gestor_activities, { 'case-1': plain(before) });
    assert.ok(Object.keys(writes).every(route => route.startsWith('activity_summaries/')));
  }
});

test('flags de requerida y estados finales normalizados se aplican idénticos a UID/correo', () => {
  const { api } = harness();
  for (const kind of ['verificacion_domiciliaria', 'verificacion_comercial']) {
    for (const required of [undefined, false, true, 'true']) {
      for (const status of ['', ' pendiente ', ' no_asignada ', ' asignada ', ' por_realizar ', ' completa ', ' no_requerida ', ' cancelada ']) {
        const record = prospect('case-1', {
          verificacion_domiciliaria: { requerida: false },
          verificacion_comercial: { requerida: false },
          [kind]: { requerida: required, estado: status, asignado_uid: 'assigned', asignado_email: 'A@Example.Test' },
        });
        const pending = (kind === 'verificacion_domiciliaria' ? required !== false : required === true)
          && !['COMPLETA', 'NO_REQUERIDA', 'CANCELADA'].includes(status.trim().toUpperCase());
        assert.deepEqual(plain(api.pendingProspectVerifierIds(record)), pending ? ['assigned'] : []);
        assert.deepEqual(plain(api.pendingProspectVerifierEmailKeys(record)), pending ? ['a_example_test'] : []);
      }
    }
  }
});

test('deduplica expediente/verificador y comparte exactamente el encoding de correo del Líder', () => {
  const { api } = harness();
  const verification = { requerida: true, estado: 'PENDIENTE', asignado_uid: 'assigned', asignado_correo: ' Á.B+One@Example.Test ' };
  const record = prospect('case-1', { verificacion_domiciliaria: verification, verificacion_comercial: { ...verification, asignado_email: 'á.b+one@example.test' } });
  assert.deepEqual(plain(api.pendingProspectVerifierIds(record)), ['assigned']);
  assert.deepEqual(plain(api.pendingProspectVerifierEmailKeys(record)), [api.prospectLeaderEmailKey(verification.asignado_correo)]);
});

test('flush escribe rutas ligeras por UID actual y correo, elimina UID anterior y no toca originales', async () => {
  const h = harness();
  const source = prospect();
  const before = plain(source);
  const result = await h.api.flushActivitySummaryBatch([source], [user()]);
  assert.equal(result.written, 1);
  assert.equal(h.writes.length, 1);
  const writes = h.writes[0];
  assert.equal(writes['activity_summaries/active_prospects_by_verifier/verifier-current/case-1'].verificacion_domiciliaria.asignado_email, 'verifier@example.test');
  assert.equal(writes['activity_summaries/active_prospects_by_verifier_email/verifier_example_test/case-1'].id, 'case-1');
  assert.equal(writes['activity_summaries/active_prospects_by_verifier/auth-deleted/case-1'], null);
  assert.deepEqual(source, before);
  assert.ok(Object.keys(writes).every(route => route.startsWith('activity_summaries/')));
  assert.equal(h.reads.length, 0, 'No añade lecturas ni scans al escribir');
});

test('flush retira rutas UID/correo conocidas cuando la tarea ya está cerrada o fuera de etapa', async () => {
  for (const extra of [{ estado_expediente: 'PENDIENTE_VOBO_GERENTE' }, { verificacion_domiciliaria: { requerida: true, estado: ' cancelada ', asignado_uid: 'auth-deleted', asignado_email: 'verifier@example.test' } }]) {
    const h = harness();
    await h.api.flushActivitySummaryBatch([prospect('case-1', extra)], [user()]);
    const writes = h.writes[0];
    assert.equal(writes['activity_summaries/active_prospects_by_verifier/auth-deleted/case-1'], null);
    assert.equal(writes['activity_summaries/active_prospects_by_verifier/verifier-current/case-1'], null);
    assert.equal(writes['activity_summaries/active_prospects_by_verifier_email/verifier_example_test/case-1'], null);
  }
});

test('flush limpia ambos alias de correo contradictorios sin publicar una asignación adivinada', async () => {
  const h = harness();
  await h.api.flushActivitySummaryBatch([prospect('case-1', {
    verificacion_domiciliaria: { requerida: true, estado: 'PENDIENTE', asignado_uid: 'verifier-current', asignado_email: 'verifier@example.test', asignado_correo: 'other@example.test' },
  })], [user()]);
  const writes = h.writes[0];
  assert.equal(writes['activity_summaries/active_prospects_by_verifier/verifier-current/case-1'], null);
  assert.equal(writes['activity_summaries/active_prospects_by_verifier_email/verifier_example_test/case-1'], null);
  assert.equal(writes['activity_summaries/active_prospects_by_verifier_email/other_example_test/case-1'], null);
});

test('borrado limpia correo de Líder y ambos alias de verificador aun fuera de etapa y completados', () => {
  const { api } = harness();
  const record = prospect('case-1', {
    estado_expediente: 'ALTA',
    verificacion_domiciliaria: { requerida: false, estado: 'COMPLETA', asignado_uid: 'assigned', asignado_email: 'A@Example.Test', asignado_correo: 'B@Example.Test' },
    verificacion_comercial: { requerida: false, estado: 'NO_REQUERIDA', asignado_correo: 'C@Example.Test' },
  });
  const changes = plain(api.activitySummaryDeletionChanges(record));
  for (const key of ['a_example_test', 'b_example_test', 'c_example_test']) assert.equal(changes[`activity_summaries/active_prospects_by_verifier_email/${key}/case-1`], null);
  assert.equal(changes['activity_summaries/active_prospects_by_verifier/assigned/case-1'], null);
  assert.equal(changes['activity_summaries/active_prospects_by_leader_email/leader_example_test/case-1'], null);
  assert.equal(changes['activity_summaries/prospect_pages/by_leader_email/leader_example_test/ALTAS/case-1'], null);
  assert.deepEqual(plain(api.activitySummaryDeletionChanges({})), {});
  assert.ok(Object.keys(changes).every(route => route.startsWith('activity_summaries/')));
});

test('borrado individual y por rango une rutas de ficha proyectada con expediente canónico', async () => {
  for (const bulk of [false, true]) {
    const h = harness();
    const source = prospect();
    const preview = plain(h.api.projectProspectRecord(source, [user()]).record);
    h.state.detail = source;
    h.state.fullRecords = [source];
    if (bulk) {
      h.api.setFiltered([preview]);
      await h.window.deleteActivitiesByRange();
    } else await h.api.deleteActivityRecordAndIndexes(preview);
    assert.equal(h.writes.length, 1);
    const changes = h.writes[0];
    assert.equal(changes['activity_summaries/active_prospects_by_verifier/verifier-current/case-1'], null);
    assert.equal(changes['activity_summaries/active_prospects_by_verifier/auth-deleted/case-1'], null);
    assert.equal(changes['activity_summaries/active_prospects_by_verifier_email/verifier_example_test/case-1'], null);
    assert.equal(changes['gestor_activities/case-1'], null);
    assert.equal(changes['gestor_photos/case-1'], null);
  }
});

function rebuildFixture(options = {}) {
  const first = prospect('case-1');
  first.verificacion_comercial = { ...first.verificacion_domiciliaria, requerida: true };
  const records = {
    'case-1': first,
    'case-2': prospect('case-2', { estado_expediente: 'VERIFICACION_PARCIAL' }),
    'case-closed': prospect('case-closed', { estado_expediente: 'ALTA' }),
    'case-complete': prospect('case-complete', { verificacion_domiciliaria: { requerida: true, estado: ' COMPLETA ', asignado_uid: 'no-longer-in-directory', asignado_email: 'inactive@example.test' } }),
    'case-followup': prospect('case-followup', { es_expediente_prospeccion: false, seguimiento_de: 'case-1' }),
    'not-prospect': { id: 'not-prospect', tipo: 'GENERAL', gestion_realizada: 'LLAMADA' },
  };
  const users = {
    'verifier-current': profile(user()),
    idle: profile(user('idle', 'idle@example.test', { profileUid: 'idle-previous', rol: 'OTRO' })),
    leader: profile(user('leader', 'leader@example.test', { profileUid: 'leader-profile', rol: 'LIDER' })),
  };
  const old = { stale: { id: 'stale' } };
  const initial = {
    activity_summaries: {
      active_prospects_by_verifier: { idle: old, 'idle-previous': old, 'auth-deleted': old, 'profile-old': old, 'no-longer-in-directory': old },
      active_prospects_by_verifier_email: { idle_example_test: old, verifier_example_test: old, inactive_example_test: old },
    },
  };
  return { ...harness({ records, users, initial, ...options }), originals: plain(records) };
}

test('reconstrucción real conserva etiquetas históricas y publica los mismos IDs y contadores activos por UID/correo', async () => {
  const active = ['Pendiente de verificación', 'Pendiente verificación', 'Verificación parcial'];
  const records = Object.fromEntries(active.map((stage, index) => {
    const id = `alias-${index}`;
    return [id, prospect(id, { estado_expediente: stage })];
  }));
  records.closed = prospect('closed', { estado_expediente: 'ALTA' });
  records.other = prospect('other', { estado_expediente: 'PENDIENTE_RAFIK' });
  records.complete = prospect('complete', {
    estado_expediente: 'Verificación parcial',
    verificacion_domiciliaria: { requerida: true, estado: ' completa ', asignado_uid: 'auth-deleted', asignado_email: 'verifier@example.test' },
  });
  const h = rebuildFixture({ records });
  const before = plain(records);
  await h.window.rebuildActiveProspectCounters();
  assert.match(h.alerts.at(-1), /reconstruida y verificada/);
  const expectedIds = active.map((_, index) => `alias-${index}`);
  const uidEntries = h.readPath('activity_summaries/active_prospects_by_verifier/verifier-current');
  const emailEntries = h.readPath('activity_summaries/active_prospects_by_verifier_email/verifier_example_test');
  assert.deepEqual(Object.keys(uidEntries).sort(), expectedIds);
  assert.deepEqual(Object.keys(emailEntries).sort(), expectedIds);
  for (const id of expectedIds) assert.equal(uidEntries[id].estado_expediente, emailEntries[id].estado_expediente);
  assert.equal(emailEntries['alias-2'].estado_expediente, 'VERIFICACION_PARCIAL');
  const counters = h.readPath('app_config/prospect_active_counters');
  assert.deepEqual(counters.por_verificador, { 'verifier-current': active.length });
  assert.deepEqual(counters.por_verificador_email, { verifier_example_test: active.length });
  assert.deepEqual(h.store.gestor_activities, before);
  assert.deepEqual(records, before);
  assert.ok(h.writes.every(batch => Object.keys(batch).every(route => !route.startsWith('gestor_activities') && !route.startsWith('users'))));
});

test('reconstrucción publica contadores únicos por expediente/correo y reemplaza listas conocidas incluidas vacías', async () => {
  const h = rebuildFixture();
  await h.window.rebuildActiveProspectCounters();
  assert.match(h.alerts.at(-1), /reconstruida y verificada/);
  const counters = h.readPath('app_config/prospect_active_counters');
  assert.deepEqual(counters.por_verificador_email, { verifier_example_test: 2 });
  assert.deepEqual(counters.por_verificador, { 'verifier-current': 2 });
  assert.equal(counters.total, 3, 'Otro expediente activo sin tarea no cuenta como verificación');
  assert.deepEqual(Object.keys(h.readPath('activity_summaries/active_prospects_by_verifier_email/verifier_example_test')).sort(), ['case-1', 'case-2']);
  assert.deepEqual(Object.keys(h.readPath('activity_summaries/active_prospects_by_verifier/verifier-current')).sort(), ['case-1', 'case-2']);
  for (const uid of ['idle', 'idle-previous', 'auth-deleted', 'profile-old', 'no-longer-in-directory']) assert.equal(h.readPath(`activity_summaries/active_prospects_by_verifier/${uid}`), undefined, uid);
  for (const key of ['idle_example_test', 'inactive_example_test']) assert.equal(h.readPath(`activity_summaries/active_prospects_by_verifier_email/${key}`), undefined, key);
  assert.deepEqual(h.store.gestor_activities, h.originals, 'Expedientes originales intactos');
  assert.ok(h.writes.every(batch => Object.keys(batch).every(route => !route.startsWith('gestor_activities') && !route.startsWith('users'))));
  assert.ok(h.writes[0]['activity_summaries/active_prospects_by_verifier_email/verifier_example_test/case-1'], 'Fichas publicadas antes de sustituciones');
  const canonicalRead = h.reads.find(request => typeof request === 'object' && request.route === 'gestor_activities');
  assert.deepEqual(canonicalRead.constraints, [{ type: 'orderByChild', field: 'tipo' }, { type: 'equalTo', value: 'PROSPECCION' }]);
  assert.equal(h.reads.filter(request => request === 'users').length, 1);
  assert.ok(h.reads.every(request => typeof request === 'object' || request === 'users' || /^activity_summaries\/active_prospects_by_(?:leader|leader_email|verifier|verifier_email)\/[^/]+$/.test(request)), 'Sin scans nuevos ni lecturas completas de índices');
  assert.equal(h.button.disabled, false);
});

test('reconstrucción verifica conjunto exacto de IDs por correo: detecta faltantes, extras y sustituciones del mismo tamaño', async () => {
  for (const mode of ['missing', 'extra', 'same-size', 'nonempty-idle', 'uid-extra']) {
    const h = rebuildFixture({ tamper: (route, value) => {
      if (route === 'activity_summaries/active_prospects_by_verifier_email/verifier_example_test') {
        if (mode === 'missing') delete value['case-1'];
        if (mode === 'extra') value.extra = { id: 'extra' };
        if (mode === 'same-size') { delete value['case-1']; value.extra = { id: 'extra' }; }
      }
      if (mode === 'nonempty-idle' && route === 'activity_summaries/active_prospects_by_verifier_email/idle_example_test') return { stale: { id: 'stale' } };
      if (mode === 'uid-extra' && route === 'activity_summaries/active_prospects_by_verifier/verifier-current') value.extra = { id: 'extra' };
      return value;
    } });
    await h.window.rebuildActiveProspectCounters();
    assert.match(h.alerts.at(-1), /no coincide/, mode);
    assert.equal(h.readPath('app_config/prospect_active_counters'), undefined, 'No publica contadores tras comprobación fallida');
    assert.deepEqual(h.store.gestor_activities, h.originals);
    assert.equal(h.button.disabled, false);
  }
});

test('reconstrucción sin permiso, cancelada o sin raíces no escribe y fallo de primer lote no vacía listas anteriores', async () => {
  for (const options of [{ support: false }, { confirm: false }, { records: {} }]) {
    const h = rebuildFixture(options);
    await h.window.rebuildActiveProspectCounters();
    assert.equal(h.writes.length, 0);
  }
  const h = rebuildFixture({ failWrite: 1 });
  await h.window.rebuildActiveProspectCounters();
  assert.match(h.alerts.at(-1), /Fallo sintético/);
  assert.deepEqual(h.readPath('activity_summaries/active_prospects_by_verifier_email/verifier_example_test'), { stale: { id: 'stale' } });
  assert.deepEqual(h.store.gestor_activities, h.originals);
  assert.equal(h.button.disabled, false);
});
