#!/usr/bin/env python3
"""Filtros enlazados REALES: prefijo del range harness, Leaflet local, SDK offline.
No modifica index ni range.browser. Falla explícitamente si falta el contrato.
LEAFLET_TEST_ASSET_DIR=/home/ubuntu/fredinero-indice-diario-preparacion-20261118/tests/vendor python3 tests/activity-routes-visibility.browser.py
"""
import json
import os
import re
import hashlib
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
RANGE = ROOT / 'tests/activity-routes-range.browser.py'
# Ejecutar sólo las utilidades de extracción y SCRIPT real: jamás la suite range.
prefix = RANGE.read_text().split('reports=[]', 1)[0]
assert 'SCRIPT=' in prefix and 'with sync_playwright()' not in prefix
module = {'__file__': str(RANGE), '__name__': 'activity_routes_range_extraction'}
exec(compile(prefix, str(RANGE) + '[extraction-only]', 'exec'), module)
HTML, SCRIPT, CSS, CONTROLS, MODAL, VENDOR = (module[k] for k in ['HTML', 'SCRIPT', 'CSS', 'CONTROLS', 'MODAL', 'VENDOR'])
assert re.search(r'function activityRoutesVisibility\(', HTML), 'CONTRACT MISSING: activityRoutesVisibility; incorporar y reejecutar'
for hook in ['data-route-visible-index', 'data-route-visibility-action', 'data-route-filter-count', 'data-route-user-count', 'data-route-visible-total', 'data-route-filter-total']:
    dataset_key = re.sub(r'-([a-z])', lambda m: m[1].upper(), hook.removeprefix('data-'))
    assert hook in HTML or 'dataset.' + dataset_key in HTML, 'CONTRACT MISSING: ' + hook
