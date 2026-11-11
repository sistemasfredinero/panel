#!/usr/bin/env python3
import re
from pathlib import Path
from playwright.sync_api import sync_playwright
html=(Path(__file__).resolve().parents[1]/'index.html').read_text()
def fn(name):
    m=re.search(r'^  function '+name+r'\([^\n]*\) \{\n[\s\S]*?^  \}',html,re.M)
    assert m,name
    return m.group(0)
action=re.search(r'^  window\.copyRequestFirebasePath = async function\([^\n]*\) \{\n[\s\S]*?^  \};',html,re.M).group(0)
script="""const SUPPORT_WORKER_UID='5dVKDIhQZlbzonMbSG9mX1pXHYg1';
const auth={currentUser:{uid:SUPPORT_WORKER_UID,email:'soporte@fredinero.com'}};
const copies=[];Object.defineProperty(navigator,'clipboard',{value:{writeText:async path=>copies.push(path)},configurable:true});
"""+'\n'.join(fn(n) for n in ['supportWorkerIsAuthorized','privacyEscape','vpRequestFirebasePath','vpRequestFirebasePathHtml'])+'\n'+action+"""
const rows=[{_tipo:'vacaciones',id:'-Vac_real'},{_tipo:'permisos',id:'-Perm_real'},{_tipo:'vac_rh',id:'-RH_real'}];
function render(){document.body.innerHTML=rows.map(row=>'<div style="padding:12px;max-width:310px"><strong>Empleado sintético</strong><div>empleado@fredinero.com</div>'+vpRequestFirebasePathHtml(row)+'</div>').join('');}
render();
"""
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    for width in [1440,390]:
        page=browser.new_page(viewport={'width':width,'height':844});requests=[];errors=[]
        page.route('**/*',lambda route:(requests.append(route.request.url),route.abort()))
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.set_content('<html><body></body></html>');page.add_script_tag(content=script)
        assert page.locator('code').all_text_contents()==['vacation_requests/-Vac_real','permission_requests/-Perm_real','cleon_solicitudes/vacaciones/-RH_real']
        page.get_by_role('button',name='Copiar ruta').nth(1).click()
        assert page.evaluate('copies')==['permission_requests/-Perm_real']
        assert page.get_by_role('button',name='Ruta copiada').count()==1
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        page.evaluate("auth.currentUser={uid:'otro',email:'soporte@fredinero.com'};render();")
        assert page.locator('code').count()==0
        assert not requests and not errors,(requests,errors)
        page.close()
    browser.close()
print('PASS: rutas y Copiar en escritorio/móvil; sólo Soporte; cero requests; sin editor.')
