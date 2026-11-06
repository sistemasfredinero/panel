#!/usr/bin/env python3
"""Smoke DOM offline: HTML completo, sin quitar scripts y sin acceso a red/Firebase.

Los imports remotos quedan bloqueados; lógica de módulos se valida en tests .cjs.
"""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
html = (root / 'index.html').read_text()
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    context = browser.new_context(viewport={'width': 1440, 'height': 1000}, offline=True)
    blocked = []
    def block(route):
        blocked.append(route.request.url)
        route.abort()
    context.route('**/*', block)
    page = context.new_page()
    page.set_content(html, wait_until='domcontentloaded')
    result = page.evaluate('''() => {
      const selectors = ['filtroPlaza', 'activityPlaza', 'vpPlaza', 'annualFeedbackPlaza'];
      const results = selectors.map(id => {
        const select = document.getElementById(id);
        select.value = 'CHIHUAHUA';
        return { id, selected: select.value, count: Array.from(select.options).filter(o => o.value === 'CHIHUAHUA').length };
      });
      return { results, supportCount: document.querySelectorAll('#supportProfilePlazas option[value="CHIHUAHUA"]').length,
        scriptCount: document.querySelectorAll('script').length, inlineScripts: Array.from(document.scripts).filter(s => !s.src && s.textContent.trim()).length };
    }''')
    assert all(r['selected'] == 'CHIHUAHUA' and r['count'] == 1 for r in result['results'])
    assert result['supportCount'] == 1 and result['inlineScripts'] >= 1
    # Mostrar sólo componentes existentes; no sustituir HTML ni ejecutar acciones productivas.
    page.evaluate('''() => {
      document.getElementById('loginOverlay').style.display = 'none';
      document.getElementById('app').style.display = 'block';
      document.getElementById('moduleLanding').style.display = 'none';
      document.getElementById('attendanceWorkspace').style.display = 'none';
      document.getElementById('activitiesSection').style.display = 'block';
    }''')
    page.screenshot(path='/tmp/chihuahua-panel-offline.png', full_page=True)
    print(json.dumps({**result, 'blockedRequests': len(blocked), 'network': 'offline + route abort; no Firebase connected', 'caveat': 'Imports Firebase/CDN blocked; dynamic logic covered by real-function Node tests', 'screenshot': '/tmp/chihuahua-panel-offline.png'}, indent=2))
    context.close()
    browser.close()
