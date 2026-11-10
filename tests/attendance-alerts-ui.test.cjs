'use strict';

// Regresiones del panel estático. DOM/RTDB sintéticos: nunca se ejecuta Firebase,
// ni se leen datos reales. Chromium sólo recibe CSS/HTML y helpers de alertas.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const html = readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const alertSource = html.match(/^  \/\/ ── Alertas \/ Inconsistencias[^\n]*\n([\s\S]*?)^  \/\/ ── Descarga masiva de fotos/m)[1];
const alertHtml = html.split('    <!-- Alertas / Inconsistencias -->')[1].split('    <!-- Gráficas -->')[0];
const fn = name => {
  const match = html.match(new RegExp(`^  (?:async )?function ${name}\\([^\\n]*\\) \\{(?:[^\\n]*\\}$|\\n[\\s\\S]*?^  \\})`, 'm'));
  assert.ok(match, `Función real ${name}`);
  return match[0];
};
const plazas = html.match(/^  const PANEL_PLAZAS = [^\n]+;/m)[0];
const helpers = ['activityText', 'normaliseActivityText', 'branchKey'].map(fn).join('\n');
const plain = value => JSON.parse(JSON.stringify(value));
const fixedNow = new Date(2026, 10, 10, 0, 15).getTime();
class LocalDate extends Date {
  constructor(...args) { super(...(args.length ? args : [fixedNow])); }
  static now() { return fixedNow; }
}
function harness({ records = [], users = {}, trips = {} } = {}) {
  const nodes = {}, reads = [], forbidden = [];
  const node = id => nodes[id] ||= {
    value: '', textContent: '', innerHTML: '', className: '', style: {}, attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    classList: { toggle() {} },
  };
  const deny = name => () => { forbidden.push(name); throw new Error(`Prohibido ${name}`); };
  const context = vm.createContext({
    Date: LocalDate, console, window: {}, document: { getElementById: node }, database: {},
    fetch: deny('fetch'), set: deny('set'), update: deny('update'), remove: deny('remove'),
    push: deny('push'), onValue: deny('onValue'), setInterval: deny('setInterval'),
    ref: (_, route) => route,
    orderByChild: field => ({ type: 'orderByChild', field }),
    startAt: value => ({ type: 'startAt', value }), endAt: value => ({ type: 'endAt', value }),
    query: (route, ...constraints) => ({ route, constraints }),
    get: async request => {
      reads.push(plain(request));
      assert.equal(request.route, 'vehicle_trips', 'Sólo la consulta de viajes ya existente');
      const start = request.constraints.find(c => c.type === 'startAt').value;
      const end = request.constraints.find(c => c.type === 'endAt').value;
      const filtered = Object.entries(trips).filter(([, row]) => row.timestamp_inicio >= start && row.timestamp_inicio <= end);
      return { exists: () => filtered.length > 0, forEach: cb => filtered.forEach(([key, row]) => cb({ key, val: () => row })) };
    },
    renderStats() {}, renderCards() {}, renderCharts: async () => {},
    renderOutsideBranchReport() {}, renderTripRoutesReport() {},
  });
  vm.runInContext([helpers, plazas, alertSource, fn('filterAndRender'),
    `let allRecords = ${JSON.stringify(records)}, usersMap = ${JSON.stringify(users)};`,
    'globalThis.api = { renderAlerts, alertDate, alertTimestampDate, alertPlazaChip, filterAndRender };',
  ].join('\n'), context);
  node('fechaInicio').value = '2026-11-01'; node('fechaFin').value = '2026-11-10';
  return { ...context.api, window: context.window, node, nodes, reads, forbidden };
}
function entry(uid, fecha = '2026-11-05', extra = {}) {
  return { uid, fecha, tipo: 'ENTRADA', nombre: `Persona ${uid}`, plaza: 'CHIHUAHUA', puesto: 'GESTOR', ...extra };
}
function trip(id, date = [2026, 10, 6, 9], extra = {}) {
  return { id, uid: id, nombre: `Viaje ${id}`, plaza: 'CHIHUAHUA', km_inicio: 0, timestamp_inicio: new Date(...date).getTime(), fecha_viaje: '06/11/2026', hora_inicio: '09:00', ...extra };
}
const total = h => Number(h.node('alertsTotalBadge').innerHTML.match(/>(\d+)<\/span>/)[1]);
const count = (h, id) => Number(h.node(id).textContent);

