'use strict';
// Contrato de retirada: diagnóstico inicial eliminado del panel, no del Worker.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const html = readFileSync(path.join(__dirname, '../index.html'), 'utf8');
test('diagnóstico inicial de sesión Worker: sin tarjeta, endpoint, handler o reset huérfano', () => {
  for (const obsolete of ['supportWorkerDiagnostic', 'checkSupportWorkerSession', 'resetSupportWorkerDiagnostic', 'supportWorkerMessage', 'SUPPORT_WORKER_URL', '_supportWorkerRun', '_supportWorkerBusy', '_supportWorkerController', '/v1/auth/check']) assert.ok(!html.includes(obsolete), `Referencia obsoleta: ${obsolete}`);
});
test('retirar diagnóstico conserva UID+correo exactos para mantenimiento protegido', () => {
  assert.match(html, /const SUPPORT_WORKER_UID = '5dVKDIhQZlbzonMbSG9mX1pXHYg1'/);
  assert.match(html, /function supportWorkerIsAuthorized\(\)/);
  assert.match(html, /user\?\.uid === SUPPORT_WORKER_UID && String\(user.email/);
  for (const action of ['prepareSupportNoticeDirectory', 'saveSupportNoticeDirectory', 'cancelSupportNoticeDirectory']) assert.match(html, new RegExp(`window\\.${action} = (?:async )?function`));
});
