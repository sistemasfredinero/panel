#!/usr/bin/env python3
"""QA tabla directa: frontend REAL de index.html, SDK sintético, cero red.

Ejecutar desde repo:
  sudo unshare --net -- runuser -u ubuntu -- python3 tests/activity-table-direct-range.browser.py

No importa Firebase, no carga el módulo completo y no copia lógica del producto.
Extrae transitivamente funciones/declaraciones reales de Buscar/Cargar más/render.
Sólo se simulan el SDK, la telemetría (sin escrituras) y el perfil YA autenticado.
Los datos canónicos señuelo jamás son legibles. Evidencias fuera del repositorio.
"""
import argparse
import hashlib
import json
import re
import traceback
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / 'index.html').read_text()
OUT = Path('/tmp/direct-table-browser-evidence')
OUT.mkdir(exist_ok=True)

# Igual frontera de extracción de los harness existentes, sin modificarlos.
FUNCTIONS = {m[1]: m[0] for m in re.finditer(
    r'^  (?:async )?function (\w+)\([^\n]*\) \{(?:[^\n]*\}$|\n[\s\S]*?^  \})', HTML, re.M)}
ACTIONS = {m[1]: m[0] for m in re.finditer(
    r'^  window\.(\w+) = (?:async )?function\([^\n]*\) \{(?:[^\n]*\};$|\n[\s\S]*?^  \};)', HTML, re.M)}
DECLS = {m[1]: m[0] for m in re.finditer(
    r'^  (?:const|let) (\w+) = (?:[^\n]+;|[\s\S]*?^  [^\n]*;)', HTML, re.M)}
DENIED = {
    'get', 'set', 'update', 'remove', 'push', 'loadActivityAnalysisData',
    'activityEnsureLightRecords', 'activityGetLightEntry',
    'loadFullActivityRecord', 'loadFullActivityRecords', 'activityReadShallowKeys',
    'activityCachedKeys', 'loadActivityUserDirectory', 'hydrateActivityDisplayMetadata',
    'activityReadDisplayRootIdentity', 'activityReadLightRecord',
}
MOCKS = DENIED | {'recordPanelDataUsage', 'loadPanelSessionProfile', 'database', 'auth', 'app', 'firebaseConfig'}
ROOT_ACTIONS = ['searchActivities', 'loadMoreActivities', 'renderActivities',
                'toggleActivityActionMenu', 'setActivityActionFilter', 'clearActivityActionFilters']


def extract():
    selected = {}
    def add(kind, name):
        key = kind + ':' + name
        if key in selected or name in MOCKS:
            return
        table = {'f': FUNCTIONS, 'a': ACTIONS, 'd': DECLS}[kind]
        assert name in table, 'No se encontró función/declaración real: ' + name
        code = table[name]
        selected[key] = code
        # Referencias de callbacks reales también requieren su función.
        for dep in FUNCTIONS:
            if re.search(r'(?<![\w.])' + re.escape(dep) + r'\b', code):
                add('f', dep)
        for dep in ROOT_ACTIONS:
            if re.search(r'window\.' + re.escape(dep) + r'\s*\(', code):
                add('a', dep)
        for dep in DECLS:
            if re.search(r'\b' + re.escape(dep) + r'\b', code):
                add('d', dep)
    for name in ROOT_ACTIONS:
        add('a', name)
    for name in ['estimateDataUsageBytes', 'firebasePushIdBoundary', 'activityFilterSignature',
                 'currentActivityFilterCriteria', 'buildActivityDisplayItems',
                 'renderActivityBoard', 'renderActivityBoardCard', 'resetActivityBoardState']:
        add('f', name)
    # Eventos reales de cancelación: únicamente bloques cuyo contenido invoca
    # cancelación directa de tabla. No inventar listeners ni cargar Firebase.
    events = []
    for m in re.finditer(r'^  document\.addEventListener(?:\?\.)?\([^\n]*[\s\S]*?^  \}\);', HTML, re.M):
        if re.search(r'cancelActivity(?:Table|Direct)', m[0]):
            events.append(m[0])
            for dep in FUNCTIONS:
                if re.search(r'\b' + re.escape(dep) + r'\s*\(', m[0]):
                    add('f', dep)
    declarations = sorted([value for key, value in selected.items() if key.startswith('d:')], key=HTML.index)
    funcs = [value for key, value in selected.items() if not key.startswith('d:')]
    manifest = {'index_sha256': hashlib.sha256(HTML.encode()).hexdigest(),
                'real_symbols': sorted(selected), 'real_cancel_listener_blocks': len(events),
                'mocked_boundaries': sorted(MOCKS)}
    (OUT / 'extraction.json').write_text(json.dumps(manifest, indent=2) + '\n')
    return '\n'.join(declarations + funcs + events), manifest


