'use strict';
// La prueba de correo de instalación dejó de existir; ningún envío de prueba accesible.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const html = readFileSync(path.join(__dirname, '../index.html'), 'utf8');
test('correo de prueba: se eliminan tarjeta, mensaje aprobado, handler, estado y reset', () => {
  for (const obsolete of ['Correo de prueba aprobado', 'supportEmailTest', 'SupportEmailTest', 'SUPPORT_EMAIL_TEST', '/v1/diagnostics/email-test', 'ENVIAR_PRUEBA_SOPORTE', 'Prueba de correo seguro']) assert.ok(!html.includes(obsolete), `Referencia obsoleta: ${obsolete}`);
});
test('el cliente y los eventos productivos permanecen integrados sin diagnóstico de correo', () => {
  assert.match(html, /import \{makePanelNoticeClient\} from '\.\/notice-client\.js\?v=integracion-1'/);
  assert.match(html, /const panelNotices=makePanelNoticeClient/);
  assert.match(html, /window\.reintentarAvisosPendientes=async\(\)=>\{const result=await panelNotices\.flush\(\)/);
  assert.match(html, /void panelNotices\.flush\(\)\.catch/);
  assert.match(html, /panelNotices\.save\(/);
});
