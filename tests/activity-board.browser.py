#!/usr/bin/env python3
"""UI real del panel, modelo de agrupación simulado en su frontera, red totalmente bloqueada.
El modelo y el recolector se prueban con sus funciones reales en las pruebas Node.
"""
import json
import re
from pathlib import Path
from playwright.sync_api import sync_playwright
root = Path(__file__).resolve().parents[1]
html = (root / 'index.html').read_text()
css = re.search(r'<style>([\s\S]*?)</style>', html).group(1)
def function(name):
    result = re.search(r'^  (?:async )?function ' + name + r'\([^\n]*\) \{(?:[^\n]*\}$|\n[\s\S]*?^  \})', html, re.M)
    assert result, name
    return result.group(0)
names = ['activityText', 'normaliseActivityText', 'activityBoardAction', 'activityBoardDateLabel', 'activityBoardMovementLabel', 'activityBoardTimeline', 'renderActivityBoardCard', 'renderActivityBoard']
script = r'''
const _activityBoardItems=new Map();let _activityBoardContext='';
const auth={currentUser:{uid:'synthetic-user',email:'synthetic@example.test'}};
let filter='same';
let detailCalls=0,photoCalls=[],locationCalls=[],deleted=[];
function activityQueryContextKey(){return JSON.stringify(auth.currentUser);}
function activityFilterSignature(){return filter;}
function currentActivityFilterCriteria(){return {};}
function activityCreatedTimestamp(r){return r.created_at||0;}
function activityCategory(r){return r.tipo;}
function activityCategoryLabel(v){return {GENERAL:'General',COBRANZA:'Cobranza',PROSPECCION:'Prospección'}[v];}
function prospectWorkflowLabel(r){return r.estado_expediente||'Prospección';}
function prospectColor(p){return {CHIHUAHUA:'#0E7490',TAMPICO:'#1A7A3C',MADERO:'#27AE60'}[p]||'#64748B';}
function activityCanManageAll(){return true;}
function buildActivityDisplayItems(records){return records;}
const ACTIVITY_RESULTS_PAGE_SIZE=50;
window.viewActivityBoardDetail=()=>{detailCalls++;};
window.viewActivityBoardEvidence=key=>{photoCalls.push(key);};
window.openActivityMap=id=>{locationCalls.push(id);};
window.deleteActivity=id=>{deleted.push(id);};
const fixtureTime=new Date(2026,10,6,10,0).getTime();
function movement(id,type,action,name,hasEvidence=false){return {id,tipo:type,gestion_realizada:action,nombre_contacto:'Distribuidora '+id,nombre_usuario:name,created_at:fixtureTime,tiene_evidencia:hasEvidence,plaza:'CHIHUAHUA'};}
const payment=movement('promise-1','COBRANZA','Promesa de pago','Gerente original');
const receipt=movement('receipt-1','COBRANZA','Recepción de pago','Líder seguimiento',true);
const verification=movement('verification-1','COBRANZA','Comprobación de pago','Otro seguimiento');
const prospect=movement('prospect-1','PROSPECCION','Prospección','Líder seguimiento');
prospect.nombre_prospecto='Prospecto original';prospect.estado_expediente='Verificación';
const regular=movement('call-1','GENERAL','Llamada','Gestor');
const hostile=movement('hostile\'id','GENERAL','<img src=x onerror=window.injected=true>','<script>window.injected=true</script>');
const owner={uid:'gerente-original',name:'Gerente original',email:'gerente@example.test',role:'GERENTE',plaza:'CHIHUAHUA'};
const items=[
 {key:'payment:promise-1',kind:'payment',record:payment,relatedRecords:[payment,receipt,verification],owner,hasEvidence:true},
 {key:'prospect:prospect-1',kind:'prospect',record:prospect,relatedRecords:[prospect],owner,hasEvidence:false},
 {key:'activity:call-1',kind:'activity',record:regular,relatedRecords:[regular],owner:{uid:'gestor',name:'Gestor',email:'gestor@example.test',role:'GESTOR',plaza:'CHIHUAHUA'},hasEvidence:false},
 {key:'activity:hostile',kind:'activity',record:hostile,relatedRecords:[hostile],owner:{uid:'hostile',name:'<script>window.injected=true</script>',plaza:'TAMPICO'},hasEvidence:false},
];
window.moreCalls=0;
window.loadMoreActivities=()=>{moreCalls++;
 const newRecord=movement('next-50','GENERAL','Aviso en puerta','Gestor',true);
 items.push({key:'activity:next-50',kind:'activity',record:newRecord,relatedRecords:[newRecord],owner:{uid:'gestor',name:'Gestor',plaza:'CHIHUAHUA'},hasEvidence:true});
 renderActivityBoard(document.getElementById('activitiesTableContainer'),items,0,false);
};
''' + '\n'.join(function(name) for name in names)
script += "\nrenderActivityBoard(document.getElementById('activitiesTableContainer'),items,0,true);"
report = []
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    for width in [1440, 768, 390]:
        context = browser.new_context(viewport={'width': width, 'height': 1000}, offline=True)
        context.route('**/*', lambda route: route.abort())
        page = context.new_page()
        errors=[]
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.set_content('<html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style></head><body style="margin:0;background:#F5F7FA;padding:16px"><main style="max-width:1380px;margin:auto"><h2 style="font-size:18px;color:#4B1E91;margin:8px 0 16px">Actividades por plaza e integrante</h2><div id="activitiesTableContainer"></div></main></body></html>')
        page.add_script_tag(content=script)
        assert page.locator('.activity-board-plaza').count()==2
        assert page.locator('.activity-board-user').count()==3
        assert page.locator('.activity-board-card').count()==4
        assert page.locator('details[open]').count()==0
        assert page.locator('.btn-foto').count()==1
        assert page.evaluate('window.injected') is None
        assert page.locator('#activitiesTableContainer img').count()==0
        plaza=page.locator('.activity-board-plaza').filter(has=page.locator('summary .chip').filter(has_text='CHIHUAHUA')).first
        plaza.locator(':scope > summary').click()
        manager=plaza.locator('.activity-board-user').filter(has=page.locator('.activity-board-heading').filter(has_text='Gerente original')).first
        manager.locator(':scope > summary').click()
        assert manager.locator('.activity-board-card').count()==2
        assert 'Líder seguimiento' not in manager.locator(':scope > summary').inner_text()
        payment_card=manager.locator('.activity-board-card').filter(has_text='Bitácora de pago').first
        payment_card.locator(':scope > summary').click()
        assert payment_card.locator('.activity-board-timeline li').count()==3
        assert 'Líder seguimiento' in payment_card.inner_text()
        assert payment_card.locator('.btn-foto').is_visible()
        payment_card.locator('.btn-foto').click()
        assert page.evaluate('photoCalls')==['payment:promise-1']
        page.get_by_role('button',name='Cargar 50 coincidencias más').click()
        assert page.evaluate('moreCalls')==1
        assert page.locator('.activity-board-card').count()==5
        assert page.locator('.activity-board-plaza').count()==2
        assert page.locator('details[open]').count()==3
        gestor=plaza.locator('.activity-board-user').filter(has=page.locator('.activity-board-heading').filter(has_text='Gestor')).first
        assert gestor.locator('.activity-board-card').count()==2
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        assert page.evaluate('detailCalls')==0
        screenshot=f'/tmp/activity-board-ui-{width}.png'
        page.screenshot(path=screenshot,full_page=True)
        page.evaluate("filter='different';renderActivityBoard(document.getElementById('activitiesTableContainer'),items,0,false)")
        assert page.locator('details[open]').count()==0
        assert errors==[], errors
        report.append({'width':width,'plazas':2,'users':3,'cards_after_load':5,'payment_movements':3,'expansion_preserved':True,'photo_conditional':True,'injection_blocked':True,'overflow':False,'screenshot':screenshot})
        context.close()
    browser.close()
print(json.dumps({'results':report,'network':'offline + route abort; synthetic data only','boundary':'actual UI functions; data-model and collector covered by Node tests'},indent=2))
