// Prueba opcional REAL contra RTDB Emulator. Nunca utiliza credenciales o datos productivos.
// Dependencias externas: @firebase/rules-unit-testing y firebase; instala fuera del repositorio.
// Ejecutar con NODE_PATH apuntando a esas dependencias y FIREBASE_DATABASE_EMULATOR_HOST=127.0.0.1:9000.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { ref, set, get, update, remove, runTransaction, increment, serverTimestamp } = require('firebase/database');

async function main() {
  if (!process.env.FIREBASE_DATABASE_EMULATOR_HOST || !/^127\.0\.0\.1:/.test(process.env.FIREBASE_DATABASE_EMULATOR_HOST)) {
    throw new Error('Esta prueba sólo admite un emulador local en 127.0.0.1.');
  }
  const fragment = JSON.parse(fs.readFileSync(path.join(__dirname, '../firebase/users-profile-rules.fragment.json'), 'utf8').replaceAll('__SUPPORT_AUTH_UID__', 'support-test'));
  const [host, port] = process.env.FIREBASE_DATABASE_EMULATOR_HOST.split(':');
  const env = await initializeTestEnvironment({ projectId: 'demo-fredinero-users', database: {
    host, port: Number(port), rules: JSON.stringify({ rules: { '.read': false, '.write': false, ...fragment } }),
  } });
  let passed = 0;
  const check = async (label, callback) => { await callback(); passed++; console.log(`OK ${passed}: ${label}`); };
  const profile = uid => ({ uid, correo: `${uid}@example.test`, nombre_completo: 'Usuario de prueba', apellido_paterno: 'Prueba', rol: 'GESTOR', plaza: 'MADERO', creado_en: serverTimestamp() });
  const support = env.authenticatedContext('support-test', { email: 'soporte@fredinero.com' }).database();
  const own = env.authenticatedContext('existing', { email: 'existing@example.test' }).database();
  const stranger = env.authenticatedContext('stranger', { email: 'stranger@example.test' }).database();
  const unauth = env.unauthenticatedContext().database();
  try {
    await env.clearDatabase();
    const seed = { uid: 'UID-historico-distinto', correo: 'existing@example.test', nombre_completo: 'Nombre histórico',
      rol: 'GESTOR', plaza: 'MADERO', fcm_token: 'token-anterior',
      datos_actividad_historicos: { x: { monto: 123, comentarios: 'No borrar' } },
      data_usage_metrics: { '2026-01-01': { APP_ACTIVITIES_SUMMARY: { read_count: 1, estimated_bytes: 50 } } } };
    await env.withSecurityRulesDisabled(async context => set(ref(context.database(), 'users/existing'), seed));
    await check('Soporte con UID y correo autorizados crea perfil nuevo mediante transacción', async () => {
      const result = await assertSucceeds(runTransaction(ref(support, 'users/new-user'), current => current === null ? profile('new-user') : undefined, { applyLocally: false }));
      assert.equal(result.committed, true);
    });
    await check('Usuario normal no crea perfiles ni modifica rol/plaza propios', async () => {
      await assertFails(set(ref(own, 'users/unauthorized'), profile('unauthorized')));
      await assertFails(update(ref(own, 'users/existing'), { rol: 'GERENTE' }));
      await assertFails(update(ref(own, 'users/existing'), { plaza: 'TAMPICO' }));
    });
    await check('Correo de Soporte sin su UID no basta; UID sin correo tampoco', async () => {
      const wrongUid = env.authenticatedContext('other-support', { email: 'soporte@fredinero.com' }).database();
      const wrongEmail = env.authenticatedContext('support-test', { email: 'otro@example.test' }).database();
      await assertFails(set(ref(wrongUid, 'users/wrong-uid'), profile('wrong-uid')));
      await assertFails(set(ref(wrongEmail, 'users/wrong-email'), profile('wrong-email')));
    });
    await check('Visitante no autenticado no escribe perfiles', () => assertFails(set(ref(unauth, 'users/public-user'), profile('public-user'))));
    await check('No se permite reemplazar ni borrar el nodo users completo', async () => {
      await assertFails(set(ref(support, 'users'), { reemplazo: profile('reemplazo') }));
      await assertFails(remove(ref(support, 'users')));
      await assertFails(remove(ref(own, 'users/existing')));
    });
    await check('App actualiza conexión propia mediante el update real, pese a UID legado', () => assertSucceeds(update(ref(own, 'users/existing/app_connection'), {
      version: '1.6.7', version_code: 67, last_connected_at: Date.now(),
    })));
    await check('App registra token propio mediante update a users/UID sin tocar el perfil', () => assertSucceeds(update(ref(own, 'users/existing'), {
      fcm_token: 'nuevo-token-fcm', expo_push_token: 'nuevo-token-compatibilidad',
    })));
    await check('App incrementa métricas propias y elimina el día antiguo en una sola mutación', () => assertSucceeds(update(ref(own, 'users/existing/data_usage_metrics'), {
      '2026-01-01': null,
      '2026-11-02/APP_ACTIVITIES_SUMMARY/read_count': increment(1),
      '2026-11-02/APP_ACTIVITIES_SUMMARY/estimated_bytes': increment(100),
      '2026-11-02/APP_ACTIVITIES_SUMMARY/last_estimated_bytes': 100,
      '2026-11-02/APP_ACTIVITIES_SUMMARY/last_records': 1,
      '2026-11-02/APP_ACTIVITIES_SUMMARY/last_scope': 'Sólo prueba local',
      '2026-11-02/APP_ACTIVITIES_SUMMARY/last_at': Date.now(),
      '2026-11-02/APP_ACTIVITIES_SUMMARY/source': 'APP',
    })));
    await check('Otro usuario no cambia tokens, conexión ni métricas ajenos', async () => {
      await assertFails(update(ref(stranger, 'users/existing'), { fcm_token: 'robar' }));
      await assertFails(update(ref(stranger, 'users/existing/app_connection'), { version: '999' }));
      await assertFails(update(ref(stranger, 'users/existing/data_usage_metrics'), { '2026-11-02/TEST/read_count': 5 }));
    });
    await check('No se pueden inyectar campos de privilegios a través de app_connection o métricas', async () => {
      await assertFails(update(ref(own, 'users/existing/app_connection'), { rol: 'GERENTE' }));
      await assertFails(update(ref(own, 'users/existing/data_usage_metrics'), { '2026-11-02/TEST/rol': 'GERENTE' }));
      await assertFails(update(ref(own, 'users/existing'), { fcm_token: 'válido', rol: 'GERENTE' }));
    });
    await check('No se crea un perfil incompleto introduciendo sólo datos técnicos', async () => {
      const missing = env.authenticatedContext('missing', { email: 'missing@example.test' }).database();
      await assertFails(update(ref(missing, 'users/missing/app_connection'), { version: '1.6.7' }));
      await assertFails(update(ref(missing, 'users/missing'), { fcm_token: 'token' }));
    });
    await check('Reglas validan UID de la ruta y rol permitido al crear el perfil', async () => {
      await assertFails(set(ref(support, 'users/bad-uid'), { ...profile('bad-uid'), uid: 'otro' }));
      await assertFails(set(ref(support, 'users/bad-role'), { ...profile('bad-role'), rol: 'SUPERADMIN' }));
      await assertFails(set(ref(support, 'users/incomplete'), { uid: 'incomplete', correo: 'incomplete@example.test' }));
    });
    await check('La transacción de alta aborta ante cualquier dato previo y conserva todo', async () => {
      const before = (await get(ref(support, 'users/existing'))).val();
      const result = await runTransaction(ref(support, 'users/existing'), current => current === null ? profile('existing') : undefined, { applyLocally: false });
      assert.equal(result.committed, false);
      const after = (await get(ref(support, 'users/existing'))).val();
      assert.deepEqual(after, before);
      assert.deepEqual(after.datos_actividad_historicos, seed.datos_actividad_historicos);
      assert.equal(after.uid, seed.uid);
      assert.equal(after.correo, seed.correo);
      assert.equal(after.rol, seed.rol);
      assert.equal(after.plaza, seed.plaza);
    });
    console.log(`RESULTADO: ${passed} casos reales de emulador aprobados; cero acceso a producción.`);
  } finally { await env.cleanup(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