SDK = r'''
const auth={currentUser:{uid:'offline-synthetic-admin',email:'admin@example.test',getIdToken:async()=> 'OFFLINE_SYNTHETIC_TOKEN'}};
const database={};
const calls={queries:[],shallow:[],usage:[],forbidden:[],alerts:[]};
let active=0,maximum=0,stopped=0,blocked=false,pending=[],denied=false;
const realSetTimeout=window.setTimeout.bind(window);
const deny=name=>(...args)=>{calls.forbidden.push({name,args});throw Error('Prohibido '+name)};
window.alert=message=>calls.alerts.push(String(message));
window.setInterval=deny('polling');window.WebSocket=deny('WebSocket');window.XMLHttpRequest=deny('XMLHttpRequest');
const ref=(db,path)=>path===undefined?{toString:()=> 'https://offline.example.test/'}:path;
const query=(route,...constraints)=>({route,constraints});
const orderByKey=()=>({type:'key'}),startAt=value=>({type:'start',value}),endAt=value=>({type:'end',value}),limitToLast=count=>({type:'last',count});
function recordPanelDataUsage(name,value){calls.usage.push({name,records:value.records,bytes:value.estimatedBytes??estimateDataUsageBytes(value.payload),scope:value.scope});}
async function loadPanelSessionProfile(){return _activityProfile;}
const store={activity_summaries:{plazas:{}},gestor_activities:{},users:{PRIVATE_PROFILE:'NO LEER'},gestor_photos:{PRIVATE_PHOTO:'NO LEER'}};
function snapshot(value,key=''){return{key,exists:()=>value!=null,val:()=>value==null?null:JSON.parse(JSON.stringify(value)),forEach:cb=>{for(const [id,row]of Object.entries(value||{}).sort(([a],[b])=>a<b?-1:a>b?1:0)){if(cb(snapshot(row,id))===true)break}}};}
function onValue(request,success,failure,options){
 if(options?.onlyOnce!==true)throw Error('Listener persistente prohibido');
 if(!/^activity_summaries\/plazas\/[^/]+$/.test(request.route||'')){calls.forbidden.push(request);throw Error('Sólo índices plazas');}
 const c=request.constraints;
 if(c?.map(x=>x.type).join()!=='key,start,end,last'||c[3].count!==51)throw Error('Consulta no acotada 50+1');
 const min=firebasePushIdBoundary(new Date('2026-10-01T00:00:00').getTime(),'-'),max=firebasePushIdBoundary(new Date('2026-10-01T23:59:59.999').getTime(),'z');
 if(c[1].value!==min||c[2].value>max||c[2].value<min)throw Error('Consulta fuera de 1-Oct-2026');
 const entries=Object.entries(store.activity_summaries.plazas[request.route.split('/').pop()]||{}).filter(([id])=>id>=c[1].value&&id<=c[2].value).sort(([a],[b])=>a<b?-1:a>b?1:0).slice(-c[3].count);
 const value=entries.length?Object.fromEntries(entries):null;
 const audit={...request,returned:entries.length,bytes:new TextEncoder().encode(JSON.stringify(value)).byteLength,keys:entries.map(([id])=>id),lower:min,upper:max};
 calls.queries.push(audit);active++;maximum=Math.max(maximum,active);
 let canceled=false,finished=false;const finish=()=>{if(!finished){finished=true;active--}};
 const deliver=()=>{if(canceled)return;try{if(denied)failure(Error('synthetic-permission-denied'));else success(snapshot(value));}finally{finish()}};
 if(blocked)pending.push(deliver);else realSetTimeout(deliver,1);
 return()=>{if(!canceled){canceled=true;stopped++;finish()}};
}
window.fetch=async(url,options)=>{
 const parsed=new URL(url);
 if(parsed.origin!=='https://offline.example.test'||parsed.pathname!=='/activity_summaries/plazas.json'||parsed.searchParams.get('shallow')!=='true'||parsed.searchParams.get('auth')!=='OFFLINE_SYNTHETIC_TOKEN'||options?.method!=='GET'||options?.credentials!=='omit'||options?.cache!=='no-store'||options?.redirect!=='error'||options?.referrerPolicy!=='no-referrer'||!options?.signal){calls.forbidden.push({name:'fetch',url});throw Error('Sólo nombres de plazas shallow seguros');}
 const value=Object.fromEntries(Object.keys(store.activity_summaries.plazas).map(k=>[k,true]));calls.shallow.push({path:parsed.pathname,bytes:new TextEncoder().encode(JSON.stringify(value)).byteLength});
 return {ok:!denied,json:async()=>Object.keys(value).length?value:null};
};
'''
POST = r'''
_activityProfile={rol:'ADMINISTRATIVO',plaza:'TAMPICO'};
const base=new Date('2026-10-01T10:00:00').getTime(),outsideDays=['2026-09-30','2026-10-02','2026-11-01'];
const makeId=(ts,i)=>firebasePushIdBoundary(ts,'-').slice(0,8)+String(i).padStart(12,'0');
let expected=[];
function fixture(count=123,exterior=24000,mode='normal'){
 invalidateActivityQueryCache();calls.queries=[];calls.shallow=[];calls.usage=[];calls.alerts=[];calls.forbidden=[];
 active=0;maximum=0;stopped=0;pending=[];blocked=false;denied=false;expected=[];
 store.activity_summaries.plazas={TAMPICO:{}};store.gestor_activities={};
 const summaries=store.activity_summaries.plazas.TAMPICO;
 for(let i=0;i<count;i++){
  // TODOS los 123 IDs en la MISMA milésima, incluyendo la frontera 50/100.
  const id=makeId(base,i),tipo=i%3===0?'PROSPECCION':i%3===1?'COBRANZA':'GENERAL';
  const row={tipo,created_at:base,actualizado_en:tipo==='PROSPECCION'?base+36*86400000:base,
   uid:'u'+(i%2),user_uid:'u'+(i%2),nombre_usuario:i%2?'RODRIGO RODRIGUEZ':'IRMA BERENICE',correo_usuario:i%2?'rodrigo@example.test':'bere@example.test',rol:i%2?'LIDER A':'GESTOR',plaza:'TAMPICO',
   gestion_realizada:tipo==='GENERAL'?'LLAMADA':tipo==='COBRANZA'?'AVISO EN PUERTA':'VISITA EN DOMICILIO',tipo_accion:'VISITA EN DOMICILIO',nombre_contacto:'Contacto '+i,
   nombre_prospecto:tipo==='PROSPECCION'?'Prospecto '+i:'',estado_expediente:tipo==='PROSPECCION'?'PENDIENTE_VERIFICACION':'',tiene_evidencia:i===118};
  if(i===119){row.nombre_contacto='<img src=x onerror="window.injected=true">';row.gestion_realizada='<script>window.injected=true</script>';}
  if(i===117){row.expediente_prospeccion_id=makeId(base,120);row.nombre_prospecto='Seguimiento raíz presente';row.nombre_usuario='Líder seguimiento';row.uid=row.user_uid='leader-follow';}
  if(i===120){row.nombre_usuario='Gerente original';row.uid=row.user_uid='manager-root';row.rol='GERENTE';row.nombre_prospecto='Raíz original';row.es_expediente_prospeccion=true;}
  if(i===114){row.expediente_prospeccion_id=makeId(base-86400000,99);row.nombre_usuario='Responsable seguimiento sin raíz';row.nombre_prospecto='Raíz ausente no atribuir';row.uid=row.user_uid='missing-root-follow';}
  store.gestor_activities[id]={...row,latitud:22.3,longitud:-97.8,historial_expediente:{private:{comentario:'PRIVATE_HISTORY'}},foto_base64:'PRIVATE_IMAGE',firma_base64:'PRIVATE_SIGNATURE'};
  if(mode!=='absent'){summaries[id]=row;expected.push({...row,id});}
 }
 for(let i=0;i<exterior;i++){
  const ts=new Date(outsideDays[i%3]+'T10:00:00').getTime(),id=makeId(ts,i);
  summaries[id]={created_at:ts,actualizado_en:base,tipo:'PROSPECCION',plaza:'TAMPICO',nombre_usuario:'EXTERIOR NO LEER',gestion_realizada:'VISITA'};
  store.gestor_activities[id]={...summaries[id],historial_expediente:{private:'PRIVATE_HISTORY'}};
 }
 store.gestor_activities['legacy-sin-indice']={created_at:base,tipo:'GENERAL',plaza:'TAMPICO',gestion_realizada:'LLAMADA',nombre_usuario:'Histórico sin ficha NO LEER'};
 summaries['legacy-no-cronologico']={created_at:base,tipo:'GENERAL',plaza:'TAMPICO',gestion_realizada:'LLAMADA',nombre_usuario:'Clave no cronológica NO LEER'};
}
function expectedIds(){const c=currentActivityFilterCriteria();return expected.filter(r=>
 (!c.type||r.tipo===c.type)&&(!c.role||r.rol===c.role)&&(!c.plaza||r.plaza===c.plaza)
 &&(!c.actions.size||[...c.actions].some(k=>{const [t,a]=k.split('|');return t===r.tipo&&(a==='*'||a===r.gestion_realizada)}))
 &&(!c.userSearch||c.userSearch.split(',').map(normaliseActivityText).filter(Boolean).some(t=>t.split(/\s+/).every(w=>normaliseActivityText(r.nombre_usuario+' '+r.correo_usuario).includes(w))))).map(r=>r.id).sort();}
window.testTable={calls,fixture,expectedIds,stats:()=>({active,maximum,stopped,data:_activitiesData.length,projected:_activitiesFiltered.length,
 filtered:[...new Set(_activitiesData.flatMap(r=>r._display_related_records||[r]).map(r=>r.id))].length,
 ids:[...new Set(_activitiesData.flatMap(r=>r._display_related_records||[r]).map(r=>r.id))].sort(),cards:document.querySelectorAll('.activity-board-card').length,
 context:activityQueryContextKey(),sources:window.__activitySearchSources,hasMore:!!document.querySelector('[onclick="window.loadMoreActivities()"]')}),
 block:()=>{blocked=true},release:()=>{blocked=false;const jobs=pending.splice(0);jobs.forEach(fn=>fn())},denyIndex:v=>denied=v,
 session:(uid='offline-other-admin')=>{auth.currentUser={uid,email:uid+'@example.test',getIdToken:async()=> 'OFFLINE_SYNTHETIC_TOKEN'}},logout:()=>{auth.currentUser=null},
 invalidate:()=>invalidateActivityQueryCache()};
window.resetActivityBoard=resetActivityBoardState;
// Sólo observación de promesas: NO sustituir implementación real.
for(const name of ['searchActivities','loadMoreActivities']){const actual=window[name];window[name]=(...args)=>{window.__testDone=false;window.__testResult=null;window.__testFailure=null;window.__testPromise=Promise.resolve().then(()=>actual(...args)).then(v=>{window.__testDone=true;window.__testResult=v;return v},e=>{window.__testDone=true;window.__testFailure=String(e);return false});return window.__testPromise};}
fixture();renderActivityActionFilterOptions();updateActivityActionFilterLabel();
'''


