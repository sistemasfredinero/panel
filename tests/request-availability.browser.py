#!/usr/bin/env python3
"""Disponibilidad real del panel sobre una carga sintética ya existente, sin Firebase.

Ejecutar sin red (no usa el navegador compartido):
  sudo unshare --net -- runuser -u ubuntu -- python3 tests/request-availability.browser.py

Extrae CSS, DOM, helpers, política y render del index.html actual. No modifica
la aplicación ni maquilla su responsive. Los errores se agregan por viewport,
se capturan las tres pantallas y cualquier fallo produce exit status 1.
"""
import json
import re
import sys
import traceback
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / 'index.html').read_text(encoding='utf-8')
WIDTHS = (1440, 768, 390)
REPORT_PATH = Path('/tmp/request-availability-browser-results.json')


def extract(pattern, label):
    match = re.search(pattern, HTML, re.M)
    if not match:
        raise AssertionError(f'No se encontró código real: {label}')
    return match.group(0)


def function(name):
    return extract(r'^  (?:async )?function ' + re.escape(name) + r'\([^\n]*\) \{\n[\s\S]*?^  \}', name)


def action(name):
    return extract(r'^  window\.' + re.escape(name) + r' = (?:async )?function\([^\n]*\) \{\n[\s\S]*?^  \};', name)


def constant(name, object_value=False):
    suffix = r'\{\n[\s\S]*?^  \};' if object_value else r'[^\n]+;'
    return extract(r'^  const ' + re.escape(name) + r' = ' + suffix, name)


CSS = '\n'.join(re.findall(r'<style>([\s\S]*?)</style>', HTML))
section_start = HTML.index('<div id="vacPermSection"')
section_end = HTML.index('\n<!-- IDs legacy mantenidos', section_start)
SECTION = HTML[section_start:section_end]
assert SECTION.count('id="boardAvailability"') == 1
assert '<script' not in SECTION.lower(), 'La fixture no debe ejecutar imports de la aplicación'

HELPERS = re.findall(r'^  (?:async )?function (vpAvailability\w+|vpTemporal\w+)\(', HTML, re.M)
DEPENDENCIES = [
    'normaliseActivityText', 'branchKey', 'panelRole', 'panelIsActivityOnlyUser',
    'panelCanOpenModule', 'vacGetEstado', 'vacParseFecha', 'permGetEstado',
    'vpIsAlfredo', 'vpIsCleonRequest', 'vpEsSoporte', 'vpEsCleon', 'vpCorreoActual',
    'vpNormalizarTexto', 'vpDistanciaLevenshtein', 'vpCoincideToken',
    'vpCoincideUsuarioFlexible', 'vpEtapaVisible', 'approvalStageLabel',
    'vpSolicitudEnEtapaFinal', 'vpPuedeGestionarFlujo', 'vpVacacionEnEtapaFinal',
    'vpPuedeEditarVacacion', 'vpPuedeEliminarSolicitud',
    'vpVacacionCleonEstaFinalizada', 'vpPuedeResponderVacacionCleon',
    'alfredoCanManageVacation',
]
hook_start = HTML.index('  // Eventos locales: no listener RTDB')
hook_end = HTML.index('  function vpIsAlfredo()', hook_start)
HOOKS = HTML[hook_start:hook_end]

STUBS = r'''
// Sólo fronteras de sesión/IO son sintéticas; toda clasificación y UI es real.
const NativeDate = window.Date;
let clock = new NativeDate(2026, 10, 10, 11, 0, 0, 0).getTime();
class FrozenDate extends NativeDate {
  constructor(...args) { super(...(args.length ? args : [clock])); }
  static now() { return clock; }
}
window.Date = FrozenDate;
const calls = {get: [], ref: [], writes: [], network: [], listeners: [], intervals: [], notices: []};
function forbidden(bucket, operation) {
  return (...args) => {
    calls[bucket].push({operation, args: args.map(String)});
    throw new Error('IO no autorizado en test offline: ' + operation);
  };
}
const database = {};
const get = forbidden('get', 'get');
const ref = forbidden('ref', 'ref');
const set = forbidden('writes', 'set');
const update = forbidden('writes', 'update');
const remove = forbidden('writes', 'remove');
const push = forbidden('writes', 'push');
const onValue = forbidden('listeners', 'onValue');
window.fetch = forbidden('network', 'fetch');
window.XMLHttpRequest = forbidden('network', 'XMLHttpRequest');
window.WebSocket = forbidden('network', 'WebSocket');
window.EventSource = forbidden('network', 'EventSource');
navigator.sendBeacon = forbidden('network', 'sendBeacon');
window.setInterval = forbidden('intervals', 'setInterval');
window.alert = forbidden('notices', 'alert');
const recordPanelDataUsage = forbidden('writes', 'recordPanelDataUsage');
const auth = {currentUser: {uid: 'administrativo-sintetico', email: 'admin@example.test'}};
let _panelProfile = {rol: 'ADMINISTRATIVO', plaza: 'CHIHUAHUA'};
__AVAILABILITY_STATE__
const authCallbacks = [];
function onAuthStateChanged(unused, callback) { authCallbacks.push(callback); }
'''

