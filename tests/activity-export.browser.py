#!/usr/bin/env python3
"""Prueba DOM/descarga real de los botones; fuente de datos simulada, toda red bloqueada.

La paginación y el recolector real se prueban por separado en activity-export-range.test.cjs.
"""
import json
import re
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
html = (root / 'index.html').read_text()

def function(name):
    match = re.search(r'^  (?:async )?function ' + name + r'\([^\n]*\) \{(?:[^\n]*\}$|\n[\s\S]*?^  \})', html, re.M)
    assert match, name
    return match.group(0)

match = re.search(r'^  window\.exportActivitiesCsv = async function\([^\n]*\) \{\n[\s\S]*?^  \};', html, re.M)
assert match
functions = ['activityExportContextKey', 'setActivityExportProgress', 'setActivityExportBusy', 'activityExportTextRecord', 'activityExportCsvQ', 'activityExportValue', 'downloadActivitiesCsv', 'validateActivityExportProfile']
script = '''
const auth = {currentUser:{uid:'offline-synthetic',email:'soporte@fredinero.com'}};
let _activityProfile={rol:'ADMINISTRATIVO',plaza:'TAMPICO'},_activityExportInFlight=false;
const database={};
function ref(_database,path){return path;}
async function get(path){return {val:()=>path.endsWith('/rol')?'ADMINISTRATIVO':'TAMPICO'};}
function normaliseActivityText(v){return String(v||'').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toUpperCase().trim();}
function activityCategoryLabel(v){return {GENERAL:'General',COBRANZA:'Cobranza',PROSPECCION:'Prospección'}[v];}
function currentActivityFilterCriteria(){
 const startValue=document.getElementById('activityStartDate').value,endValue=document.getElementById('activityEndDate').value;
 return {startValue,endValue,start:new Date(startValue+'T00:00:00').getTime(),end:new Date(endValue+'T23:59:59.999').getTime(),type:'',actions:new Set()};
}
function activityFilterSignature(v){return JSON.stringify({...v,actions:[...v.actions]});}
function csvQ(v){return '"'+String(v??'').replace(/"/g,'""')+'"';}
function activityCreatedTimestamp(v){return v.created_at;}
function formatRecordDateTime(v){return new Date(v).toISOString();}
async function loadActivityExportRecords(criteria,ensureActive){
 await new Promise(r=>setTimeout(r,150));ensureActive();
 return Array.from({length:123},(_,i)=>({id:'synthetic-'+i,tipo:criteria.type,created_at:Date.now(),nombre_contacto:'Prueba, sintética',comentarios:'Texto\\ncompleto',monto:i+1}));
}
''' + '\n\n'.join(function(n) for n in functions) + '\n' + match.group(0)

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    results = []
    for width in [1440, 768, 390]:
        context = browser.new_context(viewport={'width':width,'height':1000}, offline=True, accept_downloads=True)
        context.route('**/*', lambda route: route.abort())
        page = context.new_page()
        page.set_content(html, wait_until='domcontentloaded')
        page.evaluate("""() => {
 document.getElementById('loginOverlay').style.display='none';document.getElementById('app').style.display='block';
 document.getElementById('moduleLanding').style.display='none';document.getElementById('attendanceWorkspace').style.display='none';
 document.getElementById('activitiesSection').style.display='block';
 document.getElementById('activityStartDate').value='2026-11-01';document.getElementById('activityEndDate').value='2026-11-07';
} """)
        page.add_script_tag(content=script)
        errors=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        for kind in ['GENERAL','COBRANZA','PROSPECCION']:
            with page.expect_download() as download_event:
                page.locator('#activityExport'+kind).click()
                assert page.locator('#activityExport'+kind).is_disabled()
            download=download_event.value
            data=Path(download.path()).read_text(encoding='utf-8-sig')
            import csv,io
            rows=list(csv.reader(io.StringIO(data)))
            assert len(rows)==124, (kind,len(rows))
            assert '123 registro(s)' in page.locator('#activityExportStatus').inner_text()
            assert not page.locator('#activityExport'+kind).is_disabled()
            assert download.suggested_filename==f'actividades_{kind.lower()}_2026-11-01_a_2026-11-07.csv'
            assert rows[1][rows[0].index('Tipo de actividad')]==kind
        assert not errors,errors
        results.append({'width':width,'buttons':3,'records_per_csv':123,'errors':errors})
        context.close()
    browser.close()
    print(json.dumps({'results':results,'network':'offline + route abort','data':'synthetic; no Firebase, writes or notices','coverage':'actual onclick, export action, CSV and downloads; collector covered by Node tests'},ensure_ascii=False,indent=2))
