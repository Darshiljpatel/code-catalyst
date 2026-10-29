from datetime import timedelta
from sqlalchemy import select, update, func
from sqlalchemy.orm import Session
from test_identity import setup, login
from test_impact import drain
from brandguard.demo import purge_expired, utcnow
from brandguard.models import Organisation, User, ContentItem, Membership

ORIGIN = {'origin': 'https://testserver'}


def sandbox(c, role='creator'):
    r = c.post('/api/v1/demo/sandboxes', json=dict(role=role), headers=ORIGIN)
    assert r.status_code == 201, r.text
    body = r.json()
    return body, {**ORIGIN, 'x-csrf-token': body['csrf_token']}


def switch(c, h, members, label):
    target = next(m for m in members if m['label'] == label)
    r = c.post('/api/v1/demo/switch', json=dict(membership_id=target['membership_id']), headers=h)
    assert r.status_code == 200, r.text
    return {**ORIGIN, 'x-csrf-token': r.json()['csrf_token']}


def test_private_demo_signs_in_with_five_roles_and_seeded_campaigns(setup):
    c, engine, _, _ = setup
    body, h = sandbox(c)
    me = c.get('/api/v1/me').json()
    assert me['is_demo'] and me['label'] == 'Creator' and me['role'] == 'creator' and me['org_id'] == body['org_id']
    assert [m['label'] for m in body['members']] == ['Creator', 'Reviewer', 'Manager', 'Brand lead', 'Admin']
    states = {i['title']: i['state'] for i in c.get('/api/v1/content?limit=50').json()['items']}
    assert states['Spring newsletter'] == 'approved' and states['Partner email'] == 'in_review'
    assert states['Product launch email'] == 'changes_requested' and states['Social post draft'] == 'draft'
    assert states['Social ad (image, check text)'] == 'text_check' and states['Display ad (image)'] == 'approved'
    h = switch(c, h, body['members'], 'Manager')
    brands = {b['name']: b['id'] for b in c.get('/api/v1/brands').json()}
    assert set(brands) == {'LumaDesk', 'Northwind Bikes'}
    health = c.get(f"/api/v1/brands/{brands['LumaDesk']}/guideline-health").json()
    brand_rule = next(r for r in health['rules'] if r['rule_id'] == 'T01')
    assert brand_rule['likely_unclear'] and brand_rule['disputed_items'] == 4
    with Session(engine) as db:
        org = db.get(Organisation, body['org_id'])
        assert org.daily_run_limit == 25 and org.expires_at - org.created_at == timedelta(hours=48)
    # Another judge's sandbox is a separate workspace.
    other, _ = sandbox(c, 'manager')
    assert other['org_id'] != body['org_id']
    assert all(b['id'] not in brands.values() for b in c.get('/api/v1/brands').json())


def test_role_switch_keeps_separation_of_duties(setup):
    c, _, orgs, _ = setup
    body, h = sandbox(c)
    items = {i['title']: i for i in c.get('/api/v1/content?limit=50').json()['items']}
    partner = c.get(f"/api/v1/content/{items['Partner email']['id']}").json()
    review = c.get(f"/api/v1/revisions/{partner['revisions'][0]['id']}/review").json()
    decision = dict(expected_item_version=partner['workflow_version'], expected_run_id=review['run_id'], expected_source_epoch=1,
                    kind='approved', rationale='Trying to approve my own campaign as the creator.')
    assert c.post(f"/api/v1/revisions/{partner['revisions'][0]['id']}/decisions", json=decision, headers=h).status_code == 403
    h = switch(c, h, body['members'], 'Reviewer')
    assert c.get('/api/v1/me').json()['label'] == 'Reviewer'
    r = c.post(f"/api/v1/revisions/{partner['revisions'][0]['id']}/decisions", json=dict(decision, rationale='Checked against the guide as the reviewer.'), headers=h)
    assert r.status_code == 201, r.text
    # The switcher only works inside demo workspaces.
    h = login(c, orgs[0])
    assert c.post('/api/v1/demo/switch', json=dict(membership_id=body['members'][0]['membership_id']), headers=h).status_code == 403
    assert c.get('/api/v1/demo/members').status_code == 404


