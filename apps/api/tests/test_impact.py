from datetime import datetime, timedelta, timezone
from sqlalchemy import select
from sqlalchemy.orm import Session
from test_identity import setup, login
from test_review import activate, CONTEXT
from test_orchestration import reviewer, checker
from test_workflow import ready, submit, decide, current, assign, REASON
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
        title='Trial terms', text='The trial lasts 30 days. Use calm language. Write LumaDesk.', valid_from=old_source['valid_from'],
        rules=[dict(id='F01', category='facts_claims', kind='fact', key='trial_duration', value='30 days',
                    evidence_quote='The trial lasts 30 days.'),
               dict(id='G01', category='tone', kind='guidance', key='tone', value='Use calm language.',
                    evidence_quote='Use calm language.'),
               dict(id='T01', category='terminology', kind='terminology', key='product_name', value='LumaDesk',
                    evidence_quote='Write LumaDesk.')]), headers=mh).json()
    preview = c.get(f"/api/v1/sources/{new['id']}/impact-preview", headers=mh).json()
    # The copy names the product the changed guideline now covers: likely, so it goes back to the reviewer.
    assert preview['entries'][0]['impact_level'] == 'likely' and preview['entries'][0]['routing'] == 'hold'
    assert preview['counts']['on_hold'] == 1 and preview['counts']['keep_approval'] == 0
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
    assert current(c, item)['state'] == 'approved' and current(c, item)['recheck']['routing'] == 'keep'
    process_one(engine, reviewer(), blocking)
    state = current(c, item)
    assert state['state'] == 'needs_changes' and state['recheck']['status'] == 'awaiting_creator'
    assert state['recheck']['findings_delta']['new_blockers'] == 1
    # A possible-level campaign whose recheck finds something new is escalated to confirmed.
    assert state['recheck']['impact_level'] == 'confirmed' and state['recheck']['routing'] == 'hold'
    assert state['recheck']['reasons'][-1]['code'] == 'recheck_findings_changed'
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
    # Unchanged findings: the approval is kept, bound to the newest recheck only.
    assert current(c, item)['state'] == 'approved' and current(c, item)['recheck'] is None
    newer = c.get(f'/api/v1/guideline-changes/{second}', headers=mh).json()
    assert newer['status'] == 'closed' and newer['assignments'][0]['outcome'] == 'kept_approval'
    # Two managers activating against the same epoch: the loser gets a conflict.
    stale = c.post(f"/api/v1/brands/{item['brand_id']}/sources", json=body, headers=mh).json()
    assert activate(c, stale['id'], mh, 1).status_code == 409


def same_key(run, rules=None, text=None):
    s = run['source_snapshot'][0]
    return dict(source_key=s['source_key'], title=s['title'], text=text or s['text'], valid_from=s['valid_from'],
                rules=rules or s['rules'])


def longer_trial(run):
    """Change the trial rule: the copy "Try LumaDesk." never mentions the trial, so the impact is possible."""
    rules = [dict(r, value='30 days', evidence_quote='The trial lasts 30 days.') if r['id'] == 'F01' else r
             for r in run['source_snapshot'][0]['rules']]
    return same_key(run, rules, 'The trial lasts 30 days. Use calm language.')


def extra_tone_rule(run):
    """Add a tone rule the copy does not touch; tone was checked automatically, not by the reviewer."""
    rules = run['source_snapshot'][0]['rules'] + [dict(id='G02', category='tone', kind='guidance', key='exclamation_marks',
        value='Avoid exclamation marks.', evidence_quote='Avoid exclamation marks.')]
    return same_key(run, rules, run['source_snapshot'][0]['text'] + ' Avoid exclamation marks.')


