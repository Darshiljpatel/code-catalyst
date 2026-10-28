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


def test_purge_redacts_guideline_request_copies_and_restore_reapplies_it(setup, tmp_path):
    import os
    from test_requests import add_lead, disputed_brand, start_request, label_and_save, draft, name_rule
    from brandguard.models import ComparisonResult, ComparisonRun, ExampleCase, RequestExample
    from infra.backup import create_backup, dump_database_records
    from infra.restore import restore_snapshot
    c, engine, orgs, _ = setup
    add_lead(engine, orgs[0])
    bid, source, items = disputed_brand(c, engine, orgs)
    mh, _, request = start_request(c, orgs, bid, source)
    request, saved = label_and_save(c, mh, request, bid)
    request = draft(c, mh, request, name_rule(allowed_variants=['LUMADESK']))
    comparison = c.post(f"/api/v1/guideline-requests/{request['id']}/comparisons", headers=mh).json()
    assert comparison['status'] == 'complete', comparison
    old, kept = items[0], items[1:]
    old_revision = old['revisions'][0]['id']
    with Session(engine) as db:
        # Only the first campaign is idle; the others are still being reviewed.
        db.execute(update(ContentItem).where(ContentItem.id.in_([i['id'] for i in kept])).values(state='in_review')); db.commit()
        old_case = db.scalar(select(ExampleCase.id).where(ExampleCase.origin_revision_id == old_revision))
        old_example = db.scalar(select(RequestExample.id).where(RequestExample.item_id == old['id']))
        assert old_case and old_example
    ah = login(c, orgs[0], 'admin')
    assert c.put('/api/v1/retention', json=dict(retention_days=30, rationale='Keep campaigns for a month.'), headers=ah).status_code == 200
    before = dump_database_records(os.environ['TEST_DATABASE_URL'])
    assert purge_expired_content(engine, now=utcnow() + timedelta(days=31)) == 1

    shown = c.get(f"/api/v1/guideline-requests/{request['id']}", headers=mh).json()
    assert len(shown['examples']) == 3
    redacted = [e for e in shown['examples'] if e['id'] == old_example][0]
    assert redacted['redacted_at'] and redacted['excerpt'] == ''
    assert all(e['excerpt'] == 'LUMADESK' and e['redacted_at'] is None for e in shown['examples'] if e['id'] != old_example)
    with Session(engine) as db:
        example = db.get(RequestExample, old_example)
        assert (example.text, example.context, example.expected) == ('', {}, 'no_flag')
        assert db.get(ExampleCase, old_case) is None
        assert db.scalar(select(func.count()).select_from(ExampleCase)) == 4
        results = list(db.scalars(select(ComparisonResult).where(ComparisonResult.case_id == old_case)))
        assert results and all(f['quote'] == '' for r in results for f in r.findings)
        summary = db.get(ComparisonRun, comparison['id']).summary
        removed = [case for case in summary['cases'] if case['case_id'] == old_case][0]
        assert removed['text'] == '' and removed['label'] == 'Removed by retention'
        assert all('Headline ad 0' not in case['text'] and 'Offer 0' not in case['text'] for case in summary['cases'])
        assert any('Offer 1' in case['text'] for case in summary['cases'])
        event = db.scalar(select(AuditEvent).where(AuditEvent.action == 'retention.purged'))
        assert event.details['redacted_examples'] == [old_example] and event.details['redacted_cases'] == [old_case]
        assert old_case in event.details['deleted_ids']
        ledger = [dict(action=e.action, object_id=e.object_id, details=e.details, created_at=e.created_at.isoformat())
                  for e in db.scalars(select(AuditEvent))]

    # Restoring a backup taken before the purge re-applies the deletions and the redactions from the ledger.
    tombstones = extract_tombstones(dict(audit_events=ledger))
    assert orgs[0] not in {t['target_id'] for t in tombstones}  # changing the period deletes nothing
    snapshot = tmp_path / 'snapshot.json'
    create_backup(snapshot, db_records=before, tombstones=tombstones)
    restored = restore_snapshot(snapshot)
    assert restored['status'] == 'success' and restored['redactions_reapplied'] >= 3
    tables = restored['tables']
    assert old['id'] not in {r['id'] for r in tables['content_items']}
    assert old_case not in {r['id'] for r in tables['example_cases']}
    example = [r for r in tables['request_examples'] if r['id'] == old_example][0]
    assert example['text'] == '' and example['excerpt'] == '' and example['redacted_at']
    assert sum(1 for r in tables['request_examples'] if r['text']) == 2
    assert all(f['quote'] == '' for r in tables['comparison_results'] if r['case_id'] == old_case for f in r['findings'])
    run = [r for r in tables['comparison_runs'] if r['id'] == comparison['id']][0]
    assert all('Offer 0' not in case['text'] for case in run['summary']['cases'])
