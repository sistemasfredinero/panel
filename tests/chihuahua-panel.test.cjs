'use strict';

// Código real de index.html, con DOM/RTDB sintéticos. No SDK, red ni datos reales.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const html = readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const previous = ['TAMPICO', 'MADERO', 'MANTE', 'POZA', 'TUXPAN', 'PAPANTLA', 'VALLES', 'XALAPA', 'SALTILLO', 'ADMINISTRATIVO'];
const fn = name => {
  const match = html.match(new RegExp(`^  (?:async )?function ${name}\\([^\\n]*\\) \\{(?:[^\\n]*\\}$|\\n[\\s\\S]*?^  \\})`, 'm'));
  assert.ok(match, `Función real ${name}`); return match[0];
};
const action = name => {
  const match = html.match(new RegExp(`^  window\\.${name} = (?:async )?function\\([^\\n]*\\) \\{(?:[^\\n]*\\};$|\\n[\\s\\S]*?^  \\};)`, 'm'));
  assert.ok(match, `Acción real ${name}`); return match[0];
};
const constant = name => {
  const match = html.match(new RegExp(`^  const ${name} = (?:[^\\n]+;|[\\s\\S]*?^  [^\\n]*;)`, 'm'));
  assert.ok(match, `Constante real ${name}`); return match[0];
};
function optionsFor(id) {
  const tag = html.match(new RegExp(`<(select|datalist)\\b[^>]*\\bid="${id}"[^>]*>([\\s\\S]*?)<\\/\\1>`));
  assert.ok(tag, `Selector HTML ${id}`);
  return [...tag[2].matchAll(/<option\b[^>]*value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/g)].map(([, value, textContent]) => ({ value, textContent, disabled: false }));
}
function snapshot(value, key = '') {
  return { key, exists: () => value != null && Object.keys(value).length > 0, val: () => value == null ? null : plain(value), forEach: cb => Object.entries(value || {}).forEach(([id, row]) => cb(snapshot(row, id))) };
}
function harness({ role = 'ADMINISTRATIVO', plaza = 'CHIHUAHUA', email = 'admin@example.test', store = {} } = {}) {
  const reads = [], usage = [], alerts = [], forbidden = [], nodes = {};
  const node = id => nodes[id] ||= { value: '', textContent: '', innerHTML: '', style: {}, options: [], classList: { add() {}, remove() {} }, addEventListener() {} };
  for (const id of ['filtroPlaza', 'activityPlaza', 'annualFeedbackPlaza', 'vpPlaza']) {
    const el = node(id); el.options = optionsFor(id);
    let value = '';
    Object.defineProperty(el, 'value', { get: () => value, set: next => { value = el.options.some(o => o.value === next) ? next : ''; } });
  }
  node('annualFeedbackYear').value = '2026';
  node('activityStartDate').value = '2026-01-01'; node('activityEndDate').value = '2026-12-31';
  const deny = name => () => { forbidden.push(name); throw new Error(`Prohibido ${name}`); };
  const context = vm.createContext({
    window: {}, database: {}, auth: { currentUser: { uid: 'manager-synthetic', email } },
    document: { getElementById: node },
    console, alert: text => alerts.push(text), btoa: text => Buffer.from(text).toString('base64'),
    recordPanelDataUsage: (name, data) => usage.push({ name, data: plain(data) }),
    ref: (_, route) => { assert.ok(route, 'No lectura raíz'); return route; },
    query: (route, ...constraints) => ({ route, constraints }),
    orderByKey: () => ({ type: 'key' }), orderByChild: field => ({ type: 'child', field }),
    startAt: value => ({ type: 'start', value }), endAt: value => ({ type: 'end', value }), limitToLast: count => ({ type: 'last', count }),
    get: async request => {
      reads.push(plain(request));
      const route = typeof request === 'string' ? request : request.route;
      let value = route.split('/').reduce((obj, key) => obj?.[key], store);
      if (request.constraints) {
        assert.ok(request.constraints.some(c => c.type === 'key' || c.type === 'child'));
        const start = request.constraints.find(c => c.type === 'start')?.value;
        const end = request.constraints.find(c => c.type === 'end')?.value;
        const count = request.constraints.find(c => c.type === 'last')?.count || Infinity;
        const child = request.constraints.find(c => c.type === 'child')?.field;
        const rows = Object.entries(value || {}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).filter(([key, row]) => (start === undefined || (child ? row[child] : key) >= start) && (end === undefined || (child ? row[child] : key) <= end)).slice(-count);
        value = Object.fromEntries(rows);
      }
      return snapshot(value);
    },
    renderCharts: async () => {}, renderAlerts: () => {}, renderActivityRoutesReport: () => {},
    puntualidadChip: () => '', formatDate: timestamp => String(timestamp), privacyIsSupport: () => false,
    XLSX: { utils: { aoa_to_sheet: rows => ({ rows: plain(rows) }) } },
    set: deny('set'), update: deny('update'), remove: deny('remove'), push: deny('push'), fetch: deny('fetch'), onValue: deny('onValue'), setInterval: deny('setInterval'),
  });
  const names = ['normaliseActivityText', 'branchKey', 'activityText', 'activityCategory', 'activityCategoryLabel', 'activityCreatedTimestamp', 'firebasePushIdBoundary', 'firebasePushIdTimestamp', 'isStoredActivityRecord', 'matchesActivityUser', 'activityMatchesSelectedActions', 'activityFilterRecordAction', 'currentActivityFilterCriteria', 'activityMatchesCriteria', 'activityPageRecordMatches', 'activityPreview', 'activityRecordPath', 'loadFullActivityRecord', 'loadActivityTextPage', 'loadActivityUserDirectory', 'resolveActivitySearchSource', 'activityCanManageAll', 'activityIsManagerScope', 'activityIsAdministrative', 'isInManagerActivityScope', 'prospectSectionPlazas', 'prospectSectionIsPlazaSelector', 'calendarAllowedPlazas', 'activityCanUseProspectCalendar', 'renderProspectPlazaControls', 'renderProspectCalendarPlazaControls', 'loadProspectCalendar', 'activityCalendarEvents', 'prospectWorkflowStage', 'annualFeedbackPreview', 'loadAnnualFeedbackActivities', 'annualFeedbackWorksheet', 'annualFeedbackRole', 'renderStats', 'renderCards', 'filterAndRender', 'validCoordinates', 'renderTripRoutesReport', 'distanceInMeters', 'formatRecordDateTime', 'escapeMapHtml', 'renderOutsideBranchReport', 'supportNoticeProfile', 'supportNoticeKey', 'supportNoticeLabel', 'managerProfilePlazas', 'buildSupportNoticeDirectory', 'buildActivitySummary', 'cleanActivitySummaryValue'];
  const constants = ['PANEL_PLAZAS', 'TAMPICO_MADERO_MANAGER_EMAIL', 'ANNUAL_FEEDBACK_PLAZAS', 'ANNUAL_FEEDBACK_ROLES', 'ACTIVITY_RESULTS_PAGE_SIZE', 'PROSPECT_SECTION_PAGE_SIZE', 'PROSPECT_SECTION_DEFINITIONS', 'FIREBASE_PUSH_ID_CHARS', 'PROSPECT_CALENDAR_COLORS', 'PROSPECT_WORKFLOW_COLORS', 'PROSPECT_WORKFLOW_LABELS', 'BRANCH_MAP_COLORS', 'BRANCH_CENTERS', 'OUTSIDE_BRANCH_RADIUS_METERS', 'SUPPORT_NOTICE_FIELDS', 'ACTIVITY_SUMMARY_FIELDS'];
  vm.runInContext([
    ...constants.map(constant), ...names.map(fn),
    `let _activityProfile = ${JSON.stringify({ rol: role, plaza, managedPlazas: ['TAMPICO'] })};`,
    'let _activityUserDirectory = null, _selectedActivityActionFilters = new Set(), _annualFeedbackExport = null;',
    'let _prospectSectionsPlaza = "", _prospectCalendarPlaza = "", _prospectCalendarSelectedDate = "";',
    'let _prospectCalendarMonth = new Date(2026, 10, 1), _prospectCalendarAppointments = [], _activityCalendarPromises = [];',
    'const _prospectSectionState = new Map(), _activityDetailCache = new Map();',
    'let usersMap = {}, allRecords = [], _activitiesData = [], _activitiesFiltered = [], _activitiesVisibleCount = 50, _activityPageSession = null, _activityResponseChartType = null;',
    'function renderProspectCalendar() {} function renderProspectSection() {} function renderProspectSections() {} function setActivityModalVisibility() {}',
    ...['selectProspectCalendarPlaza', 'selectProspectSectionsPlaza', 'loadProspectSection', 'loadAnnualFeedback', 'openAnnualFeedbackModal', 'loadTodayProspectAppointments', 'renderActivities'].map(action),
    `globalThis.api = { ${names.join(', ')}, PANEL_PLAZAS, ANNUAL_FEEDBACK_PLAZAS, BRANCH_CENTERS, BRANCH_MAP_COLORS, PROSPECT_CALENDAR_COLORS,
      setAttendance: (users, records) => { usersMap = users; allRecords = records; },
      setActivities: records => { _activitiesData = records; },
      setPlazas: plaza => { _prospectSectionsPlaza = plaza; _prospectCalendarPlaza = plaza; },
      section: key => _prospectSectionState.get(key), events: () => activityCalendarEvents(), annual: () => _annualFeedbackExport,
    };`,
  ].join('\n\n'), context);
  return { api: context.api, window: context.window, nodes, node, reads, usage, alerts, forbidden };
}
function record(id, extra = {}) {
  return { id, user_uid: 'employee-synthetic', nombre_usuario: 'Empleado sintético', plaza: 'CHIHUAHUA', rol: 'GESTOR', tipo: 'GENERAL', gestion_realizada: 'LLAMADA', created_at: new Date(2026, 10, 6, 10).getTime(), ...extra };
}
function activityFixture(h, count) {
  return Object.fromEntries(Array.from({ length: count }, (_, i) => {
    const id = h.api.firebasePushIdBoundary(new Date(2026, 10, 6, 10).getTime() + i, '-');
    return [id, record(id)];
  }));
}