def make_script():
    code, manifest = extract()
    # Preflight honesto: harness jamás simula el nuevo loader ni hace pasar fuente vieja.
    search = ACTIONS['searchActivities']
    assert re.search(r'activity(?:Table|Direct)', search, re.I), (
        'PENDIENTE: Buscar todavía no invoca el loader directo de tabla. '
        'Aplicar implementación y volver a ejecutar; no se ejecutó fuente vieja.')
    denied_code = '\n'.join('const ' + name + '=deny(' + json.dumps(name) + ');' for name in sorted(DENIED))
    return SDK + '\n' + denied_code + '\n' + code + '\n' + POST, manifest


def document():
    start = HTML.index('<div id="activitiesSection"')
    end = HTML.index('\n<div id="prospectCalendarModal"', start)
    section = HTML[start:end].replace('style="display:none;padding:24px 32px"', 'style="padding:24px 32px"', 1)
    css = '\n'.join(re.findall(r'<style>([\s\S]*?)</style>', HTML))
    return '<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css + '</style></head><body>' + section + '</body></html>'


def stats(page):
    return page.evaluate('testTable.stats()')


def settled(page, expected_failure=False):
    page.wait_for_function('window.__testDone === true && testTable.stats().active===0', timeout=15000)
    if not expected_failure:
        assert page.evaluate('window.__testFailure || null') is None, page.evaluate('window.__testFailure')