assert 'activityRoutesVisibility' in module['NAMES'], 'Actualizar NAMES de integración antes de ejecutar browser'
# Único ajuste del SDK SIMULADO: validar los dos días de la fixture manual.
# La consulta y funciones productivas siguen siendo extraídas literalmente.
old_bounds = "const min=firebasePushIdBoundary(new Date('2026-11-15T00:00:00').getTime(),'-'),max=firebasePushIdBoundary(new Date('2026-11-17T23:59:59.999').getTime(),'z');"
new_bounds = "const min=firebasePushIdBoundary(new Date(document.getElementById('activityStartDate').value+'T00:00:00').getTime(),'-'),max=firebasePushIdBoundary(new Date(document.getElementById('activityEndDate').value+'T23:59:59.999').getTime(),'z');"
assert old_bounds in SCRIPT
SCRIPT = SCRIPT.replace(old_bounds, new_bounds)
TEST_API = r'''
window.visibilityTest = {
 sourceBefore: null, storeBefore: null,
 capture() { this.sourceBefore=JSON.stringify(window.__activityRouteGroups);this.storeBefore=JSON.stringify(store); },
 unchanged() { return this.sourceBefore===JSON.stringify(window.__activityRouteGroups)&&this.storeBefore===JSON.stringify(store); },
 custom(kind) {
  window.closeActivityRoutesMap();resetActivityLocationCache();
  store.gestor_activities={};store.activity_summaries={plazas:{TAMPICO:{}}};
  document.getElementById('activityStartDate').value='2026-11-17';document.getElementById('activityEndDate').value='2026-11-18';document.getElementById('activityUser').value='';
  const evil='<img src=x onerror="window.__visibilityInjected=1"> & <svg onload="window.__visibilityInjected=2">';
  function add(uid,name,day,count) {
   for(let i=0;i<count;i++) {
    const ts=new Date(day+'T10:00:00').getTime()+i*60000;
    const id=makeId(ts, Object.keys(store.gestor_activities).length);
    const row={tipo:i%2?'GENERAL':'COBRANZA',created_at:ts,user_uid:uid,uid,nombre_usuario:name,correo_usuario:uid+'@example.test',rol:'GESTOR',plaza:'TAMPICO',gestion_realizada:i%2?'Llamáda':'Visita',tiene_evidencia:false};
    if(kind==='malicious') { row.nombre_usuario=evil;row.rol=evil;row.gestion_realizada=evil; }
    store.activity_summaries.plazas.TAMPICO[id]=row;store.gestor_activities[id]={...row,latitud:22.2+i/1000,longitud:-97.8};
   }
  }
  if(kind==='vanessa'){add('vanessa','Vanessa','2026-11-17',13);add('vanessa','Vanessa','2026-11-18',4);add('otro','Otro','2026-11-18',7);}
  else if(kind==='blanco'){add('blanco','Blanco','2026-11-17',7);add('otro','Otros usuarios','2026-11-17',351);}
  else if(kind==='malicious'){add('safe-uid',evil,'2026-11-17',7);}
  else throw Error('Unknown fixture '+kind);
 },
 inspect() {
  const groups=window.__activityRouteGroups||[],userFilters=buildActivityRouteUserFilters(groups),managementFilters=buildActivityRouteManagementFilters(groups);
  const users=new Set(Array.from(document.querySelectorAll('[data-route-user-index]')).filter(i=>i.checked).map(i=>userFilters[Number(i.dataset.routeUserIndex)].key));
  const managements=new Set(Array.from(document.querySelectorAll('[data-route-filter-index]')).filter(i=>i.checked).map(i=>managementFilters[Number(i.dataset.routeFilterIndex)].key));
  const routeInputs=Array.from(document.querySelectorAll('[data-route-visible-index]'));
  const routes=new Set(routeInputs.filter(i=>i.checked).map(i=>i.dataset.routeKey));
  const visible=groups.flatMap(g=>g.records.filter(r=>users.has(activityRouteIdentity(r))&&managements.has(normaliseActivityText(activityRouteManagement(r)))&&routes.has(g.key)));
  const countText=node=>Number((node?.textContent||'').match(/\d+/)?.[0]||0);
  const actualMarkers=[],paths=[],popupHtml=[];
  activityRoutesMapInstance.eachLayer(layer=>{
   if(layer instanceof L.Marker){actualMarkers.push([layer.getLatLng().lat,layer.getLatLng().lng]);popupHtml.push(layer.getPopup()?.getContent()||'');}
   if(layer instanceof L.Polyline && !(layer instanceof L.Polygon))paths.push(layer.getLatLngs().map(p=>[p.lat,p.lng]));
  });
  const expectedPaths=[],rows=[];
  for(const group of groups){
   if(!group.records.some(r=>users.has(activityRouteIdentity(r))))continue;
   const records=group.records.filter(r=>users.has(activityRouteIdentity(r))&&managements.has(normaliseActivityText(activityRouteManagement(r)))&&routes.has(group.key));
   const metrics=calculateActivityRouteMetrics(records);
   if(records.length>1){const points=records.map(r=>[Number(r.latitud),Number(r.longitud)]);expectedPaths.push(points,points);}
   const input=routeInputs.find(i=>i.dataset.routeKey===group.key);
   rows.push({key:group.key,expected:records.length,selected:routes.has(group.key),text:input?.closest('label')?.textContent||'',expectedDistance:formatActivityDistance(metrics.totalMeters),meters:metrics.totalMeters});
  }
  return {
   total:visible.length,legendTotal:Number(document.querySelector('[data-route-visible-total]')?.dataset.routeVisibleTotal),filterTotal:Number(document.querySelector('[data-route-filter-total]')?.dataset.routeFilterTotal),
   actualMarkers,expectedMarkers:visible.map(r=>[Number(r.latitud),Number(r.longitud)]),paths,expectedPaths,rows,
   managements:managementFilters.map((f,index)=>({index,key:f.key,label:f.label,expected:visible.filter(r=>normaliseActivityText(activityRouteManagement(r))===f.key).length,actual:countText(document.querySelector('[data-route-filter-count="'+index+'"]'))})),
   users:userFilters.map((f,index)=>({index,key:f.key,label:f.label,expected:visible.filter(r=>activityRouteIdentity(r)===f.key).length,actual:countText(document.querySelector('[data-route-user-count="'+index+'"]'))})),
   checkedRoutes:routeInputs.filter(i=>i.checked).map(i=>i.dataset.routeKey),routeKeys:routeInputs.map(i=>i.dataset.routeKey),
   inputCounts:[document.querySelectorAll('[data-route-user-index]').length,document.querySelectorAll('[data-route-filter-index]').length],
   badgeCounts:[document.querySelectorAll('[data-route-user-count]').length,document.querySelectorAll('[data-route-filter-count]').length],
   sourceStable:this.unchanged(),queryReads:calls.queries.length,gpsReads:calls.gps.length,usageCalls:calls.usage.length,forbidden:calls.forbidden,
   realLeaflet:L.version,popupHtml,active:testMap.stats().active,
  };
 },
 openFirstPopup(){let first;activityRoutesMapInstance.eachLayer(l=>{if(!first&&l instanceof L.Marker)first=l});first?.openPopup();},
};
'''
OUTPUT = Path(os.environ.get('ROUTE_VISIBILITY_BROWSER_OUTPUT', '/tmp/linked-map-visibility-browser-results.json'))
reports = []

