'use strict';
// Sólo ejecutar con firebase emulators:exec --project demo-fredinero-notices.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createRequire } = require('node:module');
const sdkRequire = createRequire(process.env.PANEL_RULES_TEST_PACKAGE || '/tmp/fredinero-rules-validation/package.json');
const { initializeTestEnvironment, assertSucceeds, assertFails } = sdkRequire('@firebase/rules-unit-testing');
const { ref, set, get } = sdkRequire('firebase/database');
assert.ok(process.env.FIREBASE_DATABASE_EMULATOR_HOST === '127.0.0.1:9019', 'Exige emulador LOCAL explícito; no se ejecuta contra producción');
assert.ok(process.env.NOTICE_RULES_FILE, 'Exige las reglas congeladas entregadas');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
function realFunction(name) {
  const m = html.match(new RegExp(`^  (?:async )?function ${name}\\([^\\n]*\\) \\{(?:[^\\n]*\\}$|\\n[\\s\\S]*?^  \\})`, 'm')); assert.ok(m, name); return m[0];
}
const handler = html.match(/^  window\.saveSupportNoticeDirectory = async function\([^\n]*\) \{\n[\s\S]*?^  \};/m)[0];
const uid = '5dVKDIhQZlbzonMbSG9mX1pXHYg1';
let env, db;
test.before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-fredinero-notices', database: { host: '127.0.0.1', port: 9019, rules: fs.readFileSync(process.env.NOTICE_RULES_FILE, 'utf8') } });
  db = env.authenticatedContext(uid, { email: 'soporte@fredinero.com' }).database();
});
test.after(async () => { if (env) await env.cleanup(); });
function build(rows) {
  const context = vm.createContext({ TAMPICO_MADERO_MANAGER_EMAIL: 'gerente.tampico@fredinero.com', SUPPORT_NOTICE_FIELDS: ['correo','email','rol','role','plaza','nombre_completo','nombre','plazas_a_cargo','plazasACargo','managed_plazas','managedPlazas'], btoa: text => Buffer.from(text).toString('base64') });
  vm.runInContext(['normaliseActivityText','supportNoticeProfile','supportNoticeKey','supportNoticeLabel','managerProfilePlazas','buildSupportNoticeDirectory'].map(realFunction).join('\n')+'\nglobalThis.build=buildSupportNoticeDirectory;globalThis.project=supportNoticeProfile;', context);
  return context.build(rows.map(row => ({ uid: row.uid, profile: context.project(row.profile) })));
}
const person = (correo, extra={}) => ({ correo, rol:'GESTOR', plaza:'MADERO', nombre_completo:'Persona de prueba', ...extra });
const rows = [
  { uid: 'manager', profile: person('gerente.tampico@fredinero.com', { rol:'GERENTE', plaza:'TAMPICO', nombre_completo:'Gerencia compartida' }) },
  { uid: 'gestor', profile: person('cobranza.tampico@fredinero.com', { plaza:'TAMPICO' }) },
  { uid: 'admin', profile: person('admin@fredinero.com', { rol:'ADMINISTRATIVO', plaza:'' }) },
  { uid: 'technical', profile: { data_usage_metrics: { '2026-11-03': { count:1 } } } },
];
async function saveActual(report) {
  assert.equal(report.conflicts.length, 0);
  const operator = { uid, email:'soporte@fredinero.com' }, messages = [];
  const context = vm.createContext({ window:{}, auth:{currentUser:operator}, database:db, AbortController, ref, set,
    _supportNoticeBusy:false, _supportNoticeRun:1,
    _supportNoticePrepared:{projection:report.projection, count:report.valid, operator, run:1, at:Date.now()},
    supportWorkerIsAuthorized:()=>true, supportNoticeControls:()=>{}, confirm:()=>true,
    supportNoticeMessage:message=>messages.push(message), supportNoticeWait:async promise=>promise,
  });
  vm.runInContext(handler, context);
  await context.window.saveSupportNoticeDirectory();
  assert.match(messages.at(-1), /^Directorio protegido guardado/);
  assert.equal(context._supportNoticeBusy, false);
  return (await get(ref(db,'notice_directory'))).val();
}

test('builder+handler reales: set confirmado por emulador con cobertura Tampico–Madero y nodo técnico excluido', async () => {
  const report=build(rows), stored=await saveActual(report);
  assert.equal(report.technicalNodes,1); assert.equal(report.valid,3);
  assert.deepEqual(Object.keys(stored).sort(), ['by_uid','by_email','manager_coverage','managers_by_plaza'].sort());
  assert.equal(stored.by_uid.gestor.email, 'cobranza.tampico@fredinero.com');
  assert.equal(stored.by_uid.admin.plaza, '');
  assert.equal(stored.by_uid.gestor.managedPlazas, undefined, 'RTDB elimina arrays vacíos; no se exigen por las reglas');
  assert.equal(stored.by_uid.technical, undefined);
  assert.deepEqual(stored.manager_coverage.manager, { TAMPICO:true, MADERO:true });
  assert.equal(stored.managers_by_plaza.MADERO,'manager');
});

test('payload antiguo con version/updated_at es rechazado; corrección no relaja las reglas', async () => {
  const report=build(rows), plain=JSON.parse(JSON.stringify(report.projection));
  await assertFails(set(ref(db,'notice_directory'), {...plain, version:1, updated_at:123}));
  assert.equal((await get(ref(db,'notice_directory/version'))).exists(),false);
});

test('otro usuario, UID Soporte falso o correo Soporte falso no pueden guardar el directorio', async () => {
  const data=JSON.parse(JSON.stringify(build(rows).projection));
  for (const [actor,email] of [['other','other@fredinero.com'],['other','soporte@fredinero.com'],[uid,'other@fredinero.com']]) {
    await assertFails(set(ref(env.authenticatedContext(actor,{email}).database(),'notice_directory'),data));
  }
});

test('límites reales de correo100/nombre200 aceptados por builder, SDK y reglas sin truncar datos', async () => {
  const report=build([{uid:'max_valid',profile:person('x'.repeat(100)+'@fredinero.com',{nombre_completo:'N'.repeat(200)})}]);
  const stored=await saveActual(report);
  assert.equal(stored.by_uid.max_valid.email,'x'.repeat(100)+'@fredinero.com');
  assert.equal(stored.by_uid.max_valid.name.length,200);
});

test('nombres201, correo101, signo no admitido y UID no compatible se bloquean en revisión', () => {
  for(const row of [{uid:'bad',profile:person('a@fredinero.com',{nombre_completo:'N'.repeat(201)})},{uid:'bad',profile:person('x'.repeat(101)+'@fredinero.com')},{uid:'bad',profile:person('bad!email@fredinero.com')},{uid:'bad:uid',profile:person('a@fredinero.com')}]) {
    const result=build([row]); assert.equal(result.projection,null); assert.ok(result.conflicts.length);
  }
});