def click_search(page, refresh=False, expected_failure=False):
    if refresh:
        page.locator('#activityRefreshButton').click()
    else:
        page.get_by_role('button', name='Buscar', exact=True).click()
    settled(page, expected_failure=expected_failure)


def reset(page, count=123, exterior=24000, mode='normal'):
    for id_, value in [('activityStartDate', '2026-10-01'), ('activityEndDate', '2026-10-01'),
                       ('activityPlaza', 'TAMPICO'), ('activityType', ''), ('activityRole', ''), ('activityUser', '')]:
        node = page.locator('#' + id_)
        if node.evaluate('(e)=>e.tagName') == 'SELECT':
            node.select_option(value)
        else:
            node.fill(value)
    page.evaluate('window.clearActivityActionFilters()')
    page.evaluate('(v)=>testTable.fixture(...v)', [count, exterior, mode])


def coverage(page):
    text = page.locator('#activitiesTableContainer').inner_text()
    assert re.search(r'fichas? disponibles|fichas? (?:cronológicas|capturadas)', text, re.I), text
    assert re.search(r'captura', text, re.I), text
    assert re.search(r'históric|completitud', text, re.I), text
    assert not re.search(r'(?<!no )cobertura histórica completa|total definitivo|No hay actividades que cumplan', text, re.I), text
    return text