test('HTML y lógica de inconsistencias contienen sólo entrada sin salida y viaje sin fin', () => {
  assert.equal((alertHtml.match(/class="alert-card(?: info)?"/g) || []).length, 2);
  assert.doesNotMatch(alertHtml + alertSource, /salidaSinEntrada|listSalidaSinEntrada|badgeSalidaSinEntrada|Salida sin Entrada/i);
  assert.match(alertHtml, /aria-live="polite" aria-atomic="true"/);
  const h = harness();
  h.renderAlerts([entry('sólo-salida', undefined, { tipo: 'SALIDA' }), entry('entrada')], [trip('viaje')]);
  assert.equal(total(h), 2);
  assert.equal(count(h, 'badgeEntradaSinSalida'), 1);
  assert.equal(count(h, 'badgeViajeSinFin'), 1);
  assert.equal(h.nodes.listSalidaSinEntrada, undefined);
});

test('fechas estrictas, días locales Jueves/Viernes y validación de bisiestos sin rollover', () => {
  const h = harness();
  for (const [date, weekday, key] of [
    ['2026-11-05', 'Jueves', '2026-11-05'], ['05-11-2026', 'Jueves', '2026-11-05'],
    ['05/11/2026', 'Jueves', '2026-11-05'], ['2026-11-06', 'Viernes', '2026-11-06'],
    ['06/11/2026', 'Viernes', '2026-11-06'], ['2024-02-29', 'Jueves', '2024-02-29'],
    ['2000-02-29', 'Martes', '2000-02-29'],
  ]) {
    assert.deepEqual(plain(h.alertDate(date)), { key, label: `${date} · ${weekday}` });
  }
  for (const invalid of [null, undefined, 20261105, '', '2026-11-5', '5/11/2026', '2026/11/05',
    '11/06-2026', '2026-11-05T00:00:00Z', ' 2026-11-05', '2026-11-05 ', '2026-02-29',
    '1900-02-29', '2026-04-31', '2026-00-10', '2026-13-01', '2026-11-00', '2026-11-32', '0000-01-01',
  ]) assert.equal(h.alertDate(invalid), null, String(invalid));
  assert.equal(h.alertDate('0099-11-05').key, '0099-11-05', 'No coerción especial del año 0..99');
});

test('fechas equivalentes se emparejan, hoy local queda excluido y lista reciente primero', () => {
  const h = harness();
  const input = [entry('viejo', '2026-11-04'), entry('reciente', '06/11/2026'), entry('medio'),
    entry('par', '2026-11-05'), entry('par', '05-11-2026', { tipo: 'SALIDA' }),
    entry('hoy-iso', '2026-11-10'), entry('hoy-dmy', '10/11/2026'), entry('hoy-guion', '10-11-2026'),
    entry('inválida', '2026-02-30')];
  const before = plain(input);
  h.renderAlerts(input, []);
  assert.equal(count(h, 'badgeEntradaSinSalida'), 3);
  const output = h.node('listEntradaSinSalida').innerHTML;
  assert.ok(output.indexOf('Persona reciente') < output.indexOf('Persona medio'));
  assert.ok(output.indexOf('Persona medio') < output.indexOf('Persona viejo'));
  assert.match(output, /06\/11\/2026 · Viernes/); assert.match(output, /2026-11-05 · Jueves/);
  assert.doesNotMatch(output, /Persona (par|hoy|inválida)/);
  assert.deepEqual(input, before, 'No mutar el origen');
});

