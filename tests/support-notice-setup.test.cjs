'use strict';
// Contrato de retirada del bootstrap público; no elimina rutas ni cambia el Worker.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const html = readFileSync(path.join(__dirname, '../index.html'), 'utf8');
test('comprobación final de instalación: sin tarjeta, POST status, estado o reset de bootstrap', () => {
  for (const obsolete of ['Integración de avisos · Comprobación final', 'supportNoticeSetup', 'SupportNoticeSetup', '/v1/notices/status']) assert.ok(!html.includes(obsolete), `Referencia obsoleta: ${obsolete}`);
});
test('mantenimiento del directorio permanece cerrado y aislado de las pruebas retiradas', () => {
  const card = html.match(/<details id="supportNoticeDirectoryEntry"[^>]*>[\s\S]*?<\/details>/)?.[0];
  assert.ok(card);
  assert.doesNotMatch(card.split('>')[0], /\bopen\b/);
  assert.match(card, /Mantenimiento de avisos · Soporte/);
  assert.match(card, /Crear un perfil en users no actualiza el directorio automáticamente/);
  assert.equal((card.match(/<button /g) || []).length, 3);
  assert.match(html, /onAuthStateChanged\(auth, async \(user\) => \{\s*resetSupportNoticeDirectory\(\);\s*document\.getElementById\('supportNoticeDirectoryEntry'\)\?\.removeAttribute\?\.\('open'\)/);
});