def test_demo_story_runs_all_three_improvements_locally(setup):
    """Unclear rule -> request -> comparison -> brand lead approves -> publish -> image campaigns rechecked."""
    c, engine, _, _ = setup
    body, h = sandbox(c, 'manager')
    brand = next(b for b in c.get('/api/v1/brands').json() if b['name'] == 'LumaDesk')
    rule = next(r for r in c.get(f"/api/v1/brands/{brand['id']}/guideline-health").json()['rules'] if r['rule_id'] == 'T01')
    request = c.post('/api/v1/guideline-requests', json=dict(brand_id=brand['id'], source_id=rule['source_id'], rule_id='T01',
        title='All-caps brand name in headlines', problem='Reviewers keep dismissing LUMADESK in headlines.'), headers=h).json()
    assert len(request['examples']) == 4
    request = c.patch(f"/api/v1/guideline-requests/{request['id']}", json=dict(expected_version=request['version'],
        labels=[dict(example_id=e['id'], expected='no_flag') for e in request['examples']]), headers=h).json()
    c.post(f"/api/v1/guideline-requests/{request['id']}/example-set", headers=h)
    base = request['base_source']
    rules = [dict(r, allowed_variants=['LUMADESK'], forbidden_variants=['Luma Desk']) if r['id'] == 'T01' else r for r in base['rules']]
    rules = [{k: v for k, v in r.items() if v is not None} for r in rules]
    request = c.put(f"/api/v1/guideline-requests/{request['id']}/draft", json=dict(expected_version=request['version'],
        title=base['title'], text=base['text'], rules=rules), headers=h).json()
    comparison = c.post(f"/api/v1/guideline-requests/{request['id']}/comparisons", headers=h).json()
    assert comparison['summary']['counts']['regressed'] == 0 and comparison['summary']['counts']['fixed'] >= 4
    lead = switch(c, h, body['members'], 'Brand lead')
    r = c.post(f"/api/v1/guideline-requests/{request['id']}/reviews", json=dict(decision='approved',
        rationale='The capitals variant is fine; misspellings are still caught.', comparison_run_id=comparison['id']), headers=lead)
    assert r.status_code == 201, r.text
    h = switch(c, lead, body['members'], 'Manager')
    preview = c.get(f"/api/v1/sources/{request['draft_source_id']}/impact-preview", headers=h).json()
    r = c.post(f"/api/v1/sources/{request['draft_source_id']}/activate", json=dict(expected_epoch=preview['expected_epoch'],
        verified=True, retire_source_ids=[], rationale='Peer-reviewed clearer brand-name rule.'), headers=h)
    assert r.status_code == 200, r.text
    change = c.get(f"/api/v1/guideline-changes/{r.json()['change_id']}", headers=h).json()
    assert len(change['assignments']) == preview['counts']['total']
    levels = {a['title']: a['impact_level'] for a in change['assignments']}
    assert levels['Display ad (image)'] == 'confirmed' and levels['Headline ad 1'] == 'confirmed'
    drain(engine)
    change = c.get(f"/api/v1/guideline-changes/{change['id']}", headers=h).json()
    display = next(a for a in change['assignments'] if a['title'] == 'Display ad (image)')
    # The approved image ad goes straight back to its reviewer: the all-caps finding cleared.
    assert display['status'] == 'awaiting_reviewer' and any(f['rule_id'] == 'T01' for f in display['findings_delta']['removed'])


def test_sandbox_limits_purge_and_switch_off(setup, monkeypatch):
    c, engine, _, _ = setup
    monkeypatch.setattr('brandguard.demo.PER_ADDRESS_PER_HOUR', 1)
    body, _ = sandbox(c)
    assert c.post('/api/v1/demo/sandboxes', json={}, headers=ORIGIN).status_code == 429
    assert c.post('/api/v1/demo/sandboxes', json={}).status_code == 403
    monkeypatch.setenv('DEMO_SANDBOXES_ENABLED', '0')
    assert c.post('/api/v1/demo/sandboxes', json={}, headers=ORIGIN).status_code == 404
    with Session(engine) as db:
        users = list(db.scalars(select(Membership.user_id).where(Membership.org_id == body['org_id'])))
        db.execute(update(Organisation).where(Organisation.id == body['org_id']).values(expires_at=utcnow() - timedelta(minutes=1)))
        db.commit()
    assert c.get('/api/v1/me').status_code == 200
    assert purge_expired(engine) == 1
    with Session(engine) as db:
        assert db.get(Organisation, body['org_id']) is None
        assert db.scalar(select(func.count()).select_from(ContentItem).where(ContentItem.org_id == body['org_id'])) == 0
        assert db.scalar(select(func.count()).select_from(User).where(User.id.in_(users))) == 0
    assert c.get('/api/v1/me').status_code == 401


def test_pooled_sandbox_is_claimed_instantly_with_a_fresh_clock(setup):
    from brandguard.demo import fill_pool, POOL_MARK
    c, engine, _, _ = setup
    settings = c.app.state.settings
    assert fill_pool(engine, settings, size=1) == 1 and fill_pool(engine, settings, size=1) == 0
    with Session(engine) as db:
        pooled = db.scalar(select(Organisation.id).where(Organisation.created_ip_hash == POOL_MARK))
    body, _ = sandbox(c, 'reviewer')
    assert body['org_id'] == pooled and c.get('/api/v1/me').json()['label'] == 'Reviewer'
    with Session(engine) as db:
        org = db.get(Organisation, pooled)
        assert org.created_ip_hash != POOL_MARK and org.expires_at - org.created_at == timedelta(hours=48)
    # The pool is empty again, so the next judge gets a freshly provisioned workspace.
    assert sandbox(c)[0]['org_id'] != pooled
