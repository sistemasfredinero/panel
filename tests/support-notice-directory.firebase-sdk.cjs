'use strict';
// Ejecutar: PANEL_FIREBASE_NODE_MODULES=/ruta/node_modules node --test tests/support-notice-directory.firebase-sdk.cjs
// Usa SDK real, base demo en localhost y goOffline ANTES de cualquier set.
// Comprueba validación/encolado local, NO una confirmación del servidor.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sdkPath = process.env.PANEL_FIREBASE_NODE_MODULES;
if (!sdkPath) throw new Error('Configura PANEL_FIREBASE_NODE_MODULES; nunca uses este test para acceso productivo.');
const appSDK = require(path.join(sdkPath, 'firebase/app'));
const dbSDK = require(path.join(sdkPath, 'firebase/database'));
const version = require(path.join(sdkPath, 'firebase/package.json')).version;
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
function realFunction(name) {
  const match = html.match(new RegExp(`^  function ${name}\\([^\\n]*\\) \\{(?:[^\\n]*\\}$|\\n[\\s\\S]*?^  \\})`, 'm'));
  assert.ok(match, name); return match[0];
}
function handler() {
  const match = html.match(/^  window\.saveSupportNoticeDirectory = async function\([^\n]*\) \{\n[\s\S]*?^  \};/m);
  assert.ok(match); return match[0];
}
const app = appSDK.initializeApp({ projectId: 'demo-directory-sdk', databaseURL: 'http://127.0.0.1:9998?ns=demo-directory-sdk' }, 'directory-sdk-'+Date.now());
const db = dbSDK.getDatabase(app);
dbSDK.connectDatabaseEmulator(db, '127.0.0.1', 9998);
dbSDK.goOffline(db);
test.after(async () => { dbSDK.goOffline(db); await appSDK.deleteApp(app); });

function projection() {
  const maps = () => Object.create(null);
  const by_uid = maps(), by_email = maps(), manager_coverage = maps(), managers_by_plaza = maps();
  by_uid.gestor = { uid: 'gestor', email: 'gestor@fredinero.com', role: 'GESTOR', plaza: 'TAMPICO', name: 'Gestor sintético', managedPlazas: [] };
  by_uid.manager = { uid: 'manager', email: 'manager@fredinero.com', role: 'GERENTE', plaza: 'TAMPICO', name: 'Gerente sintético', managedPlazas: ['TAMPICO','MADERO'] };
  by_email[Buffer.from('gestor@fredinero.com').toString('base64url')] = 'gestor';
  by_email[Buffer.from('manager@fredinero.com').toString('base64url')] = 'manager';
  manager_coverage.manager = { TAMPICO: true, MADERO: true };
  managers_by_plaza.TAMPICO = 'manager'; managers_by_plaza.MADERO = 'manager';
  return { by_uid, by_email, manager_coverage, managers_by_plaza };
}

test(`SDK real ${version}: reproduce el fallo previo sin transporte`, () => {
  assert.throws(() => dbSDK.set(dbSDK.ref(db, 'notice_directory'), projection()), /hasOwnProperty/);
});

test(`SDK real ${version}: handler publicado envía datos compatibles sin modificar identidades`, async () => {
  const source = projection(), operator = { uid: 'support-synthetic', email: 'soporte@fredinero.com' };
  const messages = [], localWrites = [];
  const context = vm.createContext({
    window: {}, auth: { currentUser: operator }, database: db, AbortController,
    _supportNoticeBusy: false, _supportNoticeRun: 1,
    _supportNoticePrepared: { projection: source, count: 2, operator, run: 1, at: Date.now() },
    supportWorkerIsAuthorized: () => true, supportNoticeControls: () => {},
    supportNoticeMessage: message => messages.push(message), confirm: () => true,
    serverTimestamp: dbSDK.serverTimestamp,
    ref: (database, location) => { assert.equal(database, db); assert.equal(location, 'notice_directory'); return dbSDK.ref(database, location); },
    set: (reference, data) => {
      assert.equal(reference.key, 'notice_directory');
      // SDK real valida y encola sin conexión. No fingimos recepción del servidor.
      const pending = dbSDK.set(reference, data); pending.catch(() => {});
      localWrites.push(JSON.parse(JSON.stringify(data)));
      return pending;
    },
    // La promesa sigue pendiente offline: finaliza el test con resultado ambiguo,
    // mientras la validación real anterior se conserva y no se reintenta.
    supportNoticeWait: async pending => { assert.equal(typeof pending.then, 'function'); throw new Error('TIMEOUT'); },
  });
  vm.runInContext(handler(), context);
  await context.window.saveSupportNoticeDirectory();
  assert.equal(localWrites.length, 1);
  assert.deepEqual(localWrites[0], JSON.parse(JSON.stringify(source)));
  assert.match(messages.at(-1), /^TIMEOUT:/);
  assert.ok(!messages.some(message => /^DIRECTORY_DATA_INVALID:/.test(message)));
  assert.equal(context._supportNoticeBusy, false);
  assert.equal(context._supportNoticePrepared, null);
  await context.window.saveSupportNoticeDirectory();
  assert.equal(localWrites.length, 1);
  assert.equal(Object.getPrototypeOf(source.by_uid), null);
});

test('validador real de claves bloquea las propiedades reservadas antes de escribir', () => {
  const ctx = vm.createContext({}); vm.runInContext(realFunction('supportNoticeKey')+';globalThis.validate=supportNoticeKey;', ctx);
  for (const key of ['__proto__','constructor','prototype','hasOwnProperty']) assert.equal(ctx.validate(key), false);
  assert.equal(ctx.validate('normal_uid_123'), true);
});
