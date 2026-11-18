#!/usr/bin/env python3
"""Mapa real+Leaflet local; SDK simulado; red aislada. No Firebase productivo."""
import json,re,os
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/'index.html').read_text()
HARNESS=(ROOT/'tests/activity-location-core-integration.test.cjs').read_text()
VENDOR=Path(os.environ.get('LEAFLET_TEST_ASSET_DIR',str(ROOT.parent/'tests/vendor')))
# Dependencia de pruebas externa: leaflet.js/css 1.9.4, mismos archivos que usa
# index.html. LEAFLET_TEST_ASSET_DIR permite ejecutar sin CDN y sin añadir assets
# al código publicado; integridad verificada antes de ejecutar esta prueba.
def fn(name):
 m=re.search(r'^  (?:async )?function '+re.escape(name)+r'\([^\n]*\) \{(?:[^\n]*\}$|\n[\s\S]*?^  \})',HTML,re.M)
 assert m,name
 return m[0]
def decl(name):
 m=re.search(r'^  (?:const|let) '+re.escape(name)+r' = (?:[^\n]+;|[\s\S]*?^  [^\n]*;)',HTML,re.M)
 assert m,name
 return m[0]
def action(name):
 m=re.search(r'^  window\.'+re.escape(name)+r' = (?:async )?function\([^\n]*\) \{(?:[^\n]*\};$|\n[\s\S]*?^  \};)',HTML,re.M)
 assert m,name
 return m[0]
def names(label):
 return re.findall(r"'([^']+)'",re.search(r'const '+label+r' = \[(.*?)\];',HARNESS,re.S)[1])
