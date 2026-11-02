'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const html = readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let checked = 0;
for (const [, attributes, source] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
  if (!source.trim() || /\bsrc\s*=/i.test(attributes)) continue;
  const type = attributes.match(/\btype\s*=\s*["']([^"']+)["']/i)?.[1];
  if (type && !['module', 'text/javascript', 'application/javascript'].includes(type)) continue;
  const args = type === 'module' ? ['--input-type=module', '--check'] : ['--check'];
  const result = spawnSync(process.execPath, args, { input: source, encoding: 'utf8' });
  checked += 1;
  assert.equal(result.status, 0, `Error sintáctico en script inline ${checked}:\n${result.stderr}`);
}
assert.ok(checked > 0, 'No se encontraron scripts inline para validar');
console.log(`node --check: ${checked} script(s) inline válidos; ninguno fue ejecutado.`);
