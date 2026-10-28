import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def headers(path):
    config = json.loads((ROOT / path).read_text())
    return {h['key']: h['value'] for h in config['headers'][0]['headers']}, config


def test_vercel_configs_send_strict_security_headers():
    root, root_config = headers('vercel.json')
    web, web_config = headers('apps/web/vercel.json')
    assert root_config == web_config
    csp = dict(part.strip().split(' ', 1) if ' ' in part.strip() else (part.strip(), '') for part in root['Content-Security-Policy'].split(';'))
    assert csp['script-src'] == "'self'" and csp['connect-src'] == "'self'" and csp['object-src'] == "'none'"
    assert csp['frame-ancestors'] == "'none'" and 'unsafe-eval' not in root['Content-Security-Policy']
    assert root['Strict-Transport-Security'].startswith('max-age=63072000')
    assert root['Referrer-Policy'] == 'strict-origin-when-cross-origin'
    assert 'camera=()' in root['Permissions-Policy'] and root['X-Content-Type-Options'] == 'nosniff'


def test_built_shell_has_no_inline_script_that_the_csp_would_block():
    index = (ROOT / 'apps/web/index.html').read_text()
    assert '<script type="module" src=' in index and index.count('<script') == 1
