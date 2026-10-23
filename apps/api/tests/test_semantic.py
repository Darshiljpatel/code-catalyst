import asyncio
import copy
import json
from datetime import datetime, timedelta, timezone
import httpx
import pytest
from brandguard.semantic import NebiusReviewer, ProviderConfig, PRIMARY_MODEL

TEXT='😀 Sign up NOW!!!'
SOURCES=[dict(id='11111111-1111-1111-1111-111111111111',text='Use calm language.',
    valid_from='2026-01-01T00:00:00+00:00',valid_until=None,
    rules=[dict(id='TONE1',category='tone',kind='guidance',key='calm',value='Use calm language.',evidence_quote='Use calm language.')])]
FINDING=dict(category='tone',severity='advisory',evidence_status='supported_violation',
    source_version_id=SOURCES[0]['id'],rule_id='TONE1',evidence_quote='Use calm language.',
    content_quote=TEXT[2:],rationale='The all-caps urgent call conflicts with calm language.',suggested_edit='Start your trial.')


def response(finding=None):
    return dict(model=PRIMARY_MODEL,usage=dict(prompt_tokens=10,completion_tokens=50,total_tokens=60),
        choices=[dict(finish_reason='stop',message=dict(role='assistant',content=json.dumps(dict(
            evaluated_categories=['tone'],findings=[finding or copy.deepcopy(FINDING)]))))])


def review(data=None, *, config=None, sources=None, consent=True, status=200, handler=None, text=TEXT):
    requests=[]
    async def handle(request):
        requests.append(request)
        if handler:
            return await handler(request)
        return httpx.Response(status,json=data if data is not None else response())
    reviewer=NebiusReviewer(config or ProviderConfig(api_key='synthetic-test-key'),httpx.MockTransport(handle))
    result=asyncio.run(reviewer.review(text,{'channel':'email'},sources or SOURCES,consent=consent))
    return result,requests


def test_validated_unicode_location_and_minimal_request():
    result,requests=review()
    assert result.findings[0]['start']==2
    assert result.metadata['error_code'] is None and result.metadata['usage']['total_tokens']==60
    body=json.loads(requests[0].content)
    assert 'tools' not in body and body['stream'] is False
    assert body['model']==PRIMARY_MODEL and body['max_tokens']==1200
    assert 'synthetic-test-key' not in str(result.metadata)
    assert next(c for c in result.checks if c['category']=='tone')['status']=='complete'

@pytest.mark.parametrize('change,code',[
    ({'source_version_id':'invented'},'invalid_citation'),
    ({'rule_id':'invented'},'invalid_citation'),
    ({'evidence_quote':'not a quote'},'invalid_quote'),
    ({'content_quote':'does not exist'},'invalid_location'),
    ({'start':9999},'invalid_model_response'),
    ({'severity':'blocker'},'subjective_blocker'),
    ({'evidence_status':'contradicted'},'invalid_evidence_status'),
    ({'suggested_edit':'Guarantees 900% growth.'},'unsupported_edit_number'),
])
def test_t08_rejects_untrusted_findings(change,code):
    f=copy.deepcopy(FINDING);f.update(change)
    result,_=review(response(f))
    assert result.findings==[] and result.metadata['error_code']==code
    assert all(c['status']=='failed' for c in result.checks)

@pytest.mark.parametrize('mutation,code',[
    ('truncated','truncated_or_unfinished'),('model','model_mismatch'),
    ('tools','unexpected_model_action'),('json','invalid_model_response'),
    ('coverage','incomplete_coverage'),('duplicate','duplicate_finding'),
    ('extra','invalid_model_response')])
def test_t08_envelope_and_coverage_failures(mutation,code):
    data=response();message=data['choices'][0]['message']
    if mutation=='truncated':data['choices'][0]['finish_reason']='length'
    if mutation=='model':data['model']='other-model'
    if mutation=='tools':message['tool_calls']=[{'id':'publish'}]
    if mutation=='json':message['content']='{'
    if mutation in ('coverage','duplicate','extra'):
        inner=json.loads(message['content'])
        if mutation=='coverage':inner['evaluated_categories']=[]
        if mutation=='duplicate':inner['findings']*=2
        if mutation=='extra':inner['approve']=True
        message['content']=json.dumps(inner)
    result,_=review(data)
    assert result.metadata['error_code']==code and result.findings==[]

@pytest.mark.parametrize('status,code',[(401,'provider_auth_failed'),(403,'provider_auth_failed'),
    (429,'rate_limited'),(503,'provider_http_error')])
def test_t15_http_errors_never_echo_provider_body(status,code):
    result,_=review({'secret':'should-not-be-saved'},status=status)
    assert result.metadata['error_code']==code and 'should-not-be-saved' not in str(result)


def test_t20_no_outbound_request_without_consent_key_or_budget():
    result,requests=review(consent=False)
    assert not requests and result.metadata['error_code']=='external_processing_disabled'
    result,requests=review(config=ProviderConfig())
    assert not requests and result.metadata['error_code']=='provider_not_configured'
    result,requests=review(text='A'*25000)
    assert not requests and result.metadata['error_code']=='input_budget_exceeded'


def test_total_timeout_and_response_bound():
    async def slow(request):
        await asyncio.sleep(.1)
        return httpx.Response(200,json=response())
    result,_=review(config=ProviderConfig(api_key='test',timeout_seconds=.01),handler=slow)
    assert result.metadata['error_code']=='provider_timeout'
    async def enormous(request):
        return httpx.Response(200,content=b'x'*131073)
    result,_=review(handler=enormous)
    assert result.metadata['error_code']=='response_too_large'


def test_expired_or_invalid_source_rejected_before_network():
    sources=copy.deepcopy(SOURCES)
    sources[0]['valid_until']=(datetime.now(timezone.utc)-timedelta(seconds=1)).isoformat()
    result,requests=review(sources=sources)
    assert not requests and result.metadata['error_code']=='source_expired'
    sources[0]['valid_until']=None;sources[0]['text']='different'
    result,requests=review(sources=sources)
    assert not requests and result.metadata['error_code']=='invalid_source_quote'


def test_no_fallback_or_key_redirect():
    with pytest.raises(ValueError):ProviderConfig(model='unevaluated-model')
    with pytest.raises(ValueError):ProviderConfig(base_url='https://evil.test/')
    assert 'synthetic-test-key' not in repr(ProviderConfig(api_key='synthetic-test-key'))


def test_repeated_quote_is_rejected_without_guessing():
    result,_=review(text=TEXT+' '+TEXT)
    assert result.metadata['error_code']=='invalid_location' and not result.findings
