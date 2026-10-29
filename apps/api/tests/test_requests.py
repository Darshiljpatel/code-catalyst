from datetime import datetime, timedelta, timezone
from sqlalchemy import select
from sqlalchemy.orm import Session
from test_identity import setup, login
from test_review import activate, CONTEXT
from test_impact import drain, campaign, analyse, current
from brandguard.core import passwords
from brandguard.models import User, Membership, Finding

GUIDE_TEXT = 'Write LumaDesk. The free trial lasts 14 days.'
REASON = 'Headline style uses capitals; the brand name is spelled correctly.'


def name_rule(**extra):
    return dict(id='T01', category='terminology', kind='terminology', key='product_name', value='LumaDesk',
                evidence_quote='Write LumaDesk.', **extra)


def guide_body():
    return dict(source_key='brand_guide', title='LumaDesk guide', text=GUIDE_TEXT, rules=[name_rule(),
        dict(id='F01', category='facts_claims', kind='fact', key='trial_duration', value='14 days',
             evidence_quote='The free trial lasts 14 days.')],
        valid_from=(datetime.now(timezone.utc) - timedelta(days=1)).isoformat())


def add_lead(engine, org):
    """The brand lead: a second manager, so one person can finish the four-eyes flow in a demo."""
    with Session(engine) as db:
        user = User(email='lead@example.test', password_hash=passwords.hash('correct-password'))
        db.add(user); db.flush()
        db.add(Membership(user_id=user.id, org_id=org, role='manager')); db.commit()


def lead(c, org):
    r = c.post('/api/v1/sessions', json=dict(email='lead@example.test', password='correct-password', org_id=org),
               headers={'origin': 'https://testserver'})
    assert r.status_code == 200, r.text
    return {'origin': 'https://testserver', 'x-csrf-token': r.json()['csrf_token']}


def disputed_brand(c, engine, orgs, headlines=3):
    mh = login(c, orgs[0])
    bid = c.post('/api/v1/brands', json={'name': 'LumaDesk'}, headers=mh).json()['id']
    source = c.post(f'/api/v1/brands/{bid}/sources', json=guide_body(), headers=mh).json()
    assert activate(c, source['id'], mh).status_code == 200
    items = []
    for n in range(headlines):
        item, h = campaign(c, orgs, bid, f'Headline ad {n}', f'LUMADESK. Your desk, sorted. Offer {n}.')
        analyse(c, item, h)
        items.append(item)
    drain(engine)
    ch = login(c, orgs[0], 'creator')
    with Session(engine) as db:
        for item in items:
            finding = db.scalar(select(Finding).where(Finding.revision_id == item['revisions'][0]['id'], Finding.rule_id == 'T01'))
            assert finding is not None and finding.location['quote'] == 'LUMADESK'
            r = c.post(f'/api/v1/findings/{finding.id}/resolutions', json=dict(expected_item_version=current(c, item)['workflow_version'],
                action='request_dismissal', rationale=REASON), headers=ch)
            assert r.status_code == 201, r.text
    return bid, source, items


def start_request(c, orgs, bid, source):
    mh = login(c, orgs[0])
    health = c.get(f'/api/v1/brands/{bid}/guideline-health', headers=mh).json()
    row = next(r for r in health['rules'] if r['rule_id'] == 'T01')
    r = c.post('/api/v1/guideline-requests', json=dict(brand_id=bid, source_id=source['id'], rule_id='T01',
        title='All-caps brand name in headlines', problem='Reviewers keep dismissing LUMADESK in image headlines.'), headers=mh)
    assert r.status_code == 201, r.text
    return mh, row, r.json()


def label_and_save(c, mh, request, bid):
    labels = [dict(example_id=e['id'], expected='no_flag') for e in request['examples']]
    request = c.patch(f"/api/v1/guideline-requests/{request['id']}", json=dict(expected_version=request['version'], labels=labels), headers=mh).json()
    saved = c.post(f"/api/v1/guideline-requests/{request['id']}/example-set", headers=mh).json()
    for label, text in (('Misspelt brand', 'Try Lumadesk today.'), ('Split brand', 'Luma Desk is here.')):
        r = c.post(f"/api/v1/example-sets/{saved['id']}/cases", json=dict(label=label, text=text,
            expectations=[dict(source_key='brand_guide', rule_id='T01', expected='flag')]), headers=mh)
        assert r.status_code == 201, r.text
    return request, r.json()


def draft(c, mh, request, rule):
    r = c.put(f"/api/v1/guideline-requests/{request['id']}/draft", json=dict(expected_version=request['version'],
        title='LumaDesk guide', text=GUIDE_TEXT, rules=[rule, dict(id='F01', category='facts_claims', kind='fact',
        key='trial_duration', value='14 days', evidence_quote='The free trial lasts 14 days.')]), headers=mh)
    assert r.status_code == 200, r.text
    return r.json()


