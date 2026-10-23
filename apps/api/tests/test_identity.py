import os
from datetime import datetime, timedelta, timezone
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select
from sqlalchemy.orm import Session
from brandguard.main import create_app, Settings, passwords, digest
from brandguard.models import (Brand, Organisation, User, Membership, SessionRecord, LoginAttempt,
    AuditEvent, RunSource, Job, ReviewRun, ContentRevision, ContentItem, SourceVersion)

@pytest.fixture()
def setup():
    url = os.environ['TEST_DATABASE_URL']
    if 'brandguard_s1_test' not in url:
        raise RuntimeError('Use a dedicated brandguard_s1_test database')
    app = create_app(Settings(url, 'https://testserver', 'test'))
    engine = app.state.engine
    with Session(engine) as db:
        for cls in (AuditEvent, RunSource, Job, ReviewRun, ContentRevision, ContentItem, SourceVersion,
                    SessionRecord, LoginAttempt, Brand, Membership, User, Organisation):
            db.execute(delete(cls))
        orgs = [Organisation(name='One'), Organisation(name='Two')]
        db.add_all(orgs); db.flush()
        ids = [o.id for o in orgs]
        for role in ('manager', 'creator', 'reviewer', 'admin'):
            u = User(email=role+'@example.test', password_hash=passwords.hash('correct-password'))
            db.add(u); db.flush()
            db.add(Membership(user_id=u.id, org_id=ids[0], role=role))
        b = Brand(org_id=ids[1], name='Private')
        db.add(b); db.commit()
        foreign = b.id
    with TestClient(app, base_url='https://testserver') as client:
        yield client, engine, ids, foreign

def login(client, org, role='manager'):
    r = client.post('/api/v1/sessions', json=dict(email=role+'@example.test', password='correct-password', org_id=org), headers={'origin':'https://testserver'})
    assert r.status_code == 200, r.text
    return {'origin':'https://testserver', 'x-csrf-token':r.json()['csrf_token']}

def test_t01_tenant_isolation_and_server_derived_org(setup):
    c, engine, orgs, foreign = setup
    h = login(c, orgs[0])
    assert c.get('/api/v1/brands/'+foreign).status_code == 404
    assert c.get('/api/v1/brands').json() == []
    r = c.post('/api/v1/brands', json={'name':'Mine','org_id':orgs[1]}, headers=h)
    assert r.status_code == 201
    with Session(engine) as db:
        assert db.get(Brand, r.json()['id']).org_id == orgs[0]

@pytest.mark.parametrize('role', ['creator','reviewer','admin'])
def test_non_manager_denied(setup, role):
    c, _, orgs, _ = setup
    h = login(c, orgs[0], role)
    assert c.post('/api/v1/brands', json={'name':'No'}, headers=h).status_code == 403

def test_t22_csrf_session_hash_and_logout(setup):
    c, engine, orgs, _ = setup
    assert c.get('/api/v1/me').status_code == 401
    h = login(c, orgs[0])
    token = c.cookies.get('brandguard_session')
    with Session(engine) as db:
        assert db.get(SessionRecord, token) is None
        assert db.get(SessionRecord, digest(token)) is not None
    assert c.post('/api/v1/brands', json={'name':'X'}).status_code == 403
    assert c.post('/api/v1/brands', json={'name':'X'}, headers={**h, 'origin':'https://evil.test'}).status_code == 403
    assert c.delete('/api/v1/sessions/current', headers=h).status_code == 204
    c.cookies.set('brandguard_session', token)
    assert c.get('/api/v1/me').status_code == 401

def test_expiry_and_cookie_security(setup):
    c, engine, orgs, _ = setup
    h = login(c, orgs[0])
    cookie = list(c.cookies.jar)[0]
    assert cookie.secure and cookie.has_nonstandard_attr('HttpOnly')
    with Session(engine) as db:
        record = db.scalar(select(SessionRecord))
        record.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        db.commit()
    assert c.get('/api/v1/me').status_code == 401

def test_credentials_rate_limit_and_readiness(setup):
    c, _, orgs, _ = setup
    assert c.get('/api/v1/health/ready').status_code == 200
    body = dict(email='missing@test', password='secret', org_id=orgs[0])
    assert c.post('/api/v1/sessions', json=body).status_code == 403
    for _ in range(20):
        assert c.post('/api/v1/sessions', json=body, headers={'origin':'https://testserver'}).status_code == 401
    assert c.post('/api/v1/sessions', json=body, headers={'origin':'https://testserver'}).status_code == 429

def test_wrong_workspace_and_validation_redaction(setup):
    c, _, orgs, _ = setup
    r = c.post('/api/v1/sessions', json=dict(email='manager@example.test', password='correct-password', org_id=orgs[1]), headers={'origin':'https://testserver'})
    assert r.status_code == 401
    r = c.post('/api/v1/sessions', json={'password':'do-not-echo'})
    assert r.status_code == 422 and 'do-not-echo' not in r.text