def safe(page, errors, network):
    s = stats(page)
    assert s['active'] == 0 and s['maximum'] <= 6, s
    assert page.evaluate('testTable.calls.forbidden') == []
    assert page.evaluate('window.injected || null') is None
    assert page.locator('#activitiesTableContainer img, #activitiesTableContainer script').count() == 0
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), page.evaluate('({scroll:document.documentElement.scrollWidth,width:innerWidth})')
    assert not errors, errors
    assert not network, network
    usage = json.dumps(page.evaluate('testTable.calls.usage'))
    assert not re.search(r'PRIVATE_HISTORY|PRIVATE_IMAGE|PRIVATE_SIGNATURE|OFFLINE_SYNTHETIC_TOKEN', usage)
    queries = page.evaluate('testTable.calls.queries')
    for q in queries:
        assert q['constraints'][1]['value'] == q['lower']
        assert q['lower'] <= q['constraints'][2]['value'] <= q['upper']
        assert q['returned'] <= 51
    assert not re.search(r'PRIVATE_HISTORY|PRIVATE_IMAGE|PRIVATE_SIGNATURE|EXTERIOR NO LEER|Histórico sin ficha NO LEER', page.locator('body').inner_text())
    return s


def paginate(page, expected_total):
    milestones = [stats(page)['filtered']]
    for target in [100, expected_total]:
        assert stats(page)['hasMore'], stats(page)
        page.locator('[onclick="window.loadMoreActivities()"]').click()
        settled(page)
        milestones.append(stats(page)['filtered'])
        assert stats(page)['filtered'] == target, stats(page)
    assert not stats(page)['hasMore'], stats(page)
    assert stats(page)['ids'] == page.evaluate('testTable.expectedIds()'), stats(page)
    return milestones


def budget(page):
    queries = page.evaluate('testTable.calls.queries')
    return {'queries': len(queries), 'bytes': sum(q['bytes'] for q in queries),
            'returned': sum(q['returned'] for q in queries),
            'pages': [{k: q[k] for k in ['route', 'constraints', 'returned', 'bytes', 'keys']} for q in queries],
            'shallow': page.evaluate('testTable.calls.shallow'), 'canonical': 0, 'photos': 0, 'gps': 0, 'profiles': 0}


