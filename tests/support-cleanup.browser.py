#!/usr/bin/env python3
"""UI/helpers reales de Soporte, IO sintético; ejecutar dentro de unshare --net.

sudo unshare --net -- runuser -u ubuntu -- python3 tests/support-cleanup.browser.py
No carga imports remotos ni abre Firebase/Worker. Node cubre las sesiones completas.
"""
import json
import re
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / 'index.html').read_text()
CSS = '\n'.join(re.findall(r'<style>([\s\S]*?)</style>', HTML))
LANDING = HTML[HTML.index('  <section id="moduleLanding"'):HTML.index('  <section id="supportProfileSection"')]
UID = '5dVKDIhQZlbzonMbSG9mX1pXHYg1'


def extract(pattern, name):
    match = re.search(pattern, HTML, re.M)
    assert match, name
    return match.group(0)


def function(name):
    return extract(r'^  (?:async )?function ' + name + r'\([^\n]*\) \{(?:[^\n]*\}$|\n[\s\S]*?^  \})', name)


def action(name):
    return extract(r'^  window\.' + name + r' = (?:async )?function\([^\n]*\) \{(?:[^\n]*\};$|\n[\s\S]*?^  \};)', name)


def declaration(kind, name):
    return extract(r'^  ' + kind + ' ' + name + r' = [^\n]+;', name)


SCRIPT = r'''
const calls = {reads: [], writes: [], confirms: [], network: [], notices: []};
const auth = {currentUser: null}, database = {};
const forbidden = bucket => (...args) => {calls[bucket].push(args.map(String)); throw Error('IO prohibido');};
window.fetch = forbidden('network');
window.XMLHttpRequest = forbidden('network');
window.WebSocket = forbidden('network');
window.EventSource = forbidden('network');
navigator.sendBeacon = forbidden('network');
window.alert = forbidden('notices');
const update = forbidden('writes'), remove = forbidden('writes'), onValue = forbidden('network');
window.confirm = message => {calls.confirms.push(message); return true;};
const ref = (_, path) => ({path});
const orderByKey = () => 'orderByKey', limitToFirst = count => ({limit: count}), startAfter = key => ({cursor: key});
const query = (ref, ...constraints) => ({...ref, constraints});
const get = async request => {
  calls.reads.push(request);
  if (request.path !== 'users' || request.constraints[1].limit !== 10) throw Error('Consulta inesperada');
  return {forEach: callback => callback({key: 'new-user', val: () => ({correo: 'nueva@fredinero.com', rol: 'GESTOR', plaza: 'CHIHUAHUA', nombre_completo: 'Persona nueva'})})};
};
const set = async (ref, payload) => {if(ref.path !== 'notice_directory') throw Error('Escritura inesperada'); calls.writes.push({path: ref.path, payload});};
'''
SCRIPT += '\n'.join([
    *[declaration('const', name) for name in ['SUPPORT_WORKER_UID', 'TAMPICO_MADERO_MANAGER_EMAIL', 'SUPPORT_NOTICE_FIELDS']],
    *[declaration('let', name) for name in ['_supportNoticeRun', '_supportNoticeBusy', '_supportNoticeController', '_supportNoticePrepared', '_supportNoticeCache']],
    *[function(name) for name in ['normaliseActivityText', 'privacyIsSupport', 'applyPrivacyAdminAccess', 'supportWorkerIsAuthorized', 'supportNoticeProfile', 'supportNoticeKey', 'supportNoticeLabel', 'managerProfilePlazas', 'buildSupportNoticeDirectory', 'supportNoticeMessage', 'supportNoticeControls', 'resetSupportNoticeDirectory', 'supportNoticeWait']],
    *[action(name) for name in ['prepareSupportNoticeDirectory', 'cancelSupportNoticeDirectory', 'saveSupportNoticeDirectory']],
])
SCRIPT += r'''
window.supportTest = {calls, change: user => {auth.currentUser = user; resetSupportNoticeDirectory(); document.getElementById('supportNoticeDirectoryEntry')?.removeAttribute?.('open'); applyPrivacyAdminAccess();}, state: () => ({prepared: _supportNoticePrepared, busy: _supportNoticeBusy, cache: _supportNoticeCache})};
'''

