"""Provision an isolated synthetic tenant for real browser checks; never resets data."""
import json, os, secrets, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'apps/api'))
from sqlalchemy.orm import Session
from fastapi.testclient import TestClient
from brandguard.main import create_app, Settings
from brandguard.models import Organisation, User, Membership
from brandguard.core import passwords

url = os.environ['DATABASE_URL']
if '/brandguard_browser_test' not in url:
    raise SystemExit('Use the dedicated brandguard_browser_test database')
origin = os.environ.get('PUBLIC_ORIGIN', 'http://localhost:5178')
app = create_app(Settings(url, origin, 'development'))
password = secrets.token_urlsafe(24)
emails = {}
with Session(app.state.engine) as db:
    org = Organisation(name='Browser verification (fictional)')
    db.add(org); db.flush(); org_id = org.id
    for role in ('creator','reviewer','manager','admin'):
        email = f'{role}-{secrets.token_hex(4)}@browser.test'
        user = User(email=email, password_hash=passwords.hash(password))
        db.add(user); db.flush()
        db.add(Membership(org_id=org.id, user_id=user.id, role=role))
        emails[role] = email
    db.commit()
pack = json.loads(Path('verification/fixtures/lumadesk.json').read_text())
with TestClient(app, base_url=origin) as client:
    response = client.post('/api/v1/sessions', json=dict(email=emails['manager'], password=password, org_id=org_id), headers={'origin': origin})
    response.raise_for_status()
    headers = {'origin': origin, 'x-csrf-token': response.json()['csrf_token']}
    response = client.post('/api/v1/brands', json={'name':'LumaDesk browser verification'}, headers=headers)
    response.raise_for_status(); brand_id=response.json()['id']
    response = client.post(f'/api/v1/brands/{brand_id}/sources', json=pack['source'], headers=headers)
    response.raise_for_status(); source_id=response.json()['id']
    response = client.post(f'/api/v1/sources/{source_id}/activate', json={'expected_epoch':0,'verified':True,'rationale':'Verified the fictional source for browser integration.'}, headers=headers)
    response.raise_for_status()
output = Path(os.environ.get('BROWSER_FIXTURE_PATH','/tmp/brandguard-browser-fixture.json'))
with os.fdopen(os.open(output, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 'w') as stream:
    json.dump(dict(org_id=org_id, password=password, emails=emails, brand_id=brand_id, source_id=source_id), stream)
app.state.engine.dispose()
print('Synthetic browser tenant provisioned; credentials written privately.')