FIXTURES = r'''
const created = new Date(2026, 9, 1, 9).getTime();
function vacation(id, name, extra = {}) {
  return {id, _tipo: 'vacaciones', user_email: id + '@example.test',
    nombre_solicitante: name, rol: 'GESTOR', plaza: 'CHIHUAHUA',
    confirmada_empleado: true, approval_stage: 'completado',
    fecha_inicio: '01/11/2026', fecha_fin: '30/11/2026',
    fecha_inicio_aprobada: '09/11/2026', fecha_fin_aprobada: '12/11/2026',
    timestamp_creacion: created, ...extra};
}
function permission(id, name, extra = {}) {
  return {id, _tipo: 'permisos', correo: id + '@example.test', nombre: name,
    rol: 'LIDER A', plaza: 'CHIHUAHUA', estado: 'aprobado_final',
    visto_bueno_cleon: true, approval_stage: 'cleon', dia_completo: false,
    fecha_inicio: '10/11/2026', fecha_regreso: '10/11/2026',
    hora_inicio: '8am', hora_salida: '10:00', hora_regreso: '14:00',
    timestamp: created, ...extra};
}
const fixtureRecords = [
  vacation('vac-return-today', 'Juana Vacaciones Regreso Hoy', {fecha_fin_aprobada: '10/11/2026'}),
  vacation('vac-current', 'Ángela Vacaciones En Curso'),
  permission('perm-past', 'Pedro Permiso Ya Regresó', {hora_salida: '8.30', hora_regreso: '10am'}),
  permission('perm-current', 'Lucía Permiso Parcial Activo', {
    // Las fechas/horas aprobadas prevalecen sobre valores originales distintos.
    fecha_inicio: '01/11/2026', fecha_regreso: '30/11/2026',
    fecha_inicio_aprobada: '10/11/2026', fecha_regreso_aprobada: '10/11/2026',
    hora_inicio_aprobada: 'a las 7 hrs', hora_salida_aprobada: '10.15',
    hora_regreso_aprobada: '2.20pm', dia_completo: true, dia_completo_aprobado: false}),
  permission('perm-overnight', 'Tomás Permiso Multidía', {
    fecha_inicio: '09/11/2026', fecha_regreso: '11/11/2026',
    hora_salida: '16:00', hora_regreso: '09:05'}),
  permission('perm-later', 'Rosa Permiso Sale Más Tarde', {
    hora_salida: '15:10', hora_regreso: '17:45'}),
  vacation('vac-future', 'Carla Vacaciones Futuras Aprobadas', {
    fecha_inicio_aprobada: '20/11/2026', fecha_fin_aprobada: '25/11/2026'}),
  permission('perm-pending', 'PENDIENTE No Es Salida Aprobada', {
    estado: 'pendiente_vobo', visto_bueno_cleon: false, confirmada_empleado: true,
    fecha_inicio: '20/11/2026', fecha_regreso: '20/11/2026'}),
  permission('perm-incomplete', 'INCOMPLETO Sin Hora De Regreso', {hora_regreso: ''}),
  vacation('other-plaza', 'OTRA PLAZA Tampico', {plaza: 'TAMPICO'}),
  permission('cleon-private', 'CLEON PRIVADO', {correo: 'cleon@fredinero.com'}),
  {...vacation('rh-private', 'RH PRIVADO'), _tipo: 'vac_rh', estado: 'aprobada_alfredo'},
];
function seed(records = fixtureRecords, types = ['vacaciones', 'permisos']) {
  _vpAvailabilitySnapshot = {user: auth.currentUser, records, types,
    loadedAt: new Date(2026, 10, 10, 10, 45)};
  _vpAvailabilityBoardSnapshot = {..._vpAvailabilitySnapshot, context: vpAvailabilityContext()};
}
window.availabilityTest = {
  calls,
  at: (hour, minute = 0) => {clock = new NativeDate(2026, 10, 10, hour, minute).getTime();},
  seed,
  login: (role = 'ADMINISTRATIVO', email = 'admin@example.test') => {
    auth.currentUser = {uid: role + '-fixture', email};
    _panelProfile = {rol: role, plaza: 'CHIHUAHUA'};
    authCallbacks.forEach(callback => callback(auth.currentUser));
  },
  logout: () => {auth.currentUser = null; authCallbacks.forEach(callback => callback(null));},
  states: () => Object.fromEntries(_vpData.map(row => [row.id, row._estadoKey])),
  rawCount: () => _vpAvailabilitySnapshot?.records.length,
  authorized: id => vpAvailabilityAuthorized(fixtureRecords.find(row => row.id === id)),
  timer: () => _vpAvailabilityTimer !== null,
};
document.getElementById('vacPermSection').style.display = 'block';
document.getElementById('vpPlaza').value = 'CHIHUAHUA';
seed();
window.renderVacPerm();
'''
SCRIPT = '\n\n'.join([
    STUBS.replace("__AVAILABILITY_STATE__", HTML[HTML.index("  let _vpData = [];"):HTML.index("  function vpAvailabilityContext()")]),
    constant('PANEL_ACTIVITY_ONLY_ROLES'),
    constant('VP_SOPORTE_EMAIL'), constant('VP_CLEON_EMAIL'),
    constant('VAC_ESTADO_CFG', True), constant('PERM_ESTADO_CFG', True),
    *(function(name) for name in dict.fromkeys(HELPERS + DEPENDENCIES)),
    action('vpAvailabilityRefresh'), action('vpAvailabilityLoad'), action('vpAvailabilityInvalidate'), action('renderVacPerm'), HOOKS, FIXTURES,
])

