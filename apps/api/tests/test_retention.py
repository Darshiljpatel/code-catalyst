from datetime import timedelta
from sqlalchemy import select, func, update
from sqlalchemy.orm import Session
from test_identity import login
from test_workflow import setup, ready, submit, decide  # noqa: F401
from infra.backup import extract_tombstones
from brandguard.models import AuditEvent, ContentItem, ContentRevision, Decision, Finding, ReviewRun
from brandguard.retention import purge_expired_content, utcnow


def test_admin_retention_purges_old_campaigns_and_writes_a_restorable_ledger(setup):
    c, engine, orgs, item, run, rid = ready(setup)
    assert submit(c, orgs, item, run, rid).status_code == 200
    assert decide(c, orgs, item, run).status_code == 201
    mh = login(c, orgs[0], 'manager')
    assert c.put('/api/v1/retention', json=dict(retention_days=30, rationale='Keep campaigns for a month.'), headers=mh).status_code == 403
    ah = login(c, orgs[0], 'admin')
    assert c.put('/api/v1/retention', json=dict(retention_days=7, rationale='Too short.'), headers=ah).status_code == 422
    r = c.put('/api/v1/retention', json=dict(retention_days=30, rationale='Keep campaigns for a month.'), headers=ah)
    assert r.status_code == 200 and r.json() == dict(retention_days=30, purged_campaigns=0, last_purge_at=None)
    # Nothing is old enough yet.
    assert purge_expired_content(engine) == 0
    with Session(engine) as db:
        decision_id = db.scalar(select(Decision.id))
        finding_ids = list(db.scalars(select(Finding.id)))
    assert purge_expired_content(engine, now=utcnow() + timedelta(days=31)) == 1
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(ContentItem)) == 0
        assert db.scalar(select(func.count()).select_from(ContentRevision)) == 0
        assert db.scalar(select(func.count()).select_from(ReviewRun)) == 0
        events = list(db.scalars(select(AuditEvent).where(AuditEvent.action == 'retention.purged')))
        assert len(events) == 1 and events[0].object_id == item['id']
        ledger = events[0].details
        rows = [dict(action=e.action, object_id=e.object_id, details=e.details, created_at=e.created_at) for e in events]
    assert ledger['reason'] == 'retention_purge' and 'title' not in ledger
    ids = {t['target_id'] for t in extract_tombstones(dict(audit_events=rows))}
    assert {item['id'], item['revisions'][0]['id'], run['id'], decision_id, *finding_ids} <= ids
    status = c.get('/api/v1/retention', headers=ah).json()
    assert status['purged_campaigns'] == 1 and status['last_purge_at']


def test_active_campaigns_and_workspaces_without_retention_are_kept(setup):
    c, engine, orgs, item, run, rid = ready(setup)
    assert purge_expired_content(engine, now=utcnow() + timedelta(days=4000)) == 0
    ah = login(c, orgs[0], 'admin')
    assert c.put('/api/v1/retention', json=dict(retention_days=30, rationale='Keep campaigns for a month.'), headers=ah).status_code == 200
    with Session(engine) as db:
        db.execute(update(ContentItem).where(ContentItem.id == item['id']).values(state='in_review')); db.commit()
    assert purge_expired_content(engine, now=utcnow() + timedelta(days=31)) == 0
