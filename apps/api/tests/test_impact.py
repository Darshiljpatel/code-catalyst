from datetime import datetime, timedelta, timezone
from sqlalchemy import select
from sqlalchemy.orm import Session
from test_identity import setup, login
from test_review import activate, CONTEXT
from test_orchestration import reviewer, checker
from test_workflow import ready, submit, decide, current, REASON
from brandguard.engine_bridge import check_text
from brandguard.orchestration import process_one, EngineResult
from brandguard.models import ReviewRun, RecheckAssignment, GuidelineChange, Membership

GUIDE = 'Write LumaDesk. The free trial lasts {days}.'


def guide(days='14 days'):
    return dict(source_key='brand_guide', title='LumaDesk guide', text=GUIDE.format(days=days),
        rules=[dict(id='T01', category='terminology', kind='terminology', key='product_name', value='LumaDesk',
                    evidence_quote='Write LumaDesk.'),
               dict(id='F01', category='facts_claims', kind='fact', key='trial_duration', value=days,
                    evidence_quote=f'The free trial lasts {days}.')],
        valid_from=(datetime.now(timezone.utc) - timedelta(days=1)).isoformat())


def drain(engine, review=None, engine_checker=check_text):
    while process_one(engine, review or reviewer(), engine_checker):
        pass


def campaign(c, orgs, bid, title, text):
    h = login(c, orgs[0], 'creator')
    r = c.post('/api/v1/content', json=dict(brand_id=bid, title=title, text=text, **CONTEXT), headers=h)
    assert r.status_code == 201, r.text
    item = r.json()
    return item, h


def analyse(c, item, h):
    r = c.post(f"/api/v1/revisions/{item['revisions'][0]['id']}/analysis", headers={**h, 'Idempotency-Key': 'first-' + item['id']})
    assert r.status_code == 202, r.text


def brand_with_guide(c, h, name='LumaDesk'):
    bid = c.post('/api/v1/brands', json={'name': name}, headers=h).json()['id']
    s = c.post(f'/api/v1/brands/{bid}/sources', json=guide(), headers=h).json()
    assert activate(c, s['id'], h, c.get(f'/api/v1/brands/{bid}').json()['source_epoch']).status_code == 200
    return bid, s


def test_preview_lists_affected_campaigns_by_level_and_matches_the_inbox(setup):
    c, engine, orgs, _ = setup
    mh = login(c, orgs[0])
    bid, old = brand_with_guide(c, mh)
    other_bid, _ = brand_with_guide(c, mh, 'Second brand')
    texts = {'Confirmed': 'Start your 30-day free trial of LumaDesk.', 'Likely': 'Enjoy a free trial today.',
             'Possible': 'LumaDesk keeps your desk tidy.'}
    items = {}
    for title, text in texts.items():
        items[title], h = campaign(c, orgs, bid, title, text)
        analyse(c, items[title], h)
    never, _ = campaign(c, orgs, bid, 'Never analysed', 'A 30-day free trial.')
    elsewhere, h = campaign(c, orgs, other_bid, 'Other brand', 'Start your 30-day free trial.')
    analyse(c, elsewhere, h)
    drain(engine)
    mh = login(c, orgs[0])
    new = c.post(f'/api/v1/brands/{bid}/sources', json=guide('30 days'), headers=mh).json()
    with Session(engine) as db:
        before = sorted(db.scalars(select(GuidelineChange.id)))
    preview = c.get(f"/api/v1/sources/{new['id']}/impact-preview", headers=mh)
    assert preview.status_code == 200, preview.text
    body = preview.json()
    levels = {e['title']: e['impact_level'] for e in body['entries']}
    assert levels == {'Confirmed': 'confirmed', 'Likely': 'likely', 'Possible': 'possible'}
    assert [e['title'] for e in body['entries']] == ['Confirmed', 'Likely', 'Possible']
    assert body['counts']['total'] == 3 and body['counts']['brand_campaigns'] == 4
    assert [m['rule_id'] for m in body['diff']['modified']] == ['F01'] and body['diff']['modified'][0]['fields'] == ['value', 'evidence_quote']
    # The preview writes nothing.
    with Session(engine) as db:
        assert sorted(db.scalars(select(GuidelineChange.id))) == before
    r = activate(c, new['id'], mh, body['expected_epoch'])
    assert r.status_code == 200, r.text
    assert r.json()['impact_counts']['total'] == 3
    change = c.get(f"/api/v1/guideline-changes/{r.json()['change_id']}", headers=mh).json()
    assert len(change['assignments']) == body['counts']['total']
    assert {a['item_id'] for a in change['assignments']} == {items[t]['id'] for t in texts}
    assert never['id'] not in {a['item_id'] for a in change['assignments']}
    assert all(a['status'] == 'recheck_queued' and a['item_state'] == 'recheck_required' for a in change['assignments'])
    assert change['diff']['from_source']['id'] == old['id'] and change['from_version'] == 1 and change['to_version'] == 2
    listed = c.get(f'/api/v1/guideline-changes?brand_id={bid}&status=open', headers=mh).json()
    assert [x['id'] for x in listed] == [change['id']] and listed[0]['total'] == 3 and listed[0]['resolved'] == 0
    with Session(engine) as db:
        rechecks = list(db.scalars(select(ReviewRun).where(ReviewRun.trigger == 'guideline_change')))
        assert len(rechecks) == 3 and all(not r.processing_snapshot['enabled'] for r in rechecks)
    # Campaigns that only had their analysis refreshed close automatically once rechecked.
    drain(engine)
    change = c.get(f"/api/v1/guideline-changes/{change['id']}", headers=mh).json()
    assert change['status'] == 'closed' and change['resolved'] == 3
    # The other brand only has its own first publication, which affected nothing.
    assert [x['total'] for x in c.get(f'/api/v1/guideline-changes?brand_id={other_bid}', headers=mh).json()] == [0]