LABELS = ['Ausentes ahora', 'Regreso programado HOY', 'Próximas salidas aprobadas']
INITIAL_NAMES = [
    ['Lucía Permiso Parcial Activo', 'Tomás Permiso Multidía', 'Ángela Vacaciones En Curso'],
    ['Juana Vacaciones Regreso Hoy', 'Pedro Permiso Ya Regresó', 'Lucía Permiso Parcial Activo', 'Rosa Permiso Sale Más Tarde'],
    ['Rosa Permiso Sale Más Tarde', 'Carla Vacaciones Futuras Aprobadas'],
]


def check(condition, message):
    if not condition:
        raise AssertionError(message)


def assert_groups(page, names):
    articles = page.locator('#vpAvailabilityCards > article')
    check(articles.count() == 3, 'Debe haber exactamente tres columnas/grupos reales')
    for index, expected in enumerate(names):
        article = articles.nth(index)
        check(article.locator('h3').inner_text() == f'{LABELS[index]} ({len(expected)})',
              f'Conteo/etiqueta incorrecta: {LABELS[index]}')
        actual = article.locator('li > strong').all_text_contents()
        check(actual == expected, f'{LABELS[index]}: se esperaba {expected}, llegó {actual}')
        check(article.is_visible(), f'Grupo no visible: {LABELS[index]}')


def geometry(page):
    return page.evaluate('''() => {
      const board = document.getElementById('boardAvailability');
      const cards = document.getElementById('vpAvailabilityCards');
      const tableScroller = document.querySelector('#vacPermTableContainer > div');
      const articles = [...cards.children].map(el => {
        const r = el.getBoundingClientRect();
        return {x: r.x, y: r.y, right: r.right, width: r.width,
          clientWidth: el.clientWidth, scrollWidth: el.scrollWidth};
      });
      const rect = board.getBoundingClientRect();
      return {viewport: innerWidth, documentWidth: document.documentElement.scrollWidth,
        boardWidth: board.clientWidth, boardScrollWidth: board.scrollWidth,
        boardRight: rect.right, gridColumns: getComputedStyle(cards).gridTemplateColumns,
        tableScroller: {right: tableScroller.getBoundingClientRect().right,
          clientWidth: tableScroller.clientWidth, scrollWidth: tableScroller.scrollWidth,
          overflowX: getComputedStyle(tableScroller).overflowX},
        articles, offscreenElements: [...document.querySelectorAll('#vacPermSection *')]
          .filter(el => el.getBoundingClientRect().right > innerWidth + 1)
          .slice(0, 12).map(el => ({tag: el.tagName, id: el.id,
            right: Math.round(el.getBoundingClientRect().right)}))};
    }''')