extra=['formatRecordDateTime','escapeMapHtml','formatActivityDistance','activityMarkerOffset','focusActivityRoutesMap','addActivityPrecisionControl','activityRouteManagement','buildActivityRouteManagementFilters','activityRouteUser','buildActivityRouteUserFilters','activityRouteTypeStyle','activityRoutePointLabel','createEmptyActivityRoutesMap','renderActivityRoutesReport']
NAMES=list(dict.fromkeys(names('NAMES')+extra))
SCRIPT=r'''
const auth={currentUser:{uid:'offline-only',email:'admin@example.test',getIdToken:async()=> 'OFFLINE_FAKE_ID_TOKEN'}};
const database={};let _activityProfile={rol:'ADMINISTRATIVO',plaza:'TAMPICO'},_selectedActivityActionFilters=new Set(),activityRoutesMapInstance=null;
const calls={queries:[],gps:[],usage:[],forbidden:[]};let active=0,maximum=0,block=false,release=null,waiting=false;
function deny(name){return()=>{calls.forbidden.push(name);throw Error('Forbidden '+name)}}
const get=deny('get'),set=deny('set'),update=deny('update'),remove=deny('remove');
const loadActivityAnalysisData=deny('loadActivityAnalysisData'),activityEnsureLightRecords=deny('activityEnsureLightRecords'),loadFullActivityRecord=deny('loadFullActivityRecord');
window.searchActivities=deny('searchActivities');window.fetch=deny('fetch');window.setInterval=deny('polling');
const ref=(db,route)=>route===undefined?{toString:()=> 'https://offline.example.test'}:route;
const query=(route,...constraints)=>({route,constraints}),orderByKey=()=>({type:'key'}),startAt=value=>({type:'start',value}),endAt=value=>({type:'end',value}),limitToLast=count=>({type:'last',count});
function recordPanelDataUsage(name,value){calls.usage.push({name,bytes:value.estimatedBytes||0})}
const store={gestor_activities:{},activity_summaries:{plazas:{TAMPICO:{}}}};
function snapshot(value,key=''){return{key,exists:()=>value!=null,val:()=>value,forEach:cb=>{for(const [id,row]of Object.entries(value||{}).sort(([a],[b])=>a<b?-1:a>b?1:0)){if(cb(snapshot(row,id))===true)break}}}}
function onValue(request,success,failure,options){
 if(options.onlyOnce!==true)throw Error('Persistent listener');active++;maximum=Math.max(maximum,active);
 let canceled=false,finished=false;const finish=()=>{if(!finished){finished=true;active--}};
 (async()=>{try{
  let value;if(request.constraints){
   calls.queries.push(request);if(!/^activity_summaries\/plazas\/[A-Z_-]+$/.test(request.route))throw Error('Wrong index');
   const c=request.constraints;if(c.map(x=>x.type).join()!= 'key,start,end,last'||c[3].count!==51)throw Error('Unbounded query');
   const min=firebasePushIdBoundary(new Date('2026-11-15T00:00:00').getTime(),'-'),max=firebasePushIdBoundary(new Date('2026-11-17T23:59:59.999').getTime(),'z');
   if(c[1].value!==min||c[2].value>max)throw Error('Outside selected days');
   if(block){waiting=true;await new Promise(r=>release=r)}
   const rows=Object.entries(store.activity_summaries.plazas.TAMPICO).filter(([id])=>id>=c[1].value&&id<=c[2].value).sort(([a],[b])=>a<b?-1:a>b?1:0).slice(-51);value=rows.length?Object.fromEntries(rows):null;
  }else{calls.gps.push(request);if(!/^gestor_activities\/[^/]+\/(plaza|latitud|longitud)$/.test(request))throw Error('Not GPS scalar');value=request.split('/').reduce((o,k)=>o?.[k],store)}
  await new Promise(r=>setTimeout(r,1));if(!canceled)success(snapshot(value));
 }catch(e){if(!canceled)failure(e)}finally{finish()}})();
 return()=>{canceled=true;finish()};
}
'''+'\n'.join(map(decl,names('STATES')))+'\n'+'\n'.join(map(fn,NAMES))+'\n'+'\n'.join(map(action,['openActivityRoutesMap','closeActivityRoutesMap','refreshActivityRoutesMap']))+r'''
const base=new Date('2026-11-15T10:00:00').getTime();
function makeId(ts,i){return firebasePushIdBoundary(ts,'-').slice(0,8)+String(i).padStart(12,'0')}
for(let i=0;i<120;i++){
 const id=makeId(base+i,i),row={tipo:i%3===0?'PROSPECCION':i%3===1?'COBRANZA':'GENERAL',created_at:base+i,user_uid:'u'+i%2,uid:'u'+i%2,nombre_usuario:i%2?'RODRIGO RODRIGUEZ':'IRMA BERENICE',correo_usuario:'fake@example.test',rol:'GESTOR',plaza:'TAMPICO',gestion_realizada:'VISITA',tiene_evidencia:false};
 store.activity_summaries.plazas.TAMPICO[id]=row;store.gestor_activities[id]={...row,latitud:22.2+i/10000,longitud:-97.8};
}
for(let i=0;i<20000;i++){
 const id=makeId(base+(i%2?-10:10)*86400000,i);store.activity_summaries.plazas.TAMPICO[id]={created_at:base-10*86400000,plaza:'TAMPICO',tipo:'PROSPECCION',actualizado_en:base,nombre_usuario:'EXTERIOR NO LEER'};
}
// Sólo la frontera de tiles es simulada; Leaflet/markers/paths/filtros son reales.
L.tileLayer=()=>({addTo(){return this}});
window.testMap={calls,stats:()=>({active,maximum,groups:(window.__activityRouteGroups||[]).length,points:(window.__activityRouteGroups||[]).flatMap(g=>g.records).length}),block:()=>{block=true;waiting=false;release=null},waiting:()=>waiting,release:()=>{block=false;release?.()}};
renderActivityRoutesReport([]);
'''
MODAL=HTML[HTML.index('<div class="modal-overlay" id="activityRoutesMapModal"'):HTML.index('<!-- Firebase SDK -->')]
CSS='\n'.join(re.findall(r'<style>([\s\S]*?)</style>',HTML))+'\n'+(VENDOR/'leaflet.css').read_text()
CONTROLS='<div style="padding:8px"><input id="activityStartDate" type="date" value="2026-11-15"><input id="activityEndDate" type="date" value="2026-11-17"><input id="activityUser"><select id="activityType"><option value="">Todos</option><option>PROSPECCION</option><option>COBRANZA</option><option>GENERAL</option></select><input id="activityRole"><input id="activityPlaza" value="TAMPICO"></div><div id="activityRoutesReport"></div>'
reports=[]
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 for width in [1440,768,390]:
  c=browser.new_context(viewport={'width':width,'height':1000},locale='es-MX',timezone_id='America/Mexico_City',offline=True);c.route('**/*',lambda r:r.abort());page=c.new_page();errors=[];network=[]
  page.on('pageerror',lambda e:errors.append(str(e)));page.on('request',lambda r:network.append(r.url))
  page.set_content('<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+CSS+'</style></head><body>'+CONTROLS+MODAL+'</body></html>')
  page.add_script_tag(content=(VENDOR/'leaflet.js').read_text());page.add_script_tag(content=SCRIPT)
  page.get_by_role('button',name='Cargar rutas en mapa').click()
  try:
   page.wait_for_function('testMap.stats().points===120 && testMap.stats().active===0',timeout=10000)
  except Exception:
   print(json.dumps({'errors':errors,'stats':page.evaluate('testMap.stats()'),'text':page.locator('#activityRoutesMap').inner_text(),'reads':page.evaluate('testMap.calls')},ensure_ascii=False),flush=True)
   page.screenshot(path='/tmp/mapa-rango-browser-fallo.png',full_page=True)
   raise
  assert page.locator('.leaflet-marker-icon').count()==120
  assert len(page.evaluate('testMap.calls.queries'))==3
  assert len(page.evaluate('testMap.calls.gps'))==360
  assert 'históricos sin ficha' in page.locator('#activityRoutesCoverage').inner_text()
  before=page.evaluate('testMap.calls.queries.length + testMap.calls.gps.length')
  page.locator('[data-route-user-index="0"]').uncheck();assert page.locator('.leaflet-marker-icon').count()==60
  assert page.evaluate('testMap.calls.queries.length + testMap.calls.gps.length')==before
  page.screenshot(path=f'/tmp/mapa-rango-directo-{width}.png',full_page=True)
  page.locator('[data-route-user-index="0"]').check();assert page.locator('.leaflet-marker-icon').count()==120
  page.locator('#refreshActivityRoutesMapBtn').click();page.wait_for_function('testMap.calls.queries.length===6 && testMap.stats().active===0 && !document.querySelector("#refreshActivityRoutesMapBtn").disabled')
  assert page.locator('.leaflet-marker-icon').count()==120
  page.get_by_role('button',name='Cerrar',exact=False).click();page.locator('#activityUser').fill('bere');page.get_by_role('button',name='Cargar rutas en mapa').click();page.wait_for_function('testMap.stats().points===60 && testMap.stats().active===0')
  assert page.locator('.leaflet-marker-icon').count()==60
  page.get_by_role('button',name='Cerrar',exact=False).click();page.locator('#activityUser').fill('rd');page.get_by_role('button',name='Cargar rutas en mapa').click();page.wait_for_function('testMap.stats().points===60 && testMap.stats().active===0')
  assert 'RODRIGO' in page.locator('#activityRoutesMap').inner_text()
  page.get_by_role('button',name='Cerrar',exact=False).click();page.locator('#activityUser').fill('sin-coincidencias');page.get_by_role('button',name='Cargar rutas en mapa').click();page.wait_for_function('testMap.stats().active===0 && document.querySelector("#activityRoutesMap").textContent.includes("No hay ubicaciones")')
  assert page.locator('.leaflet-marker-icon').count()==0
  assert page.evaluate('testMap.stats().maximum')<=6
  assert page.evaluate('testMap.calls.forbidden')==[]
  assert not errors,errors
  assert not network,network
  reports.append({'width':width,'outside_records':20000,'points_in_range':120,'initial_index_pages':3,'initial_gps_leaves':360,'real_leaflet':True,'cache_and_refresh':True,'checkbox_without_reads':True,'partial_names':True,'no_match_no_gps':True,'max_concurrency':page.evaluate('testMap.stats().maximum'),'firebase_production_reads':0,'network':network,'pageerrors':errors})
  c.close()
 browser.close()
report={'results':reports,'passed':True}
(ROOT.parent/'mapa-browser-results.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
