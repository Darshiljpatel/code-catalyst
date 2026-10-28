import copy
from test_identity import login
from test_workflow import setup, ready, submit, decide  # noqa: F401


def test_downloaded_approval_record_verifies_and_tampering_is_named(setup):
    c, engine, orgs, item, run, rid = ready(setup)
    rev = item['revisions'][0]['id']
    assert submit(c, orgs, item, run, rid).status_code == 200
    assert decide(c, orgs, item, run).status_code == 201
    record = c.get(f'/api/v1/revisions/{rev}/export').json()
    h = login(c, orgs[0], 'manager')
    r = c.post('/api/v1/verify/approval-record', json=record, headers=h)
    assert r.status_code == 200, r.text
    result = r.json()
    assert result['verified'] and result['still_current'] and result['content_id'] == item['id']
    assert {x['code'] for x in result['checks']} == {'decision_found', 'approved', 'same_revision', 'text_unchanged', 'evidence_unchanged'}
    tampered = copy.deepcopy(record)
    tampered['text'] += ' Now 50% off!'
    tampered['evidence_record']['source_epoch'] = 99
    failed = c.post('/api/v1/verify/approval-record', json=tampered, headers=h).json()
    assert not failed['verified'] and not failed['still_current']
    assert sorted(x['code'] for x in failed['checks'] if not x['passed']) == ['evidence_unchanged', 'text_unchanged']
    invented = dict(record, decision=dict(record['decision'], id='00000000-0000-0000-0000-000000000000'))
    unknown = c.post('/api/v1/verify/approval-record', json=invented, headers=h).json()
    assert not unknown['verified'] and unknown['checks'][0]['code'] == 'decision_found' and not unknown['checks'][0]['passed']
    # A later revision means the approval is authentic but no longer current.
    ch = login(c, orgs[0], 'creator')
    assert c.post(f"/api/v1/content/{item['id']}/revisions", json=dict(parent_revision_id=rev, text='Try LumaDesk today.',
                  channel='email', audience='Customers', purpose='Trial'), headers=ch).status_code == 201
    later = c.post('/api/v1/verify/approval-record', json=record, headers=ch).json()
    assert later['verified'] and later['still_current'] is False