def test_viewport(browser, width):
    context = browser.new_context(viewport={'width': width, 'height': 1100},
                                  locale='es-MX', timezone_id='America/Chihuahua', offline=True)
    requests, errors = [], []
    context.route('**/*', lambda route: route.abort())
    context.on('request', lambda request: requests.append(request.url))
    page = context.new_page()
    page.on('pageerror', lambda error: errors.append(str(error)))
    screenshot = f'/tmp/request-availability-ui-{width}.png'
    result = {'width': width, 'checks': [], 'failures': [], 'screenshot': screenshot}

    def run(name, callback):
        try:
            callback()
            result['checks'].append(name)
        except Exception as error:
            result['failures'].append({'check': name, 'error': str(error)})

    def click_refresh():
        before = page.evaluate('JSON.stringify(availabilityTest.calls)')
        page.get_by_role('button', name='Recalcular sin descargar', exact=True).click()
        check(page.evaluate('JSON.stringify(availabilityTest.calls)') == before,
              'Recalcular hizo lectura, escritura, listener, aviso o solicitud de red')

    def initial():
        assert_groups(page, INITIAL_NAMES)
        text = page.locator('#boardAvailability').inner_text()
        for excluded in ['PENDIENTE', 'INCOMPLETO', 'OTRA PLAZA', 'CLEON PRIVADO', 'RH PRIVADO']:
            check(excluded not in page.locator('#vpAvailabilityCards').inner_text(),
                  f'El resumen expuso {excluded}')
        for label in ['Disponibilidad programada', 'no confirma que la persona ya checó asistencia',
                      'Cobertura: vacaciones, permisos', 'antes del rango de creación',
                      '10:45', '11:00', 'El reloj recalcula sin Firebase',
                      '1 solicitud(es) final(es) sin fecha/hora válida']:
            check(label in text, f'Falta etiqueta/cobertura real: {label}')
        check(page.evaluate('availabilityTest.rawCount()') == 12, 'Se mutó el universo ya cargado')
        check(page.locator('#vacPermSection #boardAvailability #vpAvailabilityCoverage').count() == 1,
              'DOM fuera del alcance vacPermSection')
        states = page.evaluate('availabilityTest.states()')
        check(states['vac-return-today'] == 'gozados', 'Vacación no termina al inicio del regreso')
        check(states['perm-past'] == 'gozados' and states['perm-current'] == 'activo',
              'Permisos antes/después del regreso no tienen estados reales correctos')

    def dates_hours():
        today = page.locator('#vpAvailabilityCards > article').nth(1)
        current = today.locator('li').filter(has_text='Lucía Permiso Parcial Activo')
        check('Salida: 10/11/2026 10:15' in current.inner_text(), 'No prevalece hora/fecha de salida aprobada')
        check('Regreso programado: 10/11/2026 14:20' in current.inner_text(), 'No prevalece hora/fecha de regreso aprobada')
        past = today.locator('li').filter(has_text='Pedro Permiso Ya Regresó')
        check('Salida: 10/11/2026 08:30' in past.inner_text(), 'Hora legacy de salida incorrecta')
        check('Regreso programado: 10/11/2026 10:00' in past.inner_text(), 'Hora legacy de regreso incorrecta')
        vac = today.locator('li').filter(has_text='Juana Vacaciones Regreso Hoy')
        check('Regreso programado: 10/11/2026' in vac.inner_text(), 'Regreso de vacaciones tiene fecha incorrecta')
        row = page.locator('#vacPermTableContainer tbody tr').filter(has_text='Lucía Permiso Parcial Activo')
        cells = row.locator('td')
        check('10/11/2026 → 10/11/2026' in cells.nth(3).inner_text(), 'Tabla no usa fechas aprobadas')
        for label in ['Parcial', 'regreso programado']:
            check(label in cells.nth(3).inner_text(), f'Fechas tabla sin {label}')
        for label in ['Entrada: 07:00', 'Salida: 10:15', 'Regreso programado: 14:20']:
            check(label in cells.nth(4).inner_text(), f'Detalle tabla sin {label}')
        check(cells.nth(5).inner_text() == 'Activo' and cells.nth(6).inner_text() == 'Completada',
              'Tabla no presenta estado/etapa local real')

    def no_overflow():
        value = geometry(page)
        result['geometry'] = value
        check(value['documentWidth'] <= width,
              f'Overflow real de página: scrollWidth={value["documentWidth"]} > viewport={width}; '
              f'elementos={value["offscreenElements"]}')
        check(value['boardScrollWidth'] <= value['boardWidth'] and value['boardRight'] <= width,
              f'Overflow del tablero: {value}')
        check(all(a['scrollWidth'] <= a['clientWidth'] for a in value['articles']),
              'Overflow horizontal en una tarjeta del tablero')
        check(value['tableScroller']['right'] <= width and value['tableScroller']['overflowX'] == 'auto',
              'La tabla ancha no queda contenida en su scroller horizontal real')
        expected_columns = 3 if width == 1440 else 2 if width == 768 else 1
        actual_columns = len({round(a['x']) for a in value['articles']})
        check(actual_columns == expected_columns, f'Grid: {actual_columns} columnas, esperadas {expected_columns}')

    def filter_independence():
        page.locator('#vpEstado').select_option('perm_gozados')
        page.locator('#vpFechaIni').fill('2026-11-10')
        page.locator('#vpFechaFin').fill('2026-11-10')
        click_refresh()
        check(page.locator('#vacPermTableContainer tbody tr').count() == 0,
              'El rango de creación no filtró la tabla')
        assert_groups(page, INITIAL_NAMES)
        page.locator('#vpEstado').select_option('')
        page.locator('#vpFechaIni').fill('')
        page.locator('#vpFechaFin').fill('')
        click_refresh()
        check(page.locator('#vacPermTableContainer th').all_text_contents() ==
              ['Tipo', 'Empleado', 'Rol / Plaza', 'Fechas', 'Detalle', 'Estado', 'Etapa', 'Acciones'],
              'Columnas de la tabla real incorrectas')

    def active_filters():
        page.locator('#vpTipo').select_option('permisos')
        assert_groups(page, [INITIAL_NAMES[0][:2], INITIAL_NAMES[1][1:], INITIAL_NAMES[2][:1]])
        page.locator('#vpRol').select_option('GESTOR')
        assert_groups(page, [[], [], []])
        page.locator('#vpRol').select_option('')
        page.locator('#vpTipo').select_option('')
        page.locator('#vpUsuario').fill('lucia permiso')
        assert_groups(page, [['Lucía Permiso Parcial Activo'], ['Lucía Permiso Parcial Activo'], []])
        page.locator('#vpUsuario').fill('')
        page.locator('#vpPlaza').select_option('TAMPICO')
        assert_groups(page, [['OTRA PLAZA Tampico'], [], []])
        page.locator('#vpPlaza').select_option('CHIHUAHUA')
        click_refresh()
        assert_groups(page, INITIAL_NAMES)

    def partial_coverage():
        page.evaluate("availabilityTest.seed(fixtureRecords.filter(row => row._tipo === 'vacaciones'), ['vacaciones'])")
        click_refresh()
        coverage = page.locator('#vpAvailabilityCoverage').inner_text()
        check('Cobertura: vacaciones, sólo solicitudes autorizadas' in coverage,
              'La cobertura por tipo no es explícita')
        assert_groups(page, [['Ángela Vacaciones En Curso'], ['Juana Vacaciones Regreso Hoy'],
                             ['Carla Vacaciones Futuras Aprobadas']])
        check(page.evaluate('availabilityTest.rawCount()') == 4, 'Se completó indebidamente una carga parcial')
        page.evaluate('availabilityTest.seed()')
        click_refresh()

    def time_boundaries():
        page.evaluate('availabilityTest.at(14, 19)')
        click_refresh()
        assert_groups(page, INITIAL_NAMES)
        page.evaluate('availabilityTest.at(14, 20)')
        click_refresh()
        assert_groups(page, [INITIAL_NAMES[0][1:], INITIAL_NAMES[1], INITIAL_NAMES[2]])
        check(page.evaluate("availabilityTest.states()['perm-current']") == 'gozados',
              'No termina exactamente en hora de regreso aprobada')
        page.locator('#vpEstado').select_option('perm_activo')
        click_refresh()
        check(list(page.evaluate('availabilityTest.states()')) == ['perm-overnight'],
              'Filtro activo no recalcula el buffer en memoria')
        page.locator('#vpEstado').select_option('perm_gozados')
        click_refresh()
        check(set(page.evaluate('availabilityTest.states()')) == {'perm-past', 'perm-current'},
              'Filtro gozados no recalcula permisos ya regresados')
        page.locator('#vpEstado').select_option('')
        page.evaluate('availabilityTest.at(15, 10)')
        click_refresh()
        assert_groups(page, [[INITIAL_NAMES[1][3]] + INITIAL_NAMES[0][1:],
                             INITIAL_NAMES[1], INITIAL_NAMES[2][1:]])
        page.evaluate('availabilityTest.at(11)')
        click_refresh()
        assert_groups(page, INITIAL_NAMES)

    def manager_scope():
        # GERENTE/LIDER/GESTOR son activity-only según la política real vigente.
        # No se fuerza allow=true para fabricar acceso a requests.
        for role in ['GERENTE', 'LIDER A', 'LIDER B', 'LIDER C', 'CANJES', 'GESTOR', 'GESTOR DE COBRANZA']:
            page.evaluate('(role) => {availabilityTest.login(role); availabilityTest.seed(); window.renderVacPerm();}', role)
            check(page.locator('#vpAvailabilityCards > article').count() == 0,
                  f'{role} obtuvo acceso directo al resumen de management')
            check(page.locator('#vacPermTableContainer tbody tr').count() == 0,
                  f'{role} obtuvo acceso directo al buffer de la tabla')
            check(not page.evaluate('availabilityTest.timer()'), f'Timer vivo en sesión no autorizada {role}')
        page.evaluate('availabilityTest.login(); availabilityTest.seed(); window.renderVacPerm();')
        check(not page.evaluate("availabilityTest.authorized('cleon-private')"), 'Cuenta normal ve permisos privados de Cleon')
        check(not page.evaluate("availabilityTest.authorized('rh-private')"), 'Cuenta normal ve vacaciones privadas RH')
        assert_groups(page, INITIAL_NAMES)

    def session_cleanup():
        page.evaluate('availabilityTest.logout()')
        check(page.locator('#vpAvailabilityCards').inner_html() == '', 'Logout no elimina tarjetas')
        check(page.locator('#vacPermTableContainer').inner_html() == '', 'Logout no elimina tabla')
        check(page.evaluate('availabilityTest.rawCount()') is None, 'Logout retiene snapshot anterior')
        check(not page.evaluate('availabilityTest.timer()'), 'Logout no cancela timer')
        page.evaluate('availabilityTest.login(); availabilityTest.seed(); window.renderVacPerm();')
        assert_groups(page, INITIAL_NAMES)

    try:
        page.set_content('<!doctype html><html lang="es"><head><meta charset="utf-8">'
                         '<meta name="viewport" content="width=device-width,initial-scale=1">'
                         '<style>' + CSS + '</style></head><body>' + SECTION + '</body></html>')
        page.add_script_tag(content=SCRIPT)
        run('grupos, estados, aprobación final, cobertura y exclusiones', initial)
        run('fechas/horas aprobadas y detalle real de tabla', dates_hours)
        run('recalcular sin lecturas/escrituras', click_refresh)
        run('estado/rango sólo filtran tabla; columnas reales', filter_independence)
        run('plaza/rol/nombre/tipo filtran resumen con eventos locales', active_filters)
        run('cobertura parcial explícita sin completar por Firebase', partial_coverage)
        run('antes/exactamente después del regreso y salida futura', time_boundaries)
        run('acceso management-only real y privacidad de Cleon/RH', manager_scope)
        run('logout limpia snapshot, tabla, tarjetas y timer', session_cleanup)
        run('grid responsive y ningún overflow horizontal', no_overflow)
        page.screenshot(path=screenshot, full_page=True)
        result['calls'] = page.evaluate('availabilityTest.calls')
        run('cero IO en toda la ejecución', lambda: check(
            all(not value for value in result['calls'].values()), f'IO detectado: {result["calls"]}'))
    except Exception as error:
        result['failures'].append({'check': 'montaje/ejecución', 'error': str(error),
                                   'traceback': traceback.format_exc()})
        try:
            page.screenshot(path=screenshot, full_page=True)
        except Exception:
            pass
    run('sin pageerrors', lambda: check(not errors, f'Errores de página: {errors}'))
    run('sin intentos de red', lambda: check(not requests, f'Intentos de red: {requests}'))
    result['pageerrors'] = errors
    result['network_requests'] = requests
    context.close()
    result['passed'] = not result['failures']
    return result