def test_reapproval_after_recheck_closes_the_change_and_export_names_both_versions(setup):
    c, engine, orgs, item, run, rid = ready(setup)
    assert submit(c, orgs, item, run, rid).status_code == 200
    assert decide(c, orgs, item, run).status_code == 201
    mh = login(c, orgs[0])
    old_source = run['source_snapshot'][0]
    new = c.post(f"/api/v1/brands/{item['brand_id']}/sources", json=dict(source_key=old_source['source_key'],
        title='Trial terms', text='The trial lasts 30 days. Use calm language.', valid_from=old_source['valid_from'],
        rules=[dict(id='F01', category='facts_claims', kind='fact', key='trial_duration', value='30 days',
                    evidence_quote='The trial lasts 30 days.'),
               dict(id='G01', category='tone', kind='guidance', key='tone', value='Use calm language.',
                    evidence_quote='Use calm language.')]), headers=mh).json()
    preview = c.get(f"/api/v1/sources/{new['id']}/impact-preview", headers=mh).json()
    assert preview['counts']['on_hold'] == 1
    change_id = activate(c, new['id'], mh, 1).json()['change_id']
    held = current(c, item)
    assert held['state'] == 'recheck_required' and held['recheck']['change_id'] == change_id
    rev = item['revisions'][0]['id']
    assert c.get(f'/api/v1/revisions/{rev}/export').status_code == 409
    process_one(engine, reviewer(), checker)
    with Session(engine) as db:
        recheck = db.scalar(select(ReviewRun).where(ReviewRun.trigger == 'guideline_change'))
        # Same revision text and same policy version: earlier consent carries forward.
        assert recheck.processing_snapshot['enabled'] and recheck.processing_snapshot['carried_from_run_id'] == run['id']
        recheck_id, epoch = recheck.id, recheck.source_epoch
    state = current(c, item)
    assert state['state'] == 'in_review' and state['recheck']['status'] == 'awaiting_reviewer'
    rh = login(c, orgs[0], 'reviewer')
    mine = c.get('/api/v1/content?recheck=mine', headers=rh).json()
    assert [i['id'] for i in mine['items']] == [item['id']] and mine['items'][0]['recheck_status'] == 'awaiting_reviewer'
    r = c.post(f'/api/v1/revisions/{rev}/decisions', json=dict(expected_item_version=state['workflow_version'],
        expected_run_id=recheck_id, expected_source_epoch=epoch, kind='approved', rationale=REASON), headers=rh)
    assert r.status_code == 201, r.text
    mh = login(c, orgs[0])
    change = c.get(f'/api/v1/guideline-changes/{change_id}', headers=mh).json()
    assert change['status'] == 'closed' and change['assignments'][0]['resolved_decision_id'] == r.json()['id']
    exported = c.get(f'/api/v1/revisions/{rev}/export')
    assert exported.status_code == 200, exported.text
    record = exported.json()['evidence_record']
    assert record['recheck_of'][0]['from_source_id'] == old_source['id'] and record['recheck_of'][0]['to_source_id'] == new['id']
    assert [s['id'] for s in record['source_snapshot']] == [new['id']]
    assert current(c, item)['recheck'] is None