results = []
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    for width in [1440, 768, 390]:
        context = browser.new_context(viewport={'width': width, 'height': 1100}, locale='es-MX', offline=True)
        requests, errors = [], []
        context.route('**/*', lambda route: route.abort())
        context.on('request', lambda request: requests.append(request.url))
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.set_content('<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + CSS + '</style></head><body>' + LANDING + '</body></html>')
        page.add_script_tag(content=SCRIPT)
        card = page.locator('#supportNoticeDirectoryEntry')
        assert not card.is_visible()
        assert page.locator('[id*="supportWorkerDiagnostic"], [id*="supportEmailTest"], [id*="supportFcmDiagnostic"], [id*="supportNoticeSetup"]').count() == 0
        # UID y correo son necesarios; ni el correo solo ni un UID parecido sirven.
        for user in [None, {'uid': 'wrong', 'email': 'soporte@fredinero.com'}, {'uid': UID, 'email': 'otro@fredinero.com'}]:
            page.evaluate('(user) => supportTest.change(user)', user)
            assert not card.is_visible()
            page.evaluate('async () => {await window.prepareSupportNoticeDirectory(); await window.saveSupportNoticeDirectory(); window.cancelSupportNoticeDirectory();}')
        assert page.evaluate('JSON.stringify(supportTest.calls)') == '{"reads":[],"writes":[],"confirms":[],"network":[],"notices":[]}'
        page.evaluate('(user) => supportTest.change(user)', {'uid': UID, 'email': 'soporte@fredinero.com'})
        assert card.is_visible() and card.get_attribute('open') is None
        prepare = card.get_by_role('button', name='Revisar actualización del directorio', exact=True)
        assert not prepare.is_visible()
        page.get_by_text('Mantenimiento de avisos · Soporte', exact=True).click()
        assert prepare.is_visible()
        assert page.evaluate('supportTest.calls.reads.length + supportTest.calls.writes.length') == 0
        save = card.get_by_role('button', name='Guardar directorio revisado', exact=True)
        assert save.is_disabled()
        prepare.click()
        page.wait_for_function('supportTest.state().prepared !== null')
        assert page.evaluate('supportTest.calls.reads.length') == 1
        assert page.evaluate('supportTest.calls.writes.length') == 0
        assert page.evaluate('supportTest.calls.confirms.length') == 1
        assert 'Identidades válidas: 1' in page.locator('#supportNoticeDirectoryPreview').inner_text()
        assert save.is_enabled()
        save.click()
        page.wait_for_function('supportTest.calls.writes.length === 1 && !supportTest.state().busy')
        assert page.evaluate('supportTest.calls.confirms.length') == 2
        payload = page.evaluate('supportTest.calls.writes[0]')
        assert payload['path'] == 'notice_directory'
        assert sorted(payload['payload']) == ['by_email', 'by_uid', 'manager_coverage', 'managers_by_plaza']
        assert payload['payload']['by_uid']['new-user']['plaza'] == 'CHIHUAHUA'
        assert 'la configuración de envíos operativos no cambió' in page.locator('#supportNoticeDirectoryStatus').inner_text()
        assert page.evaluate('document.documentElement.scrollWidth') <= width
        assert page.evaluate('''() => {const card=document.getElementById('supportNoticeDirectoryEntry'); return card.scrollWidth <= card.clientWidth;}''')
        screenshot = f'/tmp/panel-support-cleanup-ui-{width}.png'
        page.screenshot(path=screenshot, full_page=True)
        page.evaluate('supportTest.change(null)')
        assert not card.is_visible() and card.get_attribute('open') is None
        assert page.locator('#supportNoticeDirectoryPreview').inner_text() == ''
        assert page.evaluate('supportTest.state().prepared') is None
        assert page.evaluate('supportTest.calls.network.length + supportTest.calls.notices.length') == 0
        assert not requests and not errors, (requests, errors)
        results.append({'width': width, 'passed': True, 'syntheticReads': 1, 'syntheticWrites': 1, 'realNetwork': requests, 'pageerrors': errors, 'screenshot': screenshot})
        context.close()
    browser.close()
report = {'passed': True, 'boundary': 'DOM/CSS/helpers reales; users/query/set locales; unshare --net + offline + route abort', 'results': results}
Path('/tmp/panel-support-cleanup-browser-results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(report, ensure_ascii=False, indent=2))