AUTO_IO = r'''
let autoReads = 0, autoMaximum = 0;
const autoCalls = [];
let autoStore = {};
function autoValue(route) {
  const root = route.startsWith('cleon_solicitudes/vacaciones') ? 'cleon_solicitudes/vacaciones' : route.split('/')[0];
  let value = autoStore[root] || null;
  for (const part of route.slice(root.length + 1).split('/').filter(Boolean)) value = value?.[part] ?? null;
  return value;
}
async function autoRead(route, kind) {
  autoReads++; autoMaximum = Math.max(autoMaximum, autoReads);
  try {
    await new Promise(resolve => setTimeout(resolve, 0));
    let value = autoValue(route);
    if (kind === 'REST_SHALLOW') value = value && Object.fromEntries(Object.keys(value).map(key => [key, true]));
    autoCalls.push({kind, path: route, payload: value}); return value;
  } finally {autoReads--;}
}
const get = async route => {const value = await autoRead(route, 'SDK_SCALAR'); return {val: () => value};};
const ref = (db, route) => route === undefined ? {toString: () => 'https://offline.example.test'} : route;
window.fetch = async (url, options) => {
  const parsed = new URL(url);
  if (parsed.origin !== 'https://offline.example.test' || parsed.searchParams.get('auth') !== 'OFFLINE_FAKE_ID_TOKEN' || parsed.searchParams.get('shallow') !== 'true' || [...parsed.searchParams.keys()].length !== 2 || options.credentials !== 'omit') throw Error('REST no autorizado');
  const value = await autoRead(decodeURIComponent(parsed.pathname.slice(1, -5)), 'REST_SHALLOW');
  return {ok: true, json: async () => value};
};
function setPanelHeader() {}
function showPanelModuleDenied() {}
'''
AUTO_STUBS = STUBS.replace("const get = forbidden('get', 'get');", '').replace("const ref = forbidden('ref', 'ref');", '').replace("window.fetch = forbidden('network', 'fetch');", '').replace("email: 'admin@example.test'}", "email: 'admin@example.test', getIdToken: async () => 'OFFLINE_FAKE_ID_TOKEN'}")
AUTO_FIXTURE = FIXTURES[:FIXTURES.index("document.getElementById('vacPermSection').style.display = 'block';")] + r'''
autoStore = {
  vacation_requests: Object.fromEntries(fixtureRecords.filter(row => row._tipo === 'vacaciones').map(row => [row.id, {...row, motivo: 'NO DESCARGAR', fotos: ['PRIVADO']} ])),
  permission_requests: Object.fromEntries(fixtureRecords.filter(row => row._tipo === 'permisos').map(row => [row.id, {...row, bitacora: 'PRIVADO'}])),
};
document.getElementById('vacPermSection').style.display = 'none';
document.getElementById('vpPlaza').value = 'CHIHUAHUA';
window.autoTest = {calls: autoCalls, maximum: () => autoMaximum, board: () => _vpAvailabilityBoardSnapshot, table: () => _vpAvailabilitySnapshot};
'''
AUTO_SCRIPT = SCRIPT.replace(STUBS.replace("__AVAILABILITY_STATE__", HTML[HTML.index("  let _vpData = [];"):HTML.index("  function vpAvailabilityContext()")]), AUTO_STUBS.replace("__AVAILABILITY_STATE__", HTML[HTML.index("  let _vpData = [];"):HTML.index("  function vpAvailabilityContext()")]) + '\n' + AUTO_IO).replace(FIXTURES, action('showVacPerm') + '\n' + AUTO_FIXTURE)