def test_possible_campaign_keeps_its_approval_bound_to_the_recheck(setup):
    c, engine, orgs, item, run, rid = ready(setup)
    submit(c, orgs, item, run, rid)
    first = decide(c, orgs, item, run).json()
    first_record = c.get(f"/api/v1/revisions/{item['revisions'][0]['id']}/export").json()
    mh = login(c, orgs[0])
    new = c.post(f"/api/v1/brands/{item['brand_id']}/sources", json=longer_trial(run), headers=mh).json()
    preview = c.get(f"/api/v1/sources/{new['id']}/impact-preview", headers=mh).json()
    assert [(e["impact_level"], e["routing"]) for e in preview["entries"]] == [("possible", "keep")], preview["entries"][0]["reasons"]
    assert preview['counts']['on_hold'] == 0 and preview['counts']['keep_approval'] == 1
    change_id = activate(c, new['id'], mh, 1).json()['change_id']
    kept = current(c, item)
    assert kept['state'] == 'approved' and kept['recheck']['routing'] == 'keep'
    rev = item['revisions'][0]['id']
    # The approval is bound to the old guideline versions until the recheck confirms it.
    assert c.get(f'/api/v1/revisions/{rev}/export').json()['code'] == 'analysis_pending'
    drain(engine, engine_checker=checker)
    state = current(c, item)
    assert state['state'] == 'approved' and state['recheck'] is None
    change = c.get(f'/api/v1/guideline-changes/{change_id}', headers=mh).json()
    entry = change['assignments'][0]
    assert change['status'] == 'closed' and entry['status'] == 'resolved' and entry['outcome'] == 'kept_approval'
    assert entry['impact_level'] == 'possible' and entry['findings_delta']['added'] == [] and entry['resolved_decision_id']
    # Nobody is asked to look at it.
    rh = login(c, orgs[0], 'reviewer')
    assert c.get('/api/v1/content?recheck=mine', headers=rh).json()['items'] == []
    exported = c.get(f'/api/v1/revisions/{rev}/export')
    assert exported.status_code == 200, exported.text
    body = exported.json()
    assert body['decision']['id'] == entry['resolved_decision_id'] != first['id']
    record = body['evidence_record']
    assert [s['id'] for s in record['source_snapshot']] == [new['id']]
    assert record['approval_kept']['carried_from_decision_id'] == first['id']
    assert record['recheck_of'][0]['to_source_id'] == new['id']
    with Session(engine) as db:
        from brandguard.models import AuditEvent, Decision
        event = db.scalar(select(AuditEvent).where(AuditEvent.action == 'recheck.approval_kept'))
        assert event.details['item_id'] == item['id'] and event.details['source_ids'] == [new['id']]
        assert db.get(Decision, entry['resolved_decision_id']).carried_from_decision_id == first['id']
        recheck = db.scalar(select(ReviewRun).where(ReviewRun.trigger == 'guideline_change'))
        assert db.get(Decision, entry['resolved_decision_id']).run_id == recheck.id
    # The older record verifies but is no longer the current approval.
    mh = login(c, orgs[0])
    verdict = c.post('/api/v1/verify/approval-record', json=first_record, headers=mh).json()
    assert verdict['verified'] and verdict['still_current'] is False
    verdict = c.post('/api/v1/verify/approval-record', json=body, headers=mh).json()
    assert verdict['verified'] and verdict['still_current']


def test_possible_campaign_in_review_stays_with_its_reviewer(setup):
    c, engine, orgs, item, run, rid = ready(setup)
    assert submit(c, orgs, item, run, rid).status_code == 200
    mh = login(c, orgs[0])
    new = c.post(f"/api/v1/brands/{item['brand_id']}/sources", json=longer_trial(run), headers=mh).json()
    change_id = activate(c, new['id'], mh, 1).json()['change_id']
    assert current(c, item)['state'] == 'in_review'
    drain(engine, engine_checker=checker)
    assert current(c, item)['state'] == 'in_review' and current(c, item)['recheck'] is None
    entry = c.get(f'/api/v1/guideline-changes/{change_id}', headers=mh).json()['assignments'][0]
    assert entry['outcome'] == 'stayed_in_review' and entry['status'] == 'resolved'
    # The reviewer decides on the recheck, which used the new guideline version.
    with Session(engine) as db:
        recheck = db.scalar(select(ReviewRun).where(ReviewRun.trigger == 'guideline_change'))
        recheck_id, epoch = recheck.id, recheck.source_epoch
    r = c.post(f"/api/v1/revisions/{item['revisions'][0]['id']}/decisions", json=dict(
        expected_item_version=current(c, item)['workflow_version'], expected_run_id=recheck_id,
        expected_source_epoch=epoch, kind='approved', rationale=REASON), headers=login(c, orgs[0], 'reviewer'))
    assert r.status_code == 201, r.text