def numeric_badges(items):
    return sum(item['actual'] for item in items)

def assert_state(page, expected, before_reads=None, option_counts=None):
    state = page.evaluate('visibilityTest.inspect()')
    assert state['total'] == expected, state
    assert state['legendTotal'] == expected == state['filterTotal'], state
    assert page.locator('.leaflet-marker-icon').count() == expected, state
    assert sorted(state['actualMarkers']) == sorted(state['expectedMarkers']), 'Coordenadas reales visibles incorrectas'
    assert sorted(state['paths']) == sorted(state['expectedPaths']), 'Polylines reales no corresponden a puntos visibles'
    assert numeric_badges(state['managements']) == expected == numeric_badges(state['users']), state
    assert all(x['actual'] == x['expected'] for x in state['managements'] + state['users']), state
    assert state['sourceStable'], 'Cambió fuente/coords/fechas/store al filtrar'
    assert state['realLeaflet'] == '1.9.4' and state['active'] == 0
    assert state['forbidden'] == []
    assert len(state['rows']) == page.locator('[data-route-visible-index]').count()
    for row in state['rows']:
        assert f"{row['expected']} punto(s) visibles" in row['text'], row
        assert row['expectedDistance'] in row['text'], row
        if not row['selected']:
            assert row['expected'] == 0 and 'Ruta oculta' in row['text'], row
    if before_reads is not None:
        assert [state['queryReads'], state['gpsReads'], state['usageCalls']] == before_reads, 'Lecturas/telemetría adicionales tras filtros'
    if option_counts is not None:
        assert state['inputCounts'] == option_counts == state['badgeCounts'], ('Opciones/badges desaparecieron con 0', state)
    assert page.locator('[data-route-user-index]:disabled,[data-route-filter-index]:disabled,[data-route-visible-index]:disabled').count() == 0
    assert page.locator('[onerror],[onload],img[src="x"]').count() == 0, 'HTML injection'
    assert not page.evaluate('Boolean(window.__visibilityInjected)'), 'Nombre malicioso ejecutado'
    return state

def route(page, key):
    return page.locator('[data-route-key=' + json.dumps(key) + ']')

def route_toggle_keyboard(page, key, checked):
    current = route(page, key)
    assert current.count() == 1, key
    if current.is_checked() != checked:
        current.focus()
        current.press('Space')
    assert route(page, key).is_checked() == checked
    assert page.evaluate('document.activeElement?.dataset.routeKey') == key, 'Foco perdido tras rerender de leyenda'

def reads(state):
    return [state['queryReads'], state['gpsReads'], state['usageCalls']]

def user_index(page, key):
    return next(x['index'] for x in page.evaluate('visibilityTest.inspect().users') if x['key'] == key)

def management_index(page, key):
    return next(x['index'] for x in page.evaluate('visibilityTest.inspect().managements') if x['key'] == key)

def activate_button(page, selector):
    target = page.locator(selector)
    target.click()

def choose_user(page, key):
    activate_button(page, '[data-route-user-action="none"]')
    target = page.locator(f'[data-route-user-index="{user_index(page, key)}"]')
    target.check()
    assert target.is_checked()

def custom_open(page, kind, count):
    page.evaluate('(kind)=>visibilityTest.custom(kind)', kind)
    page.evaluate('()=>window.openActivityRoutesMap()')
    assert page.evaluate('testMap.stats().points') == count
    page.evaluate('visibilityTest.capture()')
    return assert_state(page, count)

try:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
        for width in [1440, 768, 390]:
            print(f'Browser Leaflet offline {width}px: fixture real 120 y filtros enlazados', flush=True)
            context = browser.new_context(viewport={'width': width, 'height': 1000}, locale='es-MX', timezone_id='America/Mexico_City', offline=True)
            context.route('**/*', lambda r: r.abort())
            page = context.new_page()
            page.set_default_timeout(5000)
            errors, network = [], []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.on('request', lambda r: network.append(r.url))
            page.set_content('<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + CSS + '</style></head><body>' + CONTROLS + MODAL + '</body></html>')
            page.add_script_tag(content=(VENDOR / 'leaflet.js').read_text())
            page.add_script_tag(content=SCRIPT + TEST_API)
            page.evaluate('()=>window.openActivityRoutesMap()')
            assert page.evaluate('testMap.stats().points') == 120
            page.evaluate('visibilityTest.capture()')
            initial = assert_state(page, 120)
            assert initial['queryReads'] == 3 and initial['gpsReads'] == 360
            budget, options = reads(initial), [2, 2]
            page.locator('[data-route-user-index="0"]').uncheck()
            selected = assert_state(page, 60, budget, options)
            assert len(selected['routeKeys']) == 1 and selected['users'][0]['actual'] == 0
            key = selected['routeKeys'][0]
            route_toggle_keyboard(page, key, False)
            assert_state(page, 0, budget, options)
            route_toggle_keyboard(page, key, True)
            assert_state(page, 60, budget, options)
            activate_button(page, '[data-route-user-action="all"]')
            assert_state(page, 120, budget, options)
            activate_button(page, '[data-route-filter-action="none"]')
            zero = assert_state(page, 0, budget, options)
            assert len(zero['routeKeys']) == 2 and len(zero['checkedRoutes']) == 2
            activate_button(page, '[data-route-filter-action="all"]')
            assert_state(page, 120, budget, options)

            print(f'{width}px: Blanco 7 vs total 358', flush=True)
            blanco = custom_open(page, 'blanco', 358)
            budget, options = reads(blanco), [2, 2]
            choose_user(page, 'blanco')
            assert_state(page, 7, budget, options)
            route(page, 'blanco::2026-11-17').uncheck()
            assert_state(page, 0, budget, options)
            route(page, 'blanco::2026-11-17').check()
            assert_state(page, 7, budget, options)
            route_toggle_keyboard(page, 'blanco::2026-11-17', False)
            assert_state(page, 0, budget, options)
            route_toggle_keyboard(page, 'blanco::2026-11-17', True)
            assert_state(page, 7, budget, options)

            print(f'{width}px: Vanessa 13+4, rutas/gestiones/usuarios y restauración', flush=True)
            vanessa = custom_open(page, 'vanessa', 24)
            budget, options = reads(vanessa), [2, 2]
            choose_user(page, 'vanessa')
            assert_state(page, 17, budget, options)
            route_toggle_keyboard(page, 'vanessa::2026-11-17', False)
            four = assert_state(page, 4, budget, options)
            original_meters = next(r['meters'] for r in four['rows'] if r['key'].endswith('18'))
            visit_index = management_index(page, 'LLAMADA')
            page.locator(f'[data-route-filter-index="{visit_index}"]').uncheck()
            partial = assert_state(page, 2, budget, options)
            partial_meters = next(r['meters'] for r in partial['rows'] if r['key'].endswith('18'))
            assert 0 < partial_meters < original_meters
            activate_button(page, '[data-route-filter-action="none"]')
            zero = assert_state(page, 0, budget, options)
            assert zero['checkedRoutes'] == ['vanessa::2026-11-18']
            activate_button(page, '[data-route-filter-action="all"]')
            assert_state(page, 4, budget, options)
            route_toggle_keyboard(page, 'vanessa::2026-11-17', True)
            assert_state(page, 17, budget, options)
            page.locator('[data-route-visibility-action="none"]').focus()
            page.locator('[data-route-visibility-action="none"]').press('Enter')
            assert page.evaluate('document.activeElement?.dataset.routeVisibilityAction') == 'none'
            assert_state(page, 0, budget, options)
            # None sólo afecta a usuarios seleccionados: Otro no perdió su ruta.
            activate_button(page, '[data-route-user-action="all"]')
            only_other = assert_state(page, 7, budget, options)
            assert only_other['checkedRoutes'] == ['otro::2026-11-18']
            choose_user(page, 'vanessa')
            assert_state(page, 0, budget, options)
            page.locator('[data-route-visibility-action="all"]').focus()
            page.locator('[data-route-visibility-action="all"]').press('Enter')
            assert page.evaluate('document.activeElement?.dataset.routeVisibilityAction') == 'all'
            assert_state(page, 17, budget, options)
            activate_button(page, '[data-route-user-action="none"]')
            no_users = assert_state(page, 0, budget, options)
            assert no_users['routeKeys'] == []
            activate_button(page, '[data-route-user-action="all"]')
            assert_state(page, 24, budget, options)
            page.screenshot(path=f'/tmp/linked-map-visibility-{width}.png', full_page=True)

            # All tampoco reenciende rutas de usuarios que están fuera de selección.
            route_toggle_keyboard(page, 'otro::2026-11-18', False)
            choose_user(page, 'vanessa')
            activate_button(page, '[data-route-visibility-action="all"]')
            assert_state(page, 17, budget, options)
            activate_button(page, '[data-route-user-action="all"]')
            outside = assert_state(page, 17, budget, options)
            assert 'otro::2026-11-18' not in outside['checkedRoutes']
            route_toggle_keyboard(page, 'otro::2026-11-18', True)
            assert_state(page, 24, budget, options)

            print(f'{width}px: nombres/roles/gestiones maliciosos escapados en controles y popup', flush=True)
            malicious = custom_open(page, 'malicious', 7)
            budget, options = reads(malicious), [1, 1]
            assert '<img src=x' in page.locator('[data-route-key="safe-uid::2026-11-17"]').get_attribute('aria-label')
            assert '<img src=x' in page.locator('[data-route-user-index="0"]').locator('..').inner_text()
            assert '<img src=x' in page.locator('[data-route-filter-index="0"]').locator('..').inner_text()
            for popup in malicious['popupHtml']:
                assert '<img src=x' not in popup and '<svg onload' not in popup and '&lt;img' in popup
            page.evaluate('visibilityTest.openFirstPopup()')
            assert '<img src=x' in page.locator('.leaflet-popup-content').inner_text()
            route_toggle_keyboard(page, 'safe-uid::2026-11-17', False)
            assert_state(page, 0, budget, options)
            route_toggle_keyboard(page, 'safe-uid::2026-11-17', True)
            assert_state(page, 7, budget, options)
            assert not errors, errors
            assert not network, network
            reports.append({'width': width, 'passed': True, 'real_leaflet': '1.9.4', 'base_fixture': 120, 'base_user_filter_points': 60, 'blanco': {'global': 358, 'selected': 7}, 'vanessa': {'selected': 17, 'hidden_17': 4, 'management_filtered': 2, 'restored_all': 24}, 'additional_filter_calls': 0, 'routes_all_none_selected_users_only': True, 'keyboard_focus_preserved': True, 'normal_pointer_actions': True, 'counts_and_real_marker_coordinates_and_polylines': True, 'source_coords_dates_unchanged': True, 'malicious_text_escaped_controls_and_popups': True, 'network': network, 'pageerrors': errors})
            context.close()
        browser.close()
    report = {'passed': True, 'scope': 'model/UI invariants, normal pointer and keyboard in desktop/tablet/mobile', 'mobile_pointer_caveat': None, 'index_sha256': hashlib.sha256(HTML.encode()).hexdigest(), 'leaflet_asset_dir': str(VENDOR), 'results': reports}
    OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)
except Exception as error:
    report = {'passed': False, 'completed': reports, 'error': str(error), 'index_sha256': hashlib.sha256(HTML.encode()).hexdigest()}
    OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    try:
        page.screenshot(path='/tmp/linked-map-visibility-browser-failure.png', full_page=True)
    except Exception:
        pass
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)
    raise