for (const id of ['filtroPlaza', 'activityPlaza', 'vpPlaza', 'annualFeedbackPlaza', 'supportProfilePlazas']) {
  test(`${id}: HTML contiene una sola CHIHUAHUA y conserva exactamente las plazas previas`, () => {
    const options = optionsFor(id).map(o => o.value).filter(Boolean);
    const expected = id === 'annualFeedbackPlaza' ? previous.filter(p => p !== 'ADMINISTRATIVO') : previous;
    assert.deepEqual(options.filter(p => p !== 'CHIHUAHUA').sort(), [...expected].sort());
    assert.equal(options.filter(p => p === 'CHIHUAHUA').length, 1);
    if (id !== 'supportProfilePlazas') { const h = harness(); h.node(id).value = 'CHIHUAHUA'; assert.equal(h.node(id).value, 'CHIHUAHUA'); }
  });
}
test('catálogos operativos/anual incorporan sólo Chihuahua; chip/calendario/mapa usan color coherente sin centro inventado', () => {
  const h = harness();
  assert.deepEqual(plain(h.api.PANEL_PLAZAS).filter(p => p !== 'CHIHUAHUA').sort(), [...previous].sort());
  assert.equal(h.api.ANNUAL_FEEDBACK_PLAZAS.find(p => p.code === 'CHIHUAHUA').label, 'CHIHUAHUA');
  assert.equal(h.api.BRANCH_MAP_COLORS.CHIHUAHUA, h.api.PROSPECT_CALENDAR_COLORS.CHIHUAHUA);
  assert.match(html, /\.chip-CHIHUAHUA\s*\{ background: #0E7490; color: #fff; \}/);
  assert.equal(h.api.BRANCH_CENTERS.CHIHUAHUA, undefined);
});
test('normalización de clave y criterio acepta espacios, mayúsculas y acentos sin alias inventados', () => {
  const h = harness(); h.node('activityPlaza').value = 'CHIHUAHUA';
  const criteria = h.api.currentActivityFilterCriteria();
  for (const plaza of ['CHIHUAHUA', ' chihuahua ', 'Chihuáhua']) {
    assert.equal(h.api.branchKey(plaza), 'CHIHUAHUA');
    assert.equal(h.api.activityMatchesCriteria(record('a', { plaza }), criteria), true);
  }
  assert.equal(h.api.activityMatchesCriteria(record('b', { plaza: 'CHIH' }), criteria), false);
});
test('asistencia, alertas y viajes no descartan perfiles Chihuahua por espacios; tarjetas y conteos reales', async () => {
  const store = { vehicle_trips: { trip: { user_uid: 'employee-synthetic', timestamp_inicio: Date.now(), latitud_inicio: 28.5, longitud_inicio: -106.1 } } };
  const h = harness({ store }); h.node('filtroPlaza').value = 'CHIHUAHUA';
  h.api.setAttendance({ 'employee-synthetic': { plaza: ' chihuahua ', rol: 'GESTOR', nombre_completo: 'Empleado sintético' }, other: { plaza: 'TAMPICO' } }, [{ id: 'a', user_uid: 'employee-synthetic', tipo: 'ENTRADA', timestamp: Date.now(), latitud: 28.5, longitud: -106.1, tiene_foto_nueva: true }, { id: 'b', user_uid: 'other', tipo: 'SALIDA' }]);
  await h.api.filterAndRender();
  assert.equal(h.nodes.statTotal.textContent, 1); assert.equal(h.nodes.statEntradas.textContent, 1);
  assert.equal(h.nodes.recordCount.textContent, '1 registros'); assert.match(h.nodes.tableContainer.innerHTML, /chip-CHIHUAHUA/);
  assert.match(h.nodes.tableContainer.innerHTML, /maps\?q=28.500000,-106.100000/);
  assert.match(h.nodes.outsideBranchReport.innerHTML, /Sin centro de oficina configurado para CHIHUAHUA/);
  assert.equal(h.window.__mappableTrips.length, 1); assert.equal(h.window.__mappableTrips[0].plaza, 'CHIHUAHUA');
  assert.ok(h.reads.every(r => r.route === 'vehicle_trips'), 'No carga fotos al filtrar');
  assert.deepEqual(h.forbidden, []);
});
test('GERENTE Chihuahua tiene sólo su plaza, ignora coberturas históricas y no filtra por UID propio ajeno', async () => {
  const h = harness({ role: 'GERENTE', plaza: ' chihuahua ' });
  assert.deepEqual(plain(h.api.prospectSectionPlazas()), ['CHIHUAHUA']);
  assert.deepEqual(plain(h.api.calendarAllowedPlazas()), ['CHIHUAHUA']);
  assert.equal(h.api.isInManagerActivityScope(record('a')), true);
  assert.equal(h.api.isInManagerActivityScope(record('b', { plaza: 'TAMPICO', user_uid: 'manager-synthetic' })), false);
  assert.equal((await h.api.resolveActivitySearchSource({})).path, 'activity_summaries/plazas/CHIHUAHUA');
  assert.equal((await h.api.resolveActivitySearchSource({ userSearch: 'cualquiera' })).path, 'activity_summaries/plazas/CHIHUAHUA');
  await assert.rejects(h.api.resolveActivitySearchSource({ plaza: 'TAMPICO' }), /alcance/);
  assert.equal(h.reads.length, 0);
});
test('única excepción Tampico–Madero se conserva en alcance/calendario y consultas por sucursal', async () => {
  const h = harness({ role: 'GERENTE', plaza: 'TAMPICO', email: 'gerente.tampico@fredinero.com' });
  assert.deepEqual(plain(h.api.prospectSectionPlazas()), ['TAMPICO', 'MADERO']);
  assert.equal(h.api.isInManagerActivityScope(record('a', { plaza: 'MADERO' })), true);
  assert.equal(h.api.isInManagerActivityScope(record('b')), false);
  assert.equal((await h.api.resolveActivitySearchSource({ plaza: 'MADERO' })).path, 'activity_summaries/plazas/MADERO');
});
for (const email of ['admin@example.test', 'soporte@fredinero.com']) {
  test(`ADMINISTRATIVO/Soporte conserva todas las plazas e índice Chihuahua: ${email}`, async () => {
    const h = harness({ email }); assert.ok(h.api.prospectSectionPlazas().includes('CHIHUAHUA'));
    assert.equal(h.api.prospectSectionPlazas().length, 11);
    assert.equal((await h.api.resolveActivitySearchSource({ plaza: ' chihuahua ' })).path, 'activity_summaries/plazas/CHIHUAHUA');
    h.api.renderProspectPlazaControls(); h.api.renderProspectCalendarPlazaControls();
    assert.match(h.nodes.pendingProspectsPlazaControls.innerHTML, /selectProspectSectionsPlaza\('CHIHUAHUA'\)/);
    assert.match(h.nodes.prospectCalendarPlazaControls.innerHTML, /selectProspectCalendarPlaza\('CHIHUAHUA'\)/);
  });
}
test('gerente no puede cambiar calendario/fichas por acción directa a otra plaza', async () => {
  const h = harness({ role: 'GERENTE' }); h.api.setPlazas('CHIHUAHUA');
  await h.window.selectProspectCalendarPlaza('TAMPICO'); h.window.selectProspectSectionsPlaza('TAMPICO');
  assert.equal(h.reads.length, 0);
  h.api.setPlazas('TAMPICO'); await h.api.loadProspectCalendar(); await h.window.loadProspectSection('PENDIENTES');
  assert.equal(h.reads.length, 0);
});
test('actividad paginada por plaza conserva 50+1 sin omitir filas y evidencia sólo bajo demanda', async () => {
  const store = { activity_summaries: { plazas: { CHIHUAHUA: {} } }, gestor_activities: {} };
  const h = harness({ store, role: 'GERENTE' }); const fixtures = activityFixture(h, 61);
  store.activity_summaries.plazas.CHIHUAHUA = fixtures; store.gestor_activities = fixtures;
  const criteria = h.api.currentActivityFilterCriteria();
  const session = { start: criteria.start, end: criteria.end, sourcePath: 'activity_summaries/plazas/CHIHUAHUA', cursorKey: h.api.firebasePushIdBoundary(criteria.end, 'z'), seen: new Set(), pendingMatches: [] };
  const first = await h.api.loadActivityTextPage(session, h.api.activityPreview, criteria);
  assert.equal(first.page.length, 50); assert.equal(session.hasMore, true);
  const second = await h.api.loadActivityTextPage(session, h.api.activityPreview, criteria);
  assert.equal(second.page.length, 11); assert.equal(new Set([...first.page, ...second.page].map(r => r.id)).size, 61);
  assert.ok(h.reads.every(r => r.route === session.sourcePath && r.constraints.find(c => c.type === 'last').count === 51));
  await h.api.loadFullActivityRecord(first.page[0]);
  assert.equal(h.reads.at(-1), `gestor_activities/${first.page[0].id}`);
});
test('registros de actividades y contadores renderizan Chihuahua sin evidencia embebida', () => {
  const h = harness({ role: 'GERENTE' }); h.node('activityPlaza').value = 'CHIHUAHUA';
  h.api.setActivities([record('a'), record('b', { tipo: 'COBRANZA', tiene_evidencia: true }), record('c', { plaza: 'TAMPICO' })]);
  h.window.renderActivities();
  assert.equal(h.nodes.activityTotal.textContent, 2); assert.equal(h.nodes.activityGeneral.textContent, 1); assert.equal(h.nodes.activityCobranza.textContent, 1);
  assert.match(h.nodes.activitiesTableContainer.innerHTML, /chip-CHIHUAHUA/);
  assert.equal(h.reads.length, 0);
});
test('fichas de Chihuahua preservan 10+1 y no pierden la undécima ficha al avanzar', async () => {
  const rows = Object.fromEntries(Array.from({ length: 21 }, (_, i) => { const id = `case-${String(i).padStart(3, '0')}`; return [id, record(id, { tipo: 'PROSPECCION' })]; }));
  const store = { activity_summaries: { prospect_pages: { by_plaza: { CHIHUAHUA: { PENDIENTES: rows } } } } };
  const h = harness({ store, role: 'GERENTE' }); h.api.setPlazas('CHIHUAHUA');
  await h.window.loadProspectSection('PENDIENTES'); assert.equal(h.api.section('PENDIENTES').records.length, 10);
  await h.window.loadProspectSection('PENDIENTES'); assert.equal(h.api.section('PENDIENTES').records.length, 20);
  await h.window.loadProspectSection('PENDIENTES');
  assert.equal(h.api.section('PENDIENTES').records.length, 21); assert.equal(new Set(h.api.section('PENDIENTES').records.map(r => r.id)).size, 21);
  assert.ok(h.reads.every(r => r.route === 'activity_summaries/prospect_pages/by_plaza/CHIHUAHUA/PENDIENTES' && r.constraints.find(c => c.type === 'last').count === 11));
});
test('fichas descartan índice inconsistente de otra plaza y no cargan expediente/fotos', async () => {
  const store = { activity_summaries: { prospect_pages: { by_plaza: { CHIHUAHUA: { ALTAS: { a: record('a', { plaza: ' chihuahua ' }), b: record('b', { plaza: 'TAMPICO' }) } } } } } };
  const h = harness({ store, role: 'GERENTE' }); h.api.setPlazas('CHIHUAHUA'); await h.window.loadProspectSection('ALTAS');
  assert.equal(h.api.section('ALTAS').records.length, 1); assert.equal(h.api.section('ALTAS').records[0].id, 'a'); assert.equal(h.reads.length, 1);
});
test('calendario mensual Chihuahua consulta sólo citas/promesas del mes y descarta otra plaza/canceladas/comprobadas', async () => {
  const citations = { a: record('a', { tipo: 'PROSPECCION', se_agenda_cita: true, cita_timestamp: Date.now() }), b: record('b', { tipo: 'PROSPECCION', se_agenda_cita: true, plaza: 'TAMPICO' }), c: record('c', { tipo: 'PROSPECCION', se_agenda_cita: true, estado_cita: 'CANCELADA' }) };
  const promises = { d: record('d', { tipo: 'COBRANZA', gestion_realizada: 'PROMESA DE PAGO', promesa_timestamp: Date.now() }), e: record('e', { tipo: 'COBRANZA', gestion_realizada: 'PROMESA DE PAGO', estado_seguimiento_pago: 'COMPROBADO' }) };
  const store = { activity_summaries: { calendar: { by_plaza: { CHIHUAHUA: { '2026-11': { citas: citations, promesas: promises } } } } } };
  const h = harness({ store, role: 'GERENTE' }); h.api.setPlazas('CHIHUAHUA'); await h.api.loadProspectCalendar();
  assert.deepEqual(h.reads, ['activity_summaries/calendar/by_plaza/CHIHUAHUA/2026-11/citas', 'activity_summaries/calendar/by_plaza/CHIHUAHUA/2026-11/promesas']);
  assert.deepEqual(plain(h.api.events()).map(r => r.id).sort(), ['a', 'd']); assert.equal(h.usage.at(-1).data.records, 2);
});
test('calendario de hoy usa perfil Chihuahua normalizado e índice mensual, sin escanear raíces', async () => {
  const h = harness({ role: 'GERENTE', plaza: ' chihuahua ' }); await h.window.loadTodayProspectAppointments();
  assert.equal(h.reads.length, 2); assert.ok(h.reads.every(route => /^activity_summaries\/calendar\/by_plaza\/CHIHUAHUA\/\d{4}-\d{2}\/(citas|promesas)$/.test(route)));
});
test('gerencia Chihuahua se resuelve por perfil real y UID del nodo, no por correo inventado; ambigüedad bloquea', () => {
  const h = harness(); const p = { correo: 'persona.prueba@fredinero.com', rol: 'GERENTE', plaza: ' chihuahua ', nombre_completo: 'Gerente sintético' };
  const report = h.api.buildSupportNoticeDirectory([{ uid: 'current-node', profile: p }]);
  assert.equal(report.projection.managers_by_plaza.CHIHUAHUA, 'current-node');
  assert.deepEqual(plain(report.projection.manager_coverage['current-node']), { CHIHUAHUA: true });
  const ambiguous = h.api.buildSupportNoticeDirectory([{ uid: 'current-node', profile: p }, { uid: 'second', profile: { ...p, correo: 'otra.persona@fredinero.com' } }]);
  assert.equal(ambiguous.projection, null); assert.match(ambiguous.conflicts.join(' '), /Gerencia ambigua en CHIHUAHUA/);
});
test('retroalimentación anual Chihuahua pagina por índice, conserva roles/perfiles vigentes y altas, y exporta columna', async () => {
  const store = { activity_summaries: { plazas: { CHIHUAHUA: {} } }, users: { 'employee-synthetic': { uid: 'obsolete-profile-id', plaza: ' chihuahua ', rol: 'GESTOR', nombre_completo: 'Empleado sintético' }, other: { plaza: 'TAMPICO', rol: 'LIDER C' } } };
  const h = harness({ store, role: 'GERENTE' }); const rows = activityFixture(h, 61); const ids = Object.keys(rows);
  rows[ids[0]] = record(ids[0], { tipo: 'PROSPECCION', se_agenda_cita: true, estado_expediente: 'ALTA' });
  store.activity_summaries.plazas.CHIHUAHUA = rows; h.node('annualFeedbackPlaza').value = 'CHIHUAHUA';
  await h.window.loadAnnualFeedback();
  const stats = plain(h.api.annual().stats); assert.equal(stats.length, 1); assert.equal(stats[0].uid, 'employee-synthetic');
  assert.equal(stats[0].general, 60); assert.equal(stats[0].citasAlta, 1); assert.equal(stats[0].role, 'GESTOR');
  assert.ok(h.reads.every(r => r === 'users' || r.route === 'activity_summaries/plazas/CHIHUAHUA'));
  const report = h.api.annualFeedbackWorksheet('ACTIVIDADES'); assert.equal(report.worksheet.rows[2][1], 'CHIHUAHUA');
  assert.equal(report.worksheet.rows[4][0], 'Gestor'); assert.equal(report.worksheet.rows[4][1], 60);
  assert.deepEqual(h.forbidden, []);
});
test('gerente anual desactiva Todas/otras plazas y la carga directa ajena no consulta datos', async () => {
  const h = harness({ role: 'GERENTE' }); h.window.openAnnualFeedbackModal();
  assert.equal(h.node('annualFeedbackPlaza').value, 'CHIHUAHUA');
  assert.equal(h.node('annualFeedbackPlaza').options.find(o => o.value === '').disabled, true);
  assert.equal(h.node('annualFeedbackPlaza').options.find(o => o.value === 'TAMPICO').disabled, true);
  h.node('annualFeedbackPlaza').value = 'TAMPICO'; await h.window.loadAnnualFeedback(); assert.equal(h.reads.length, 0); assert.match(h.alerts[0], /alcance/);
});
test('índice ligero conserva estatus anual sin adjuntar fotos/bitácora ni escribir datos', () => {
  const h = harness(); const summary = h.api.buildActivitySummary(record('a', { estado_alta: 'ALTA', foto_base64: 'PRIVATE', historial_expediente: { a: 'PRIVATE' } }));
  assert.equal(summary.estado_alta, 'ALTA'); assert.equal(summary.foto_base64, undefined); assert.equal(summary.historial_expediente, undefined); assert.deepEqual(h.forbidden, []);
});