def publish(c, mh, request, bid, **extra):
    epoch = c.get(f'/api/v1/brands/{bid}', headers=mh).json()['source_epoch']
    return c.post(f"/api/v1/sources/{request['draft_source_id']}/activate", json=dict(expected_epoch=epoch, verified=True,
        retire_source_ids=[], rationale='Clearer brand-name rule after peer review.', **extra), headers=mh)


def test_unclear_rule_to_peer_reviewed_activation_and_recheck_inbox(setup):
    c, engine, orgs, _ = setup
    add_lead(engine, orgs[0])
    bid, source, items = disputed_brand(c, engine, orgs)
    mh, row, request = start_request(c, orgs, bid, source)
    assert row['disputed_items'] == 3 and row['likely_unclear'] and row['dispute_rate'] == 1.0
    assert len(request['examples']) == 3 and all(e['kind'] == 'dispute' and e['excerpt'] == 'LUMADESK' for e in request['examples'])
    assert request['examples'][0]['dispute']['rationale'] == REASON
    request, saved = label_and_save(c, mh, request, bid)
    assert len(saved['cases']) == 5
    request = draft(c, mh, request, name_rule(allowed_variants=['LUMADESK'], forbidden_variants=['Luma Desk']))
    assert [m['rule_id'] for m in request['diff']['modified']] == ['T01']
    assert request['diff']['modified'][0]['fields'] == ['allowed_variants', 'forbidden_variants']
    assert publish(c, mh, request, bid).json()['code'] == 'peer_review_required'
    comparison = c.post(f"/api/v1/guideline-requests/{request['id']}/comparisons", headers=mh).json()
    counts = comparison['summary']['counts']
    assert (counts['fixed'], counts['regressed'], counts['unchanged']) == (4, 0, 1)
    assert comparison['summary']['verdict'] == 'Fixes 4 examples, 0 regressions, 0 unstable cases.'
    assert comparison['summary']['proposed_metrics']['precision'] == 1.0 and comparison['summary']['proposed_metrics']['recall'] == 1.0
    assert comparison['summary']['live_metrics']['false_positives'] == 3
    review = dict(decision='approved', rationale='Checked the comparison and the allowed variant.', comparison_run_id=comparison['id'])
    assert c.post(f"/api/v1/guideline-requests/{request['id']}/reviews", json=review, headers=mh).status_code == 403
    assert c.post(f"/api/v1/guideline-requests/{request['id']}/reviews", json=review, headers=login(c, orgs[0], 'reviewer')).status_code == 403
    lh = lead(c, orgs[0])
    approved = c.post(f"/api/v1/guideline-requests/{request['id']}/reviews", json=review, headers=lh)
    assert approved.status_code == 201, approved.text
    assert approved.json()['gates']['can_activate']
    mh = login(c, orgs[0])
    # Editing the draft invalidates both the approval and the comparison.
    request = draft(c, mh, approved.json(), name_rule(allowed_variants=['LUMADESK'], forbidden_variants=['Luma Desk', 'Luma-Desk']))
    assert not request['gates']['approval_current'] and not request['gates']['comparison_current']
    assert publish(c, mh, request, bid).json()['code'] == 'peer_review_required'
    comparison = c.post(f"/api/v1/guideline-requests/{request['id']}/comparisons", headers=mh).json()
    stale = dict(review, comparison_run_id=approved.json()['comparisons'][0]['id'])
    lh = lead(c, orgs[0])
    assert c.post(f"/api/v1/guideline-requests/{request['id']}/reviews", json=stale, headers=lh).status_code == 409
    assert c.post(f"/api/v1/guideline-requests/{request['id']}/reviews", json=dict(review, comparison_run_id=comparison['id']), headers=lh).status_code == 201
    mh = login(c, orgs[0])
    activated = publish(c, mh, c.get(f"/api/v1/guideline-requests/{request['id']}", headers=mh).json(), bid)
    assert activated.status_code == 200, activated.text
    # Activation hands over to the Improvement 1 re-review inbox.
    change = c.get(f"/api/v1/guideline-changes/{activated.json()['change_id']}", headers=mh).json()
    assert {a['item_id'] for a in change['assignments']} == {i['id'] for i in items}
    assert all(a['impact_level'] == 'confirmed' for a in change['assignments'])
    final = c.get(f"/api/v1/guideline-requests/{request['id']}", headers=mh).json()
    assert final['status'] == 'activated' and final['change_id'] == change['id']
    assert [a['action'] for a in final['activity']][-1] == 'guideline_request.activated'
    drain(engine)
    # Rechecks under the clearer rule no longer flag the all-caps headline, and the change closes.
    with Session(engine) as db:
        rechecked = [a['recheck_run_id'] for a in change['assignments']]
        assert not list(db.scalars(select(Finding).where(Finding.run_id.in_(rechecked), Finding.rule_id == 'T01')))
    assert c.get(f"/api/v1/guideline-changes/{change['id']}", headers=mh).json()['status'] == 'closed'