def run():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prepare-only', action='store_true', help='Verificar extracción; no reportar PASS de la implementación')
    parser.add_argument('--skip-timeout', action='store_true', help='Evidencia parcial: omite timeout y SIEMPRE reporta passed:false')
    args = parser.parse_args()
    script, manifest = make_script()
    (OUT / 'real-frontend-extracted.js').write_text(script + '\n')
    if args.prepare_only:
        print(json.dumps({'prepared': True, 'passed': False, 'manifest': manifest}, indent=2))
        return
    results = []
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
        for width in [1440, 768, 390]:
            c = browser.new_context(viewport={'width': width, 'height': 1000}, locale='es-MX', timezone_id='America/Mexico_City', offline=True)
            c.route('**/*', lambda route: route.abort())
            page = c.new_page()
            errors, network = [], []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.on('request', lambda r: network.append(r.url))
            page.set_content(document())
            page.add_script_tag(content=script)
            try:
                # 123 coincidencias y 24000 exteriores; el producto, no el SDK,
                # decide cuántas páginas cargar ante Buscar y cada clic adicional.
                reset(page)
                click_search(page)
                assert stats(page)['filtered'] == 50, stats(page)
                assert len(page.evaluate('testTable.calls.queries')) == 1, budget(page)
                coverage(page)
                before = budget(page)
                plaza = page.locator('.activity-board-plaza').first
                plaza.locator(':scope > summary').click()
                # Desplegar plaza/integrante/card o bitácora LOCAL no descarga nada.
                users = plaza.locator('.activity-board-user')
                for user in users.all():
                    user.locator(':scope > summary').click()
                orphan = page.locator('.activity-board-user').filter(has=page.locator('.activity-board-heading').filter(has_text=re.compile('Autor original (?:no disponible|por confirmar)'))).first
                assert orphan.count() == 1
                orphan_card = orphan.locator('.activity-board-card').filter(has_text='Raíz ausente no atribuir').first
                orphan_card.locator(':scope > summary').click()
                manager = page.locator('.activity-board-user').filter(has=page.locator('.activity-board-heading').filter(has_text='Gerente original')).first
                assert manager.count() == 1
                assert 'Líder seguimiento' not in manager.locator(':scope > summary').inner_text()
                assert budget(page) == before
                shot = OUT / f'table-direct-{width}-50.png'
                page.screenshot(path=str(shot), full_page=True)
                milestones = paginate(page, 123)
                final_shot = OUT / f'table-direct-{width}-123.png'
                page.screenshot(path=str(final_shot), full_page=True)
                assert milestones == [50, 100, 123], milestones
                assert len(page.evaluate('testTable.calls.queries')) == 3
                assert page.locator('#activityTotal').inner_text() == str(stats(page)['projected'])
                assert stats(page)['sources']['direct'] == 123, 'Conteo base no es cantidad de tarjetas PROS consolidadas'
                assert stats(page)['cards'] < 123, 'Agrupación PROS no debe usar tarjetas como conteo base'
                coverage(page)
                dense = budget(page)
                assert dense['returned'] == 125 and [p['returned'] for p in dense['pages']] == [51, 51, 23]
                reads = len(page.evaluate('testTable.calls.queries'))
                page.wait_for_timeout(80)
                assert len(page.evaluate('testTable.calls.queries')) == reads, 'No continuar por historia'
                safe(page, errors, network)
                # Mismo rango y filtro reutiliza páginas completadas sin nuevas lecturas.
                click_search(page)
                assert len(page.evaluate('testTable.calls.queries')) == reads
                click_search(page, refresh=True)
                assert len(page.evaluate('testTable.calls.queries')) == reads + 1
                assert stats(page)['filtered'] == 50
                # Sin exteriores, exactamente las mismas tres solicitudes/payloads.
                reset(page, 123, 0)
                click_search(page)
                paginate(page, 123)
                sparse = budget(page)
                assert dense == sparse, {'with_exterior': dense, 'without_exterior': sparse}
                # Vacío índice con datos reales presentes y pocos resultados: honestidad.
                small_results = []
                for count, mode in [(0, 'normal'), (4, 'normal'), (123, 'absent')]:
                    reset(page, count, 24000, mode)
                    click_search(page)
                    expected_count = 0 if mode == 'absent' else count
                    assert stats(page)['filtered'] == expected_count
                    assert not stats(page)['hasMore']
                    assert len(page.evaluate('testTable.calls.queries')) == 1
                    notice = coverage(page)
                    assert not re.search(r'No hay actividades (?:en|que)|0 actividades (?:totales|históricas)', notice, re.I), notice
                    small_results.append({'fixture': mode, 'indexed_matches': expected_count, 'query': budget(page), 'notice': notice})
                safe(page, errors, network)
                results.append({'width': width, 'milestones': milestones, 'outside_records': 24000,
                                'budget_with_exterior': dense, 'budget_without_exterior': sparse,
                                'small_results': small_results, 'cards_less_than_matches': True,
                                'local_expansion_reads': 0, 'screenshot': str(shot), 'screenshot_final': str(final_shot), 'network': network, 'errors': errors})
                if width == 1440:
                    results[-1]['filters_and_lifecycle'] = lifecycle(page, errors, network, skip_timeout=args.skip_timeout)
                (OUT / 'progress.json').write_text(json.dumps(results, indent=2, ensure_ascii=False) + '\n')
            except Exception:
                (OUT / f'failure-{width}.json').write_text(json.dumps({'errors': errors, 'network': network, 'stats': page.evaluate('window.testTable?.stats() || null'), 'calls': page.evaluate('window.testTable?.calls || null'), 'text': page.locator('body').inner_text()}, indent=2, ensure_ascii=False) + '\n')
                page.screenshot(path=str(OUT / f'failure-{width}.png'), full_page=True)
                raise
            c.close()
        browser.close()
    report = {'passed': not args.skip_timeout, 'pending': ['real_sdk_read_timeout'] if args.skip_timeout else [],
              'network_isolation': 'Linux unshare --net + Playwright offline + route abort',
              'index_sha256': manifest['index_sha256'], 'results': results, 'extraction': manifest}
    (OUT / 'results.json').write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
    print(json.dumps(report, indent=2, ensure_ascii=False))