def test_new_blockers_send_the_recheck_to_the_creator(setup):
    c, engine, orgs, item, run, rid = ready(setup)
    submit(c, orgs, item, run, rid); decide(c, orgs, item, run)
    mh = login(c, orgs[0])
    s = run['source_snapshot'][0]
    new = c.post(f"/api/v1/brands/{item['brand_id']}/sources", json=dict(source_key=s['source_key'], title=s['title'],
        text=s['text'], valid_from=s['valid_from'], rules=s['rules']), headers=mh).json()
    change_id = activate(c, new['id'], mh, 1).json()['change_id']

    async def blocking(inp):
        base = await checker(inp)
        src = inp.sources[0]
        return EngineResult(base.checks, [dict(category='facts_claims', severity='blocker', evidence_status='contradicted',
            source_version_id=src['id'], rule_id='F01', evidence_quote=src['rules'][0]['evidence_quote'], start=0,
            end=len(inp.text), content_quote=inp.text, rationale='Synthetic blocker fixture.', suggested_edit=None)])
    process_one(engine, reviewer(), blocking)
    state = current(c, item)
    assert state['state'] == 'needs_changes' and state['recheck']['status'] == 'awaiting_creator'
    assert state['recheck']['findings_delta']['new_blockers'] == 1
    ch = login(c, orgs[0], 'creator')
    assert [i['id'] for i in c.get('/api/v1/content?recheck=mine', headers=ch).json()['items']] == [item['id']]
    assert c.get(f'/api/v1/guideline-changes/{change_id}', headers=login(c, orgs[0])).json()['status'] == 'open'


def test_bulk_assignment_uses_version_guards_and_requeue_is_idempotent(setup):
    c, engine, orgs, item, run, rid = ready(setup)
    submit(c, orgs, item, run, rid); decide(c, orgs, item, run)
    mh = login(c, orgs[0])
    s = run['source_snapshot'][0]
    new = c.post(f"/api/v1/brands/{item['brand_id']}/sources", json=dict(source_key=s['source_key'], title=s['title'],
        text=s['text'], valid_from=s['valid_from'], rules=s['rules']), headers=mh).json()
    change_id = activate(c, new['id'], mh, 1).json()['change_id']
    assignment = c.get(f'/api/v1/guideline-changes/{change_id}', headers=mh).json()['assignments'][0]
    body = dict(assignment_ids=[assignment['id']], reviewer_id=rid, expected_versions={assignment['id']: assignment['version'] + 5})
    assert c.put('/api/v1/recheck-assignments/reviewer', json=body, headers=mh).status_code == 409
    body['expected_versions'] = {assignment['id']: assignment['version']}
    r = c.put('/api/v1/recheck-assignments/reviewer', json=body, headers=mh)
    assert r.status_code == 200 and r.json()[0]['reviewer_id'] == rid
    with Session(engine) as db:
        creator = db.scalar(select(Membership.id).where(Membership.role == 'creator'))
    body = dict(assignment_ids=[assignment['id']], reviewer_id=creator, expected_versions={assignment['id']: r.json()[0]['version']})
    assert c.put('/api/v1/recheck-assignments/reviewer', json=body, headers=mh).status_code == 422
    assert c.post(f'/api/v1/guideline-changes/{change_id}/rechecks', headers=mh).json()['queued'] == []
    assert c.post(f'/api/v1/guideline-changes/{change_id}/rechecks', headers=mh).json()['queued'] == []
    with Session(engine) as db:
        assert len(list(db.scalars(select(ReviewRun.id).where(ReviewRun.trigger == 'guideline_change')))) == 1
    for role in ('creator', 'reviewer', 'admin'):
        assert c.get(f'/api/v1/guideline-changes/{change_id}', headers=login(c, orgs[0], role)).status_code == 403


def test_a_second_change_supersedes_the_open_recheck(setup):
    c, engine, orgs, item, run, rid = ready(setup)
    submit(c, orgs, item, run, rid); decide(c, orgs, item, run)
    mh = login(c, orgs[0])
    s = run['source_snapshot'][0]
    body = dict(source_key=s['source_key'], title=s['title'], text=s['text'], valid_from=s['valid_from'], rules=s['rules'])
    first = activate(c, c.post(f"/api/v1/brands/{item['brand_id']}/sources", json=body, headers=mh).json()['id'], mh, 1).json()['change_id']
    second = activate(c, c.post(f"/api/v1/brands/{item['brand_id']}/sources", json=body, headers=mh).json()['id'], mh, 2).json()['change_id']
    older = c.get(f'/api/v1/guideline-changes/{first}', headers=mh).json()
    assert older['status'] == 'closed' and older['assignments'][0]['status'] == 'superseded'
    assert older['assignments'][0]['superseded_by'] == second
    newer = c.get(f'/api/v1/guideline-changes/{second}', headers=mh).json()
    # The newer entry keeps what was originally at stake: an approval.
    assert newer['status'] == 'open' and newer['assignments'][0]['state_before'] == 'approved'
    assert newer['assignments'][0]['prior_decision_id'] is not None
    drain(engine, engine_checker=checker)
    assert current(c, item)['state'] == 'in_review' and current(c, item)['recheck']['change_id'] == second
    # Two managers activating against the same epoch: the loser gets a conflict.
    stale = c.post(f"/api/v1/brands/{item['brand_id']}/sources", json=body, headers=mh).json()
    assert activate(c, stale['id'], mh, 1).status_code == 409