def test_failed_recheck_of_a_possible_campaign_goes_to_the_reviewer(setup):
    c, engine, orgs, item, run, rid = ready(setup)
    submit(c, orgs, item, run, rid); decide(c, orgs, item, run)
    mh = login(c, orgs[0])
    new = c.post(f"/api/v1/brands/{item['brand_id']}/sources", json=longer_trial(run), headers=mh).json()
    activate(c, new['id'], mh, 1)

    async def broken(inp):
        raise RuntimeError('engine down')
    process_one(engine, reviewer(), broken)
    state = current(c, item)
    assert state['state'] == 'in_review' and state['recheck']['status'] == 'awaiting_reviewer'
    assert state['recheck']['impact_level'] == 'possible' and state['recheck']['reasons'][-1]['code'] == 'recheck_failed'
    assert c.get(f"/api/v1/revisions/{item['revisions'][0]['id']}/export").status_code == 409


def manual_approval(c, orgs, item, run, rid):
    assign(c, orgs, item, rid)
    h = login(c, orgs[0], 'reviewer')
    result = c.get('/api/v1/runs/' + run['id']).json()
    source_id = result['source_snapshot'][0]['id']
    manual = []
    for check in result['checks']:
        if check['status'] in ('complete', 'not_applicable'):
            continue
        category = check['category']
        manual.append(category)
        r = c.post('/api/v1/runs/' + run['id'] + '/manual-checks', json=dict(
            expected_item_version=current(c, item)['workflow_version'], category=category,
            outcome='complete' if category == 'facts_claims' else 'not_applicable', rationale=REASON,
            source_version_ids=[source_id] if category == 'facts_claims' else []), headers=h)
        assert r.status_code == 201, r.text
    assert submit(c, orgs, item, run, rid).status_code == 200
    assert decide(c, orgs, item, run).status_code == 201
    return manual


def test_kept_approval_carries_manual_checks_only_for_untouched_categories(setup):
    c, engine, orgs, item, run, rid = ready(setup, incomplete=True)
    manual = manual_approval(c, orgs, item, run, rid)
    assert 'facts_claims' in manual and 'tone' not in manual
    mh = login(c, orgs[0])
    new = c.post(f"/api/v1/brands/{item['brand_id']}/sources", json=extra_tone_rule(run), headers=mh).json()
    entry = c.get(f"/api/v1/sources/{new['id']}/impact-preview", headers=mh).json()['entries'][0]
    assert entry['routing'] == 'keep', (entry['impact_level'], entry['reasons'])
    activate(c, new['id'], mh, 1)
    drain(engine, engine_checker=None)
    # Only a tone rule was added, so the reviewer's facts check still stands, citing the new version.
    assert current(c, item)['state'] == 'approved'
    record = c.get(f"/api/v1/revisions/{item['revisions'][0]['id']}/export").json()['evidence_record']
    facts = next(m for m in record['manual_checks'] if m['category'] == 'facts_claims')
    assert facts['source_version_ids'] == [new['id']]
    assert any(x['origin'] == 'human' for x in record['effective_checks'])


def test_kept_approval_needs_the_reviewer_when_a_manual_check_covered_the_changed_rule(setup):
    c, engine, orgs, item, run, rid = ready(setup, incomplete=True)
    manual_approval(c, orgs, item, run, rid)
    mh = login(c, orgs[0])
    # The trial rule changes and the copy does not mention it: possible, but the reviewer's
    # facts check was made against the old wording.
    new = c.post(f"/api/v1/brands/{item['brand_id']}/sources", json=longer_trial(run), headers=mh).json()
    preview = c.get(f"/api/v1/sources/{new['id']}/impact-preview", headers=mh).json()
    assert preview['entries'][0]['routing'] == 'keep'
    activate(c, new['id'], mh, 1)
    drain(engine, engine_checker=None)
    state = current(c, item)
    assert state['state'] == 'in_review' and state['recheck']['status'] == 'awaiting_reviewer'
    assert state['recheck']['reasons'][-1]['code'] == 'recheck_needs_reviewer'
    with Session(engine) as db:
        from brandguard.models import ManualCheck
        assert all(m.category != 'facts_claims' for m in db.scalars(select(ManualCheck).where(ManualCheck.carried_from_id.is_not(None))))
