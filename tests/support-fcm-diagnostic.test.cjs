'use strict';
// La comprobación FCM validate-only de preparación-4 no es un envío operativo.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const html = readFileSync(path.join(__dirname, '../index.html'), 'utf8');
test('FCM de preparación: sin controles, helper HTTP, estados, lector JSON ni reset huérfano', () => {
  for (const obsolete of ['Configuración de push · Soporte', 'supportFcm', 'SupportFcm', 'SUPPORT_FCM', '/v1/diagnostics/fcm-check', 'GOOGLE_FCM_SERVICE_ACCOUNT_JSON', 'preparación-4']) assert.ok(!html.includes(obsolete), `Referencia obsoleta: ${obsolete}`);
});
test('desaparece sólo el diagnóstico FCM; directorio no copia tokens ni cambia su esquema', () => {
  assert.match(html, /const SUPPORT_NOTICE_FIELDS = \['correo', 'email', 'rol', 'role', 'plaza', 'nombre_completo', 'nombre', 'plazas_a_cargo', 'plazasACargo', 'managed_plazas', 'managedPlazas'\]/);
  assert.match(html, /const projection = \{ by_uid: Object\.create\(null\), by_email: Object\.create\(null\), manager_coverage: Object\.create\(null\), managers_by_plaza: Object\.create\(null\) \}/);
});
