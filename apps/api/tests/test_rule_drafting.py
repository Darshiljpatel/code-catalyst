import json
import httpx
from test_identity import setup, login
from test_orchestration import policy
from test_documents import make_docx
from brandguard.semantic import ProviderConfig, PRIMARY_MODEL

BOOK = ['Write LumaDesk with a capital D.', 'The free trial lasts 14 days.', 'Use calm, plain language.']


def answer(rules):
    return httpx.Response(200, json=dict(model=PRIMARY_MODEL, usage=dict(total_tokens=10),
        choices=[dict(finish_reason='stop', message=dict(role='assistant', content=json.dumps(dict(rules=rules))))]))


def test_manager_drafts_rules_from_a_brand_book_and_only_quoted_rules_survive(setup, monkeypatch):
    c, _, orgs, _ = setup
    mh = login(c, orgs[0])
    bid = c.post('/api/v1/brands', json={'name': 'LumaDesk'}, headers=mh).json()['id']
    imported = c.post('/api/v1/imports/document', files=dict(file=('brand book.docx', make_docx(BOOK), 'application/octet-stream')), headers=mh)
    assert imported.status_code == 201, imported.text
    body = dict(document_import_id=imported.json()['id'], external_processing_consent=True)
    assert c.post(f'/api/v1/brands/{bid}/rule-drafts', json=body, headers=mh).status_code == 404  # flag off
    monkeypatch.setenv('RULE_DRAFTING_ENABLED', '1')
    assert c.post(f'/api/v1/brands/{bid}/rule-drafts', json=body, headers=mh).json()['code'] == 'external_processing_disabled'
    assert policy(c, orgs).status_code == 200
    mh = login(c, orgs[0])
    requests = []
    async def handle(request):
        requests.append(json.loads(request.content))
        return answer([
            dict(category='terminology', kind='terminology', key='product_name', value='LumaDesk', evidence_quote='Write LumaDesk with a capital D.'),
            dict(category='facts_claims', kind='fact', key='trial_duration', value='14 days', evidence_quote='The free trial lasts 14 days.'),
            dict(category='facts_claims', kind='fact', key='price', value='$9', evidence_quote='Plans cost $9.'),
            dict(category='visual', kind='publish', key='x', value='y', evidence_quote='Use calm, plain language.')])
    c.app.state.provider_config = ProviderConfig(api_key='synthetic-test-key')
    c.app.state.provider_transport = httpx.MockTransport(handle)
    r = c.post(f'/api/v1/brands/{bid}/rule-drafts', json=body, headers=mh)
    assert r.status_code == 200, r.text
    result = r.json()
    assert [p['key'] for p in result['proposals']] == ['product_name', 'trial_duration'] and result['proposals'][0]['id'] == 'D01'
    assert [x['code'] for x in result['rejected']] == ['quote_not_in_brand_book', 'unsupported_kind']
    assert 'Write LumaDesk with a capital D.' in requests[0]['messages'][1]['content']
    # The proposals plus the brand book text are a valid draft source as they stand.
    source = c.post(f'/api/v1/brands/{bid}/sources', json=dict(source_key='brand_book', title='Brand book', text=result['source_text'],
                    rules=result['proposals'], valid_from='2026-01-01T00:00:00+00:00'), headers=mh)
    assert source.status_code == 201, source.text
    ch = login(c, orgs[0], 'creator')
    assert c.post(f'/api/v1/brands/{bid}/rule-drafts', json=body, headers=ch).status_code == 403