test('usuarios sin UID no se mezclan, homónimos con UID distinto siguen siendo personas distintas', () => {
  const h = harness();
  h.renderAlerts([
    entry(undefined, undefined, { nombre: 'Ana' }), entry(undefined, undefined, { nombre: 'Luis', tipo: 'SALIDA' }),
    entry('', undefined, { nombre: 'Sin ID' }), entry('   '),
    entry('a', undefined, { nombre: 'Homónimo' }), entry('b', undefined, { nombre: 'Homónimo', tipo: 'SALIDA' }),
    entry('__proto__'), entry('a|2026-11-05'),
  ], []);
  assert.equal(count(h, 'badgeEntradaSinSalida'), 3);
  assert.doesNotMatch(h.node('listEntradaSinSalida').innerHTML, /Ana|Luis|Sin ID/);
  assert.match(h.node('listEntradaSinSalida').innerHTML, /Homónimo/);
});

test('viajes: km_inicio cero válido; km_fin cero cerrado; hoy/fechas inválidas excluidos y orden reciente', () => {
  const h = harness();
  const rows = [trip('antiguo', [2026, 10, 4], { fecha_viaje: '04/11/2026' }), trip('reciente'),
    trip('cero', undefined, { km_fin: 0 }), trip('cerrado', undefined, { km_fin: 12 }),
    trip('sin-inicio', undefined, { km_inicio: undefined }),
    trip('hoy', [2026, 10, 10, 0, 5], { fecha_viaje: '10/11/2026' }),
    trip('hoy-civil', undefined, { timestamp_inicio: null, fecha_viaje: '10/11/2026' }),
    trip('inválido', undefined, { timestamp_inicio: 'no fecha', fecha_viaje: '31/02/2026' }),
    trip('sin-fecha', undefined, { timestamp_inicio: null, fecha_viaje: null }),
    trip('civil', undefined, { timestamp_inicio: null, fecha_viaje: '05-11-2026' }),
  ];
  h.renderAlerts([], rows);
  assert.equal(count(h, 'badgeViajeSinFin'), 3);
  const output = h.node('listViajeSinFin').innerHTML;
  assert.ok(output.indexOf('Viaje reciente') < output.indexOf('Viaje civil'));
  assert.ok(output.indexOf('Viaje civil') < output.indexOf('Viaje antiguo'));
  assert.match(output, /06\/11\/2026 · Viernes/);
  assert.doesNotMatch(output, /Viaje (cero|cerrado|hoy|inválido|sin-)/);
  const midnight = new Date(2026, 10, 6, 0, 5).getTime();
  assert.equal(h.alertTimestampDate(midnight).key, '2026-11-06', 'No desplazamiento UTC');
  for (const invalid of [null, undefined, '', 'texto', true, Infinity]) assert.equal(h.alertTimestampDate(invalid), null);
});