def lifecycle(page, errors, network, skip_timeout=False):
    filters = []
    for field, value in [('activityType', 'PROSPECCION'), ('activityType', 'COBRANZA'),
                         ('activityType', 'GENERAL'), ('activityRole', 'GESTOR'),
                         ('activityRole', 'LIDER A'), ('activityUser', 'bere'),
                         ('activityUser', 'rodrigo@example.test'), ('activityUser', 'irma, rodrigo'),
                         ('activityUser', 'sin-coincidencias')]:
        reset(page)
        node = page.locator('#' + field)
        if node.evaluate('(e)=>e.tagName') == 'SELECT':
            node.select_option(value)
        else:
            node.fill(value)
        click_search(page)
        guard = 0
        while stats(page)['hasMore']:
            guard += 1
            assert guard <= 3, 'Filtro no debe continuar fuera del día'
            page.locator('[onclick="window.loadMoreActivities()"]').click()
            settled(page)
        assert stats(page)['ids'] == page.evaluate('testTable.expectedIds()'), {'field': field, 'value': value, 'stats': stats(page)}
        assert len(page.evaluate('testTable.calls.queries')) <= 3
        coverage(page)
        safe(page, errors, network)
        filters.append({'field': field, 'value': value, 'matches': stats(page)['filtered'], 'queries': len(page.evaluate('testTable.calls.queries'))})
    reset(page)
    page.locator('#activityActionTrigger').click()
    page.locator('#activityActionOptions input[value="GENERAL|LLAMADA"]').check()
    page.locator('#activityActionOptions input[value="COBRANZA|AVISO EN PUERTA"]').check()
    page.locator('#activityActionTrigger').click()
    click_search(page)
    for _ in range(3):
        if not stats(page)['hasMore']:
            break
        page.locator('[onclick="window.loadMoreActivities()"]').click()
        settled(page)
    assert stats(page)['ids'] == page.evaluate('testTable.expectedIds()')
    filters.append({'multiple_actions': True, 'matches': stats(page)['filtered']})
    # Todas sólo enumera nombres, incluida plaza no listada, nunca usuarios/raíz.
    reset(page, 4, 0)
    page.evaluate("store.activity_summaries.plazas['PLAZA_HISTORICA']={}")
    page.locator('#activityPlaza').select_option('')
    click_search(page)
    assert len(page.evaluate('testTable.calls.shallow')) == 1
    assert any(q['route'].endswith('/PLAZA_HISTORICA') for q in page.evaluate('testTable.calls.queries'))
    assert len(page.evaluate('testTable.calls.queries')) == 2
    assert stats(page)['filtered'] == 4
    # Sesión nueva no hereda caché; logout no puede leer.
    reset(page, 4, 0)
    click_search(page)
    old = len(page.evaluate('testTable.calls.queries'))
    page.evaluate('testTable.session()')
    click_search(page)
    assert len(page.evaluate('testTable.calls.queries')) == old + 1
    page.evaluate('testTable.logout()')
    click_search(page, expected_failure=True)
    assert len(page.evaluate('testTable.calls.queries')) == old + 1
    page.evaluate('testTable.session("offline-synthetic-admin")')
    # Filtro modificado mientras SDK está bloqueado: cancelación real retira listener.
    reset(page, 123, 0)
    page.evaluate('testTable.block()')
    page.get_by_role('button', name='Buscar', exact=True).click()
    page.wait_for_function('testTable.stats().active===1')
    page.locator('#activityUser').fill('bere')
    page.wait_for_function('testTable.stats().active===0', timeout=3000)
    assert stats(page)['stopped'] >= 1
    page.evaluate('testTable.release()')
    settled(page)
    click_search(page)
    assert set(stats(page)['ids']).issubset(set(page.evaluate('testTable.expectedIds()')))
    # Error permisos no fallback, no listener ni payload privado.
    reset(page, 4, 0)
    page.evaluate('testTable.denyIndex(true)')
    click_search(page)
    assert re.search(r'Error|permis|índice|Actualizar', page.locator('#activitiesTableContainer').inner_text(), re.I)
    assert len(page.evaluate('testTable.calls.queries')) == 1
    safe(page, errors, network)
    # Timeout real del loader: temporizador acortado sólo para esa frontera.
    if skip_timeout:
        return {'filters': filters, 'all_plazas_shallow_only': True, 'session_cache_isolated': True,
                'logout_no_reads': True, 'filter_cancel_unsubscribed': True, 'permission_error_no_fallback': True,
                'timeout_unsubscribed': 'PENDIENTE_NO_EJECUTADO_EN_MODO_PARCIAL'}
    reset(page, 4, 0)
    page.evaluate("testTable.block();window.__testTimerDelays=[];window.setTimeout=(fn,ms,...args)=>{window.__testTimerDelays.push(ms);return realSetTimeout(fn,ms>=1000?30:ms,...args)}")
    page.get_by_role('button', name='Buscar', exact=True).click()
    settled(page)
    assert stats(page)['stopped'] >= 1
    assert page.evaluate('window.__testTimerDelays.some(ms=>ms>=1000)'), 'Loader requiere timeout de lectura real'
    assert re.search(r'tiempo|tard|timeout|Actualizar|Error', page.locator('#activitiesTableContainer').inner_text(), re.I)
    page.evaluate('window.setTimeout=realSetTimeout;testTable.release()')
    safe(page, errors, network)
    return {'filters': filters, 'all_plazas_shallow_only': True, 'session_cache_isolated': True,
            'logout_no_reads': True, 'filter_cancel_unsubscribed': True, 'permission_error_no_fallback': True,
            'timeout_unsubscribed': True}


if __name__ == '__main__':
    try:
        run()
    except Exception as exc:
        failure = {'passed': False, 'error': str(exc), 'traceback': traceback.format_exc(), 'evidence_dir': str(OUT)}
        (OUT / 'failure.json').write_text(json.dumps(failure, indent=2, ensure_ascii=False) + '\n')
        print(json.dumps(failure, indent=2, ensure_ascii=False), flush=True)
        raise
