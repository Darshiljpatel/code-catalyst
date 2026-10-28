from datetime import timedelta
from sqlalchemy import delete, update
from sqlalchemy.orm import Session
from test_identity import setup
from brandguard.health import beat, schema_heads, utcnow, worker_identity
from brandguard.models import WorkerHeartbeat


def clear_heartbeats(engine):
    with Session(engine) as db:
        db.execute(delete(WorkerHeartbeat)); db.commit()


def test_ready_compares_database_with_alembic_head(setup):
    c, engine, _, _ = setup
    body = c.get('/api/v1/health/ready').json()
    assert body['status'] == 'ready' and body['schema_revision'] in schema_heads()
    assert 'S5' not in str(body)


def test_ready_fails_when_schema_is_behind(setup, monkeypatch):
    c, _, _, _ = setup
    monkeypatch.setattr('brandguard.health.schema_heads', lambda: frozenset({'9999_future'}))
    r = c.get('/api/v1/health/ready')
    assert r.status_code == 503 and r.json()['code'] == 'not_ready'


def test_worker_heartbeat_reports_online_then_offline(setup):
    c, engine, _, _ = setup
    clear_heartbeats(engine)
    assert c.get('/api/v1/health/worker').json()['status'] == 'unknown'
    worker = worker_identity()
    beat(engine, worker, utcnow())
    body = c.get('/api/v1/health/worker').json()
    assert body['status'] == 'online' and body['worker_count'] == 1 and body['age_seconds'] < 5
    beat(engine, worker, utcnow())
    assert c.get('/api/v1/health/worker').json()['worker_count'] == 1
    with Session(engine) as db:
        db.execute(update(WorkerHeartbeat).values(seen_at=utcnow() - timedelta(seconds=90))); db.commit()
    body = c.get('/api/v1/health/worker').json()
    assert body['status'] == 'offline' and body['worker_count'] == 0
    assert c.get('/api/v1/health/ready').json()['worker'] == 'offline'
    clear_heartbeats(engine)


def test_version_reports_deployed_commit(setup, monkeypatch):
    c, _, _, _ = setup
    for name in ('GIT_COMMIT_SHA', 'RENDER_GIT_COMMIT', 'VERCEL_GIT_COMMIT_SHA', 'SOURCE_COMMIT'):
        monkeypatch.delenv(name, raising=False)
    assert c.get('/api/v1/health/version').json()['commit_sha'] == 'unknown'
    monkeypatch.setenv('RENDER_GIT_COMMIT', 'abc1234def')
    body = c.get('/api/v1/health/version').json()
    assert body['commit_sha'] == 'abc1234def' and body['environment'] == 'test'