test('chips reutilizan clase/paleta existente y escapan todos los textos controlados por usuario', () => {
  const h = harness();
  assert.match(h.alertPlazaChip(' Chihuáhua '), /class="chip alert-plaza chip-CHIHUAHUA">CHIHUAHUA/);
  assert.match(h.alertPlazaChip('TAMPICO'), /chip-TAMPICO/);
  assert.match(h.alertPlazaChip(''), /alert-plaza unknown">Sin plaza/);
  const malicious = '<img src=x onerror="alert(1)"> & \'prueba\'';
  h.renderAlerts([entry('a', undefined, { nombre: malicious, plaza: malicious, puesto: malicious })],
    [trip('b', undefined, { nombre: malicious, plaza: malicious, puesto: malicious, hora_inicio: malicious })]);
  const output = h.node('listEntradaSinSalida').innerHTML + h.node('listViajeSinFin').innerHTML;
  assert.doesNotMatch(output, /<img|<script|class="[^"]*onerror/);
  assert.match(output, /&lt;img/); assert.match(output, /&quot;/); assert.match(output, /&amp;/); assert.match(output, /&#039;/);
});

test('subtotal respeta categorías visibles y total cero/dos/tres dígitos accesible', () => {
  const h = harness();
  const rows = Array.from({ length: 120 }, (_, i) => entry(`u${i}`));
  h.renderAlerts(rows, [trip('b')], 'ENTRADA');
  assert.equal(total(h), 121);
  assert.equal(h.node('badgeEntradaSinSalida').attributes['aria-label'], '120 entradas sin salida');
  assert.match(h.node('alertsTotalBadge').innerHTML, /aria-label="121 inconsistencias del período">121/);
  h.renderAlerts(rows, [trip('b')], 'SALIDA');
  assert.equal(total(h), 1); assert.equal(count(h, 'badgeEntradaSinSalida'), 0);
  h.renderAlerts([], []);
  assert.equal(total(h), 0);
  assert.match(h.node('alertsTotalBadge').innerHTML, /alert-badge zero.*aria-label="0 inconsistencias del período">0/);
  assert.deepEqual(h.forbidden, []);
  assert.equal(h.reads.length, 0, 'renderAlerts no lee red');
});

test('callsite real conserva ambos tipos del mismo rango/plaza/rol/usuario sin nuevas consultas', async () => {
  const users = {
    matched: { nombre_completo: 'Ana objetivo', correo: 'ana@example.test', plaza: ' chihuahua ', rol: 'GESTOR' },
    open: { nombre_completo: 'Ana pendiente', plaza: 'CHIHUAHUA', rol: 'GESTOR' },
    plaza: { nombre_completo: 'Ana otra plaza', plaza: 'TAMPICO', rol: 'GESTOR' },
    role: { nombre_completo: 'Ana otro rol', plaza: 'CHIHUAHUA', rol: 'GERENTE' },
    user: { nombre_completo: 'Luis ajeno', plaza: 'CHIHUAHUA', rol: 'GESTOR' },
  };
  const records = [
    { user_uid: 'matched', tipo: 'ENTRADA', timestamp: new Date(2026, 10, 5, 8).getTime() },
    { user_uid: 'matched', tipo: 'SALIDA', timestamp: new Date(2026, 10, 5, 18).getTime() },
    ...['open', 'plaza', 'role', 'user'].map(user_uid => ({ user_uid, tipo: 'ENTRADA', timestamp: new Date(2026, 10, 6, 8).getTime() })),
  ];
  const trips = Object.fromEntries(['open', 'plaza', 'role', 'user'].map(user_uid => [user_uid, { user_uid, km_inicio: 0, timestamp_inicio: new Date(2026, 10, 6, 9).getTime() }]));
  trips.outsideRange = { user_uid: 'open', km_inicio: 0, timestamp_inicio: new Date(2026, 9, 1).getTime() };
  const h = harness({ records, users, trips });
  h.node('filtroTipo').value = 'ENTRADA'; h.node('filtroPlaza').value = 'CHIHUAHUA';
  h.node('filtroRol').value = 'GESTOR'; h.node('filtroUsuario').value = 'ana';
  await h.filterAndRender();
  assert.equal(h.window.__filteredRecords.length, 2, 'Listado mantiene filtro ENTRADA');
  assert.equal(count(h, 'badgeEntradaSinSalida'), 1, 'Entrada con salida no produce falso positivo');
  assert.equal(count(h, 'badgeViajeSinFin'), 1); assert.equal(total(h), 2);
  assert.match(h.node('listEntradaSinSalida').innerHTML, /Ana pendiente/);
  assert.doesNotMatch(h.node('listEntradaSinSalida').innerHTML, /objetivo|otra plaza|otro rol|ajeno/);
  assert.equal(h.reads.length, 1, 'Sólo get(vehicle_trips) preexistente');
  assert.deepEqual(h.reads[0].constraints.map(c => c.type), ['orderByChild', 'startAt', 'endAt']);
  assert.deepEqual(h.forbidden, []);
});

test('Chromium offline: badge 0/1/26/120/999 sin recorte, contraste AA y layout responsive', t => {
  const available = spawnSync('python3', ['-c', 'import playwright.sync_api'], { encoding: 'utf8' });
  if (available.status !== 0) { t.skip('Playwright Python no instalado; las regresiones funcionales no requieren navegador'); return; }
  const python = String.raw`
import json, sys
from pathlib import Path
from playwright.sync_api import sync_playwright
payload = json.load(sys.stdin)
with sync_playwright() as p:
    executable = '/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None
    browser = p.chromium.launch(executable_path=executable, headless=True, args=['--no-sandbox'])
    context = browser.new_context(viewport={'width': 1440, 'height': 1000}, offline=True)
    requests = []
    context.route('**/*', lambda route: (requests.append(route.request.url), route.abort()))
    page = context.new_page()
    page.set_content('<!doctype html><html><head><style>' + payload['css'] + '</style></head><body>' + payload['html'] + '</body></html>')
    page.add_script_tag(content=payload['source'])
    for width in [360, 760, 1200, 1440]:
        page.set_viewport_size({'width': width, 'height': 1000})
        for number in [0, 1, 26, 120, 999]:
            page.evaluate('''n => {
                const entries = Array.from({length: n}, (_, i) => ({uid: 'u'+i, fecha: '2026-11-05', tipo: 'ENTRADA', nombre: 'Persona '+i, plaza: ' chihuahua ', puesto: 'GESTOR'}));
                renderAlerts(entries, []);
                document.getElementById('alertsGrid').style.display = 'grid';
            }''', number)
            result = page.evaluate('''() => {
                const badge = document.querySelector('#alertsTotalBadge .alert-badge');
                const rect = badge.getBoundingClientRect(), css = getComputedStyle(badge);
                const range = document.createRange(); range.selectNodeContents(badge);
                const text = range.getBoundingClientRect();
                const luminosity = color => {
                    const channels = color.match(/[\\d.]+/g).slice(0, 3).map(Number).map(x => x/255).map(x => x<=.04045 ? x/12.92 : ((x+.055)/1.055)**2.4);
                    return .2126*channels[0] + .7152*channels[1] + .0722*channels[2];
                };
                const fg = luminosity(css.color), bg = luminosity(css.backgroundColor);
                const chip = document.querySelector('.alert-plaza');
                return { font: css.fontSize, width: rect.width, height: rect.height,
                    textFits: text.left >= rect.left && text.right <= rect.right && text.top >= rect.top && text.bottom <= rect.bottom,
                    contrast: (Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05),
                    columns: getComputedStyle(document.getElementById('alertsGrid')).gridTemplateColumns.split(' ').length,
                    chipColor: chip ? getComputedStyle(chip).backgroundColor : null,
                    overflow: document.documentElement.scrollWidth > innerWidth,
                    text: badge.textContent, aria: badge.getAttribute('aria-label') };
            }''')
            assert result['font'] == '12px', result
            assert result['height'] >= 24 and result['width'] >= 24 and result['textFits'], result
            assert result['contrast'] >= 4.5, result
            assert result['columns'] == (1 if width <= 900 else 2), result
            assert not result['overflow'], result
            assert result['text'] == str(number) and result['aria'] == str(number)+' inconsistencias del período', result
            if number: assert result['chipColor'] == 'rgb(14, 116, 144)', result
    page.set_viewport_size({'width': 1440, 'height': 1000})
    page.evaluate('''() => { renderAlerts(Array.from({length:26}, (_,i)=>({uid:'u'+i, fecha:i%2?'2026-11-05':'2026-11-06', tipo:'ENTRADA', nombre:'Persona '+i, plaza:i%2?'TAMPICO':'CHIHUAHUA', puesto:'GESTOR'})), []); }''')
    page.screenshot(path='/tmp/attendance-alerts-ui-offline.png', full_page=True)
    assert not requests, requests
    print(json.dumps({'checks': 20, 'networkRequests': len(requests), 'screenshot': '/tmp/attendance-alerts-ui-offline.png'}))
    browser.close()
`;
  const result = spawnSync('python3', ['-c', python], {
    input: JSON.stringify({ css: [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n'), html: alertHtml, source: helpers + '\n' + plazas + '\n' + alertSource }),
    encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  const report = JSON.parse(result.stdout.trim());
  assert.equal(report.checks, 20); assert.equal(report.networkRequests, 0);
});
