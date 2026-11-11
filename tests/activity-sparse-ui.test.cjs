'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { harness, fixture } = require('./activity-light-query.test.cjs');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const render = html.match(/^  window\.renderActivities = function\(\) \{\n[\s\S]*?^  \};/m)[0];
function ui(h) {
  h.node('activityGraphicsSection').open = true;
  h.node('activityResponseChartsModal').style.display = 'block';
  vm.runInContext(`
    let _activityResponseChartType = 'GENERAL';
    let boardCalls = [];
    function renderActivityRoutesReport() {}
    function renderActivityBoard(container, rows, remaining, more, partial) {
      boardCalls.push({ rows: rows.length, more, partial });
      container.innerHTML = '<div class="cards">Verified cards</div>';
    }
    window.initializeActivityGraphics = () => { throw new Error('Buscar activó gráficos completos'); };
    window.openResponseChartsModal = () => { throw new Error('Buscar activó respuestas completas'); };
    ${render}
    globalThis.uiTest = { boardCalls };
  `, h.context);
}

test('0/2207: render conserva aviso y continuar; Buscar repetido y filtros no activan Infinity por gráficos abiertos', async () => {
  const h = harness(); fixture(h, 2207); h.node('activityType').value = 'PROSPECCION'; ui(h);
  assert.equal(await h.window.searchActivities(), true);
  assert.equal(h.api.page().lightEntry.offset, 102);
  assert.match(h.node('activitiesTableContainer').innerHTML, /Verificación pendiente/);
  assert.match(h.node('activitiesTableContainer').innerHTML, /todavía no se puede confirmar/);
  assert.match(h.node('activitiesTableContainer').innerHTML, /Continuar búsqueda/);
  assert.doesNotMatch(h.node('activitiesTableContainer').innerHTML, /No hay actividades que cumplan/);
  assert.match(h.node('activityRecordCount').textContent, /verificación histórica pendiente/);
  assert.doesNotMatch(h.node('activityRecordCount').textContent, /hay más coincidencias/);
  assert.match(h.node('activityPerformanceContainer').innerHTML, /Cargar gráficos del rango completo/);
  assert.match(h.node('activityResponseChartsContainer').innerHTML, /Cargar respuestas del rango completo/);
  const reads = h.reads.length + h.restReads.length;
  assert.equal(await h.window.searchActivities(), true); h.window.renderActivities();
  assert.equal(h.reads.length + h.restReads.length, reads);
  assert.equal(h.api.page().lightEntry.offset, 102);
  await h.window.loadMoreActivities();
  assert.equal(h.api.page().lightEntry.offset, 204);
  assert.match(h.node('activitiesTableContainer').innerHTML, /204 candidato/);
});

test('1/2207: tarjetas y contadores son verificados pero provisionales; no obligan a terminar el historial', async () => {
  const h = harness(); const rows = fixture(h, 2207); h.node('activityType').value = 'PROSPECCION';
  Object.assign(rows.at(-1), { tipo: 'PROSPECCION', nombre_prospecto: 'Único resultado', tipo_accion: 'LLAMADA', es_expediente_prospeccion: true });
  for (const members of Object.values(h.store.activity_summaries.plazas)) {
    if (members[rows.at(-1).id]) Object.assign(members[rows.at(-1).id], { tipo: 'PROSPECCION', nombre_prospecto: 'Único resultado', tipo_accion: 'LLAMADA', es_expediente_prospeccion: true });
  }
  ui(h); await h.window.searchActivities();
  assert.equal(h.api.data().length, 1); assert.equal(h.api.page().lightEntry.complete, false);
  assert.match(h.node('activitiesTableContainer').innerHTML, /Son coincidencias verificadas, no el total definitivo/);
  assert.equal(vm.runInContext('uiTest.boardCalls.at(-1).partial', h.context), true);
  assert.equal(h.node('activityTotal').textContent, 1);
});

test('análisis explícito completa cobertura: renderer quita aviso provisional obsoleto y no hace lecturas nuevas', async () => {
  const h = harness(); fixture(h, 140); h.node('activityType').value = 'PROSPECCION'; ui(h);
  await h.window.searchActivities(); assert.equal(h.api.page().partial, true);
  const results = await h.api.loadActivityAnalysisData(); assert.equal(results.length, 0);
  assert.equal(h.api.page().lightEntry.complete, true);
  const reads = h.reads.length + h.restReads.length; h.window.renderActivities();
  assert.equal(h.reads.length + h.restReads.length, reads);
  assert.match(h.node('activitiesTableContainer').innerHTML, /No hay actividades que cumplan/);
  assert.doesNotMatch(h.node('activitiesTableContainer').innerHTML, /Verificación pendiente|Continuar búsqueda/);
  assert.doesNotMatch(h.node('activityRecordCount').textContent, /pendiente/);
});

test('render no llama ningún recolector/análisis; la continuación acotada se mantiene visible en tablero parcial', () => {
  assert.doesNotMatch(render, /(?:void\s+window\.(?:initializeActivityGraphics|openResponseChartsModal)|\bawait\s+loadActivityAnalysisData)/);
  const board = html.match(/^  function renderActivityBoard\([^\n]*\) \{\n[\s\S]*?^  \}/m)[0];
  assert.match(board, /partial && !remainingRecords \? 'Continuar búsqueda'/);
  assert.match(board, /puede añadir menos de 50 coincidencias/);
});

test('raíz push antigua con movimiento en el rango: búsqueda acotada mantiene pendiente y análisis explícito la encuentra', async () => {
  const h = harness(); const rows = fixture(h, 1207);
  const oldTime = new Date('2026-10-01T10:00:00').getTime();
  const id = h.api.firebasePushIdBoundary(oldTime, '-');
  const record = { id, user_uid: 'employee-synthetic', tipo: 'PROSPECCION', nombre_prospecto: 'Prospecto creado antes del rango', tipo_accion: 'LLAMADA', gestion_realizada: 'LLAMADA', estado_expediente: 'ONBOARDING', es_expediente_prospeccion: true, plaza: 'CHIHUAHUA', rol: 'GESTOR', nombre_usuario: 'José Díaz', correo_usuario: 'jose@example.test', created_at: oldTime, actualizado_en: rows[0].created_at };
  h.store.gestor_activities[id] = record; h.store.activity_summaries.plazas.CHIHUAHUA[id] = record;
  h.node('activityType').value = 'PROSPECCION'; ui(h);
  await h.window.searchActivities();
  assert.equal(h.api.data().length, 0); assert.equal(h.api.page().lightEntry.offset, 102);
  assert.equal(h.api.page().lightEntry.complete, false);
  assert.match(h.node('activitiesTableContainer').innerHTML, /Verificación pendiente/);
  const all = await h.api.loadActivityAnalysisData();
  assert.deepEqual(Array.from(all, item => item.id), [id]);
  assert.equal(h.api.page().lightEntry.complete, true);
  assert.ok(h.maxInFlight() <= 6);
});
