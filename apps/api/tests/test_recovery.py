"""A real PostgreSQL recovery must preserve approved API exports, including JSON/FKs."""
import os
import subprocess
import sys
import uuid
from pathlib import Path
import pytest
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from fastapi.testclient import TestClient
from brandguard.main import create_app, Settings
from infra.backup import create_backup, dump_database_records
from infra.restore import restore_snapshot
from test_identity import setup, login
from test_workflow import ready, submit, decide


def test_postgresql_recovery_preserves_approved_export(setup, tmp_path):
    client, engine, orgs, item, run, _ = ready(setup)
    assert submit(client, orgs, item, run, _).status_code == 200
    assert decide(client, orgs, item, run).status_code == 201
    revision = item['revisions'][0]['id']
    before = client.get(f'/api/v1/revisions/{revision}/export').json()
    snapshot = tmp_path / 'backup.json'
    records = dump_database_records(os.environ['TEST_DATABASE_URL'])
    assert 'finding_resolutions' in records and 'sessions' not in records
    create_backup(snapshot, records)
    # CREATE DATABASE privilege is required by this dedicated recovery test.
    source = make_url(os.environ['TEST_DATABASE_URL'])
    name = 'brandguard_restore_' + uuid.uuid4().hex[:12]
    admin = create_engine(source, isolation_level='AUTOCOMMIT')
    target = source.set(database=name).render_as_string(hide_password=False)
    restored_app = None
    with admin.connect() as conn:
        conn.exec_driver_sql(f'CREATE DATABASE "{name}" TEMPLATE template0 ENCODING \'UTF8\'')
    try:
        subprocess.run([sys.executable, '-m', 'alembic', '-c', 'apps/api/alembic.ini', 'upgrade', 'head'],
                       env={**os.environ, 'DATABASE_URL': target}, check=True, capture_output=True)
        result = restore_snapshot(snapshot, target_db_url=target)
        assert result['status'] == 'success', result.get('error')
        assert result['db_restored']['decisions'] == 1
        restored_app = create_app(Settings(target, 'https://testserver', 'test'))
        with TestClient(restored_app, base_url='https://testserver') as recovered:
            login(recovered, orgs[0], 'reviewer')
            response = recovered.get(f'/api/v1/revisions/{revision}/export')
            assert response.status_code == 200
            after = response.json()
            for key in ('text', 'text_hash', 'decision', 'evidence_record'):
                assert before[key] == after[key]
        # A second restore must fail rather than silently skipping conflicts.
        assert restore_snapshot(snapshot, target_db_url=target)['status'] == 'failed'
    finally:
        if restored_app:
            restored_app.state.engine.dispose()
        with admin.connect() as conn:
            conn.exec_driver_sql(f'DROP DATABASE "{name}" WITH (FORCE)')
        admin.dispose()


def test_csrf_is_recovered_after_page_reload(setup):
    client, _, orgs, _ = setup
    headers = login(client, orgs[0])
    first = client.get('/api/v1/me').json()
    second = client.get('/api/v1/me').json()
    assert first['csrf_token'] == second['csrf_token'] == headers['x-csrf-token']
    assert first['membership_id']
    response = client.post('/api/v1/brands', json={'name':'Reloaded'}, headers={
        'origin':'https://testserver', 'x-csrf-token':second['csrf_token']})
    assert response.status_code == 201
