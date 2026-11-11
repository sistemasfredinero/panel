#!/usr/bin/env python3
"""Render real de cobertura parcial, con IO bloqueado y gráficos contados como fronteras sintéticas."""
import json
import re
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
html = (root / 'index.html').read_text()
render = re.search(r'^  window\.renderActivities = function\(\) \{\n[\s\S]*?^  \};', html, re.M).group(0)
text = re.search(r'^  function activityText\([^\n]*\) \{\n[\s\S]*?^  \}', html, re.M).group(0)
script = r'''
const calls = {graphics:0,responses:0,continuation:0,io:0};
window.fetch=()=>{calls.io++;throw new Error('No red');};
let _activitiesData=[],_activitiesFiltered=[],_activitiesVisibleCount=50,_activityAnalysisSignature=null;
let _activityResponseChartType='GENERAL';
const _activityPageSession={lightEntry:{complete:false,scanned:102,records:[]}};
const ACTIVITY_RESULTS_PAGE_SIZE=50;
window.__activitySearchSources={paginated:true,direct:0};
function currentActivityFilterCriteria(){return {};}
function activityMatchesCriteria(){return true;}
function activityCategory(){return 'GENERAL';}
function activityQueryContextKey(){return 'synthetic-session';}
function activityFilterSignature(){return 'synthetic-filter';}
function renderActivityRoutesReport(){}
function renderActivityBoard(container){container.textContent='Tarjeta verificada';}
window.initializeActivityGraphics=details=>{if(!details.open)throw new Error('Detalles no abiertos');calls.graphics++;};
window.openResponseChartsModal=type=>{if(type!=='GENERAL')throw new Error('Tipo incorrecto');calls.responses++;};
window.loadMoreActivities=()=>{calls.continuation++;};
''' + text + '\n' + render + r'''
window.sparseUITest={calls,complete:()=>{_activityPageSession.lightEntry.complete=true;},render:()=>window.renderActivities()};
window.renderActivities();
'''
body = '''<html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:Arial;margin:0;padding:12px;box-sizing:border-box}button{max-width:100%;white-space:normal}</style></head><body>
<div id="activityTotal"></div><div id="activityGeneral"></div><div id="activityCobranza"></div><div id="activityProspeccion"></div><div id="activityEvidence"></div><div id="activityRecordCount"></div>
<details id="activityGraphicsSection" open><summary>Gráficos</summary><div id="activityPerformanceContainer"></div></details>
<div id="activityResponseChartsModal" style="display:block"><div id="activityResponseChartsContainer"></div></div><div id="activitiesTableContainer"></div></body></html>'''
results=[]
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    for width in [1440,768,390]:
        context=browser.new_context(viewport={'width':width,'height':1000},offline=True)
        context.route('**/*',lambda route:route.abort())
        requests=[]
        context.on('request',lambda request:requests.append(request.url))
        page=context.new_page();errors=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.set_content(body);page.add_script_tag(content=script)
        assert page.evaluate('JSON.stringify(sparseUITest.calls)') == '{"graphics":0,"responses":0,"continuation":0,"io":0}'
        assert 'Verificación pendiente' in page.locator('#activityCoverageStatus').inner_text()
        assert 'todavía no se puede confirmar' in page.locator('#activitiesTableContainer').inner_text()
        assert 'No hay actividades que cumplan' not in page.locator('#activitiesTableContainer').inner_text()
        page.get_by_role('button',name='Continuar búsqueda',exact=True).click()
        assert page.evaluate('sparseUITest.calls.continuation')==1
        page.get_by_role('button',name='Cargar gráficos del rango completo',exact=True).click()
        assert page.evaluate('sparseUITest.calls.graphics')==1
        page.get_by_role('button',name='Cargar respuestas del rango completo',exact=True).click()
        assert page.evaluate('sparseUITest.calls.responses')==1
        page.evaluate('sparseUITest.render()')
        assert page.evaluate('sparseUITest.calls.graphics')==1
        assert page.evaluate('sparseUITest.calls.responses')==1
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        screenshot=f'/tmp/activity-sparse-ui-{width}.png';page.screenshot(path=screenshot,full_page=True)
        page.evaluate('sparseUITest.complete();sparseUITest.render()')
        assert page.locator('#activityCoverageStatus').count()==0
        assert page.get_by_role('button',name='Continuar búsqueda',exact=True).count()==0
        assert 'No hay actividades que cumplan' in page.locator('#activitiesTableContainer').inner_text()
        assert requests==[] and errors==[], (requests,errors)
        assert page.evaluate('sparseUITest.calls.io')==0
        results.append({'width':width,'partial_empty_not_false_zero':True,'explicit_buttons':True,'no_automatic_analysis':True,'no_network':True,'screenshot':screenshot})
        context.close()
    browser.close()
print(json.dumps({'results':results,'passed':True},indent=2))