def test_auto_viewport(browser, width):
    context = browser.new_context(viewport={'width': width, 'height': 1100}, locale='es-MX', timezone_id='America/Chihuahua', offline=True)
    context.route('**/*', lambda route: route.abort())
    requests, errors = [], []
    context.on('request', lambda request: requests.append(request.url))
    page = context.new_page()
    page.on('pageerror', lambda error: errors.append(str(error)))
    result = {'width': width, 'mode': 'apertura automática real; SDK/REST/token fake offline', 'failures': []}
    try:
        extras = ''.join(f'<div id="{id}"></div>' for id in ['app', 'moduleLanding', 'attendanceWorkspace', 'activitiesSection', 'alfredoSection'])
        page.set_content('<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + CSS + '</style></head><body>' + extras + SECTION + '</body></html>')
        page.add_script_tag(content=AUTO_SCRIPT)
        check(page.evaluate('autoTest.calls.length') == 0, 'Se descargó antes de abrir el módulo')
        page.evaluate('async () => {await window.showVacPerm();}')
        assert_groups(page, INITIAL_NAMES)
        check(page.evaluate('autoTest.table()') is None, 'Auto cargó snapshot completo para tabla')
        check(page.locator('#vacPermTableContainer tbody tr').count() == 0, 'Auto creó acciones/filas de tabla')
        colors = page.evaluate('''() => ({departure: getComputedStyle(document.querySelector('.vp-av-departure')).color, returning: getComputedStyle(document.querySelector('.vp-av-return')).color, chips: [...document.querySelectorAll('.vp-av-chip')].map(el => ({text: el.textContent, color: getComputedStyle(el).backgroundColor}))})''')
        check(colors['departure'] == 'rgb(185, 28, 28)' and colors['returning'] == 'rgb(21, 128, 61)', 'Salida/regreso no son rojo/verde')
        check(len({c['color'] for c in colors['chips']}) >= 3, 'Burbujas de plaza, rol y tipo no diferenciadas')
        before = page.evaluate('autoTest.calls.length')
        page.get_by_role('button', name='Recalcular sin descargar', exact=True).click()
        page.locator('#vpTipo').select_option('permisos')
        page.locator('#vpTipo').select_option('')
        page.evaluate('async () => {document.getElementById("vacPermSection").style.display="none"; await Promise.resolve(); await window.showVacPerm();}')
        check(page.evaluate('autoTest.calls.length') == before, 'Reabrir/filtros/recalcular no reutilizó caché')
        page.get_by_role('button', name='Actualizar disponibilidad', exact=True).click()
        page.wait_for_function('autoTest.board() !== null')
        check(page.evaluate('autoTest.calls.length') == before * 2, 'Actualización mínima no hizo una sola recarga')
        result['requests'] = page.evaluate('autoTest.calls')
        result['maxConcurrent'] = page.evaluate('autoTest.maximum()')
        check(result['maxConcurrent'] <= 6, 'Concurrencia superó seis')
        check('NO DESCARGAR' not in json.dumps(result['requests']) and 'PRIVADO' not in json.dumps(result['requests']), 'Auto descargó detalles/fotos')
        check(not requests and not errors, f'Red real o errores: {requests} {errors}')
        result['requestCounts'] = {kind: sum(c['kind'] == kind for c in result['requests']) for kind in ['REST_SHALLOW', 'SDK_SCALAR']}
        result['colors'] = colors
        result['screenshot'] = f'/tmp/request-availability-auto-ui-{width}.png'
        page.screenshot(path=result['screenshot'], full_page=True)
    except Exception as error:
        result['failures'].append({'error': str(error), 'traceback': traceback.format_exc()})
    result['passed'] = not result['failures']
    context.close()
    return result


def main():
    report = {'boundary': 'CSS/DOM/helpers/access policy/render real; sesión y carga en memoria sintéticas',
              'network': 'Playwright offline + route abort; ejecutar dentro de unshare --net',
              'clock': '2026-11-10 11:00 America/Chihuahua; límites 14:19 / 14:20 / 15:10',
              'results': []}
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path='/usr/bin/chromium',
                                             headless=True, args=['--no-sandbox'])
        for width in WIDTHS:
            report['results'].append(test_viewport(browser, width))
            report['results'].append(test_auto_viewport(browser, width))
        browser.close()
    report['passed'] = all(result['passed'] for result in report['results'])
    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    sys.exit(main())