def test_regressions_must_be_acknowledged_and_admin_can_review(setup):
    c, engine, orgs, _ = setup
    bid, source, _ = disputed_brand(c, engine, orgs)
    mh, _, request = start_request(c, orgs, bid, source)
    request, _ = label_and_save(c, mh, request, bid)
    # Allowing the misspelling too fixes the headlines but stops catching "Lumadesk".
    request = draft(c, mh, request, name_rule(allowed_variants=['LUMADESK', 'Lumadesk']))
    comparison = c.post(f"/api/v1/guideline-requests/{request['id']}/comparisons", headers=mh).json()
    assert comparison['summary']['counts']['regressed'] == 1
    regressed = next(case for case in comparison['summary']['cases'] if case['verdict'] == 'regressed')
    assert regressed['label'] == 'Misspelt brand' and regressed['live'] and not regressed['proposed']
    ah = login(c, orgs[0], 'admin')
    r = c.post(f"/api/v1/guideline-requests/{request['id']}/reviews", json=dict(decision='approved',
        rationale='Accepting the misspelling is a deliberate choice.', comparison_run_id=comparison['id']), headers=ah)
    assert r.status_code == 201, r.text
    mh = login(c, orgs[0])
    assert publish(c, mh, request, bid).json()['code'] == 'regression_unacknowledged'
    assert publish(c, mh, request, bid, regression_acknowledgement='Marketing approved the lowercase variant.').status_code == 200


def test_comparison_needs_examples_and_a_draft_and_requests_are_tenant_scoped(setup):
    c, engine, orgs, _ = setup
    mh = login(c, orgs[0])
    bid = c.post('/api/v1/brands', json={'name': 'Empty'}, headers=mh).json()['id']
    source = c.post(f'/api/v1/brands/{bid}/sources', json=guide_body(), headers=mh).json()
    activate(c, source['id'], mh)
    r = c.post('/api/v1/guideline-requests', json=dict(brand_id=bid, source_id=source['id'], rule_id='T01',
        title='Clarify brand name', problem='Try an all-caps variant for headlines.'), headers=mh)
    request = r.json()
    assert request['examples'] == []
    assert c.post(f"/api/v1/guideline-requests/{request['id']}/comparisons", headers=mh).json()['code'] == 'draft_required'
    request = draft(c, mh, request, name_rule(allowed_variants=['LUMADESK']))
    assert c.post(f"/api/v1/guideline-requests/{request['id']}/comparisons", headers=mh).json()['code'] == 'empty_example_set'
    assert c.patch(f"/api/v1/guideline-requests/{request['id']}", json=dict(expected_version=1), headers=mh).status_code == 409
    for role in ('creator', 'reviewer'):
        assert c.get(f"/api/v1/guideline-requests/{request['id']}", headers=login(c, orgs[0], role)).status_code == 403
    mh = login(c, orgs[0])
    bad = dict(name_rule(allowed_variants=['LUMADESK']), kind='fact', category='facts_claims')
    r = c.put(f"/api/v1/guideline-requests/{request['id']}/draft", json=dict(expected_version=request['version'],
        title='x', text=GUIDE_TEXT, rules=[bad]), headers=mh)
    assert r.status_code == 422


def test_ambiguity_reports_mark_the_rule_unclear_and_join_its_request(setup):
    c, engine, orgs, _ = setup
    mh = login(c, orgs[0])
    bid = c.post('/api/v1/brands', json={'name': 'LumaDesk'}, headers=mh).json()['id']
    source = c.post(f'/api/v1/brands/{bid}/sources', json=guide_body(), headers=mh).json()
    assert activate(c, source['id'], mh).status_code == 200
    item, h = campaign(c, orgs, bid, 'Headline ad', 'LUMADESK. Your desk, sorted.')
    report = dict(rule_id='T01', revision_id=item['revisions'][0]['id'],
                  rationale='Unclear whether an all-caps headline counts as the brand name.')
    assert c.post(f"/api/v1/sources/{source['id']}/ambiguity-reports", json=report, headers=h).status_code == 201
    other = dict(rule_id='F01', rationale='Unclear whether the trial length includes weekends at all.')
    assert c.post(f"/api/v1/sources/{source['id']}/ambiguity-reports", json=other, headers=h).status_code == 201
    mh = login(c, orgs[0])
    health = c.get(f'/api/v1/brands/{bid}/guideline-health', headers=mh).json()
    row = next(r for r in health['rules'] if r['rule_id'] == 'T01')
    assert row['disputed_items'] == 0 and row['ambiguity_reports'] == 1 and row['likely_unclear']
    mh, _, request = start_request(c, orgs, bid, source)
    # Only this rule's report joins, with the campaign it was raised on.
    assert [(e['kind'], e['dispute']['action']) for e in request['examples']] == [('ambiguity', 'ambiguity_report')]
    assert request['examples'][0]['excerpt'].startswith('LUMADESK') and request['examples'][0]['dispute']['rationale'] == report['rationale']
