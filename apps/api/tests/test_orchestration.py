import asyncio
import json
from datetime import timedelta
import httpx
import pytest
from sqlalchemy import select, update, func
from sqlalchemy.orm import Session
from test_identity import setup,login
from test_review import brand,source,source_body,activate,content,count
from brandguard.models import Finding,Job,ReviewRun,ContentItem,AuditEvent
from brandguard.orchestration import (process_one,claim_one,analyse_claim,finish_claim,
                                      EngineResult,utcnow,DETERMINISTIC)
from brandguard.semantic import ProviderConfig,NebiusReviewer,PRIMARY_MODEL

NOTICE='Content and eligible approved passages will be sent to Nebius Token Factory for AI review. Synthetic demo data only.'

def policy(c,orgs,enabled=True,version=0):
    h=login(c,orgs[0],'admin')
    return c.put('/api/v1/processing-policy',json=dict(enabled=enabled,expected_version=version,
        notice=NOTICE,rationale='Approved synthetic evaluation processing.'),headers=h)

def prepared(setup,enable=True,consent=True):
    c,engine,orgs,_=setup
    bid,mh=brand(c,orgs)
    body=source_body();body['text']+=' Use calm language.'
    body['rules'].append(dict(id='G01',category='tone',kind='guidance',key='tone',value='Use calm language.',evidence_quote='Use calm language.'))
    s=c.post(f'/api/v1/brands/{bid}/sources',json=body,headers=mh).json();activate(c,s['id'],mh)
    if enable:assert policy(c,orgs).status_code==200
    item,ch=content(c,orgs,bid)
    r=c.post(f"/api/v1/revisions/{item['revisions'][0]['id']}/analysis",
        json=dict(external_processing_consent=consent,policy_version=1 if consent else None),
        headers={**ch,'Idempotency-Key':'semantic-run'})
    assert r.status_code==202,r.text
    return c,engine,orgs,item,r.json()

def reviewer(calls=None,malformed=False):
    async def handle(request):
        if calls is not None:calls.append(request)
        payload=json.loads(json.loads(request.content)['messages'][1]['content'])
        guidance=next((r for r in payload['rules'] if r['kind']=='guidance'),None)
        findings=[]
        if guidance:
            findings.append(dict(source_version_id=guidance['source_version_id'],rule_id=guidance['id'],
                evidence_quote=guidance['evidence_quote'],content_quote=payload['text'],
                rationale='Synthetic adapter integration fixture, not a quality assessment.',suggested_edit=None))
        return httpx.Response(200,json=dict(model=PRIMARY_MODEL,usage=dict(total_tokens=100),
            choices=[dict(finish_reason='stop',message=dict(role='assistant',content='{' if malformed else
                json.dumps(dict(evaluated_categories=payload['categories'],findings=findings))))]))
    return NebiusReviewer(ProviderConfig(api_key='synthetic-key'),httpx.MockTransport(handle))

async def checker(review_input):
    return EngineResult([dict(category=c,status='complete',reason='Synthetic test checker executed.') for c in DETERMINISTIC],[])


def test_t20_admin_policy_and_explicit_creator_consent(setup):
    c,engine,orgs,_=setup
    bid,h=brand(c,orgs)
    assert c.put('/api/v1/processing-policy',json=dict(enabled=True,expected_version=0,notice=NOTICE,rationale='Manager should not approve.'),headers=h).status_code==403
    s=source(c,bid,h);activate(c,s['id'],h)
    item,ch=content(c,orgs,bid)
    path=f"/api/v1/revisions/{item['revisions'][0]['id']}/analysis"
    assert c.post(path,json=dict(external_processing_consent=True,policy_version=1),headers={**ch,'Idempotency-Key':'policy-check'}).status_code==409
    assert count(engine,Job)==0
    assert policy(c,orgs).status_code==200
    assert policy(c,orgs,version=0).status_code==409
    ch=login(c,orgs[0],'creator')
    result=c.post(path,headers={**ch,'Idempotency-Key':'local-review'})
    assert result.status_code==202 and not result.json()['processing_snapshot']['enabled']
    calls=[];process_one(engine,reviewer(calls),checker)
    assert calls==[]
    assert c.get('/api/v1/runs/'+result.json()['id']).json()['status']=='incomplete'


def test_validated_results_are_persisted_and_scoped(setup):
    c,engine,orgs,item,run=prepared(setup)
    assert process_one(engine,reviewer(),checker)
    result=c.get('/api/v1/runs/'+run['id']).json()
    assert result['status']=='complete' and len(result['findings'])==1
    f=result['findings'][0]
    assert f['origin']=='model' and f['revision_id']==item['revisions'][0]['id']
    assert f['location']['quote']=='Try LumaDesk.'
    assert result['engine_metadata']['semantic']['requested_model']==PRIMARY_MODEL
    assert c.get('/api/v1/content/'+item['id']).json()['revisions'][0]['text']=='Try LumaDesk.'
    with Session(engine) as db:
        assert db.scalar(select(Job)).status=='complete'
    login(c,orgs[0],'admin')
    assert c.get('/api/v1/runs/'+run['id']).status_code==404


def test_missing_deterministic_engine_cannot_be_complete(setup):
    c,engine,_,_,run=prepared(setup)
    process_one(engine,reviewer())
    result=c.get('/api/v1/runs/'+run['id']).json()
    assert result['status']=='incomplete' and len(result['findings'])==1
    assert next(x for x in result['checks'] if x['category']=='terminology')['status']=='unavailable'


def test_invalid_semantic_response_preserves_valid_deterministic_findings(setup):
    c,engine,_,_,run=prepared(setup)
    # An injected checker using the existing fact source; deterministic claims are validated too.
    async def facts(review_input):
        src=review_input.sources[0]
        return EngineResult([dict(category=x,status='complete',reason='Fixture') for x in DETERMINISTIC],
            [dict(category='facts_claims',severity='warning',evidence_status='contradicted',source_version_id=src['id'],
             rule_id='F01',evidence_quote='The trial lasts 14 days.',start=0,end=len(review_input.text),
             content_quote=review_input.text,rationale='Test fixture finding.',suggested_edit=None)])
    process_one(engine,reviewer(malformed=True),facts)
    result=c.get('/api/v1/runs/'+run['id']).json()
    assert result['status']=='incomplete' and len(result['findings'])==1
    assert result['findings'][0]['origin']=='deterministic'
    assert result['engine_metadata']['semantic']['error_code']=='invalid_model_response'


def test_policy_revocation_cancels_dispatch(setup):
    c,engine,orgs,_,run=prepared(setup)
    assert policy(c,orgs,False,1).status_code==200
    calls=[];process_one(engine,reviewer(calls),checker)
    assert not calls
    login(c,orgs[0],'creator')
    assert c.get('/api/v1/runs/'+run['id']).json()['status']=='incomplete'


def test_t14_lease_reclaim_rejects_late_completion(setup):
    c,engine,_,_,run=prepared(setup)
    old=claim_one(engine)
    with Session(engine) as db:
        db.execute(update(Job).where(Job.id==old.job_id).values(lease_expires_at=utcnow()-timedelta(seconds=1)));db.commit()
    current=claim_one(engine)
    assert old.lease_token!=current.lease_token
    checks,findings,metadata=asyncio.run(analyse_claim(engine,current,reviewer(),checker))
    assert not finish_claim(engine,old,checks,findings,metadata)
    assert finish_claim(engine,current,checks,findings,metadata)
    assert not finish_claim(engine,current,checks,findings,metadata)
    assert count(engine,Finding)==1
    with Session(engine) as db:
        assert db.scalar(select(Job)).attempts==2


def test_edit_during_analysis_does_not_replace_new_revision_state(setup):
    c,engine,orgs,item,run=prepared(setup)
    claim=claim_one(engine)
    result=asyncio.run(analyse_claim(engine,claim,reviewer(),checker))
    h=login(c,orgs[0],'creator')
    r=c.post('/api/v1/content/'+item['id']+'/revisions',json=dict(parent_revision_id=item['revisions'][0]['id'],
        text='New text.',channel='email',audience='Customers',purpose='Trial'),headers=h)
    assert r.status_code==201
    assert finish_claim(engine,claim,*result)
    assert c.get('/api/v1/content/'+item['id']).json()['state']=='draft'
    finished=c.get('/api/v1/runs/'+run['id']).json()
    assert finished['status']=='incomplete' and finished['stale']


def test_t14_concurrent_workers_claim_each_job_once(setup):
    from concurrent.futures import ThreadPoolExecutor
    _,engine,_,_,_=prepared(setup)
    with ThreadPoolExecutor(max_workers=2) as pool:
        claims=list(pool.map(lambda _:claim_one(engine),range(2)))
    assert sum(c is not None for c in claims)==1


def test_t15_expired_deadline_and_exhausted_attempts_fail_closed(setup):
    c,engine,_,_,run=prepared(setup)
    claim=claim_one(engine)
    with Session(engine) as db:
        db.execute(update(Job).where(Job.id==claim.job_id).values(attempts=3,lease_expires_at=utcnow()-timedelta(seconds=1)));db.commit()
    calls=[];process_one(engine,reviewer(calls),checker)
    assert not calls
    result=c.get('/api/v1/runs/'+run['id']).json()
    assert result['status']=='incomplete' and all(x['reason']=='attempts_exhausted' for x in result['checks'])


def test_external_daily_limit_is_transactionally_reserved(setup):
    from dataclasses import replace
    c,engine,orgs,item,run=prepared(setup)
    c.app.state.settings=replace(c.app.state.settings,max_external_runs_per_day=1)
    process_one(engine,reviewer(),checker)
    h=login(c,orgs[0],'creator')
    r=c.post('/api/v1/content/'+item['id']+'/revisions',json=dict(parent_revision_id=item['revisions'][0]['id'],
        text='Another draft.',channel='email',audience='Customers',purpose='Trial'),headers=h)
    rev=r.json()['revisions'][-1]['id']
    r=c.post(f'/api/v1/revisions/{rev}/analysis',json=dict(external_processing_consent=True,policy_version=1),
             headers={**h,'Idempotency-Key':'second-external'})
    assert r.status_code==429 and r.json()['code']=='external_budget_exceeded'
    assert count(engine,Job)==1


def test_queued_job_past_deadline_never_sends_content(setup):
    c,engine,_,_,run=prepared(setup)
    from dataclasses import replace
    claim=claim_one(engine)
    expired=replace(claim,claimed_at=utcnow()-timedelta(seconds=61))
    calls=[]
    checks,findings,metadata=asyncio.run(analyse_claim(engine,expired,reviewer(calls),checker))
    assert not calls and not findings and metadata['error_code']=='deadline_exceeded'


def test_deadline_starts_at_claim_not_at_queue_time(setup,monkeypatch):
    c,engine,_,_,run=prepared(setup)
    # The worker wakes five minutes after the run was queued.
    monkeypatch.setattr('brandguard.orchestration.utcnow',lambda:utcnow()+timedelta(minutes=5))
    calls=[];process_one(engine,reviewer(calls),checker)
    result=c.get('/api/v1/runs/'+run['id']).json()
    assert calls and not any(x['reason']=='deadline_exceeded' for x in result['checks'])


def test_current_policy_required_again_at_dispatch(setup):
    c,engine,orgs,_,run=prepared(setup)
    # Even an enabled policy with new text requires a fresh creator acknowledgement.
    assert policy(c,orgs,True,1).status_code==200
    calls=[]
    process_one(engine,reviewer(calls),checker)
    assert not calls


def test_processing_consent_and_finding_evidence_are_immutable(setup):
    from sqlalchemy.exc import IntegrityError
    c,engine,_,_,run=prepared(setup)
    with Session(engine) as db,pytest.raises(IntegrityError):
        db.execute(update(ReviewRun).where(ReviewRun.id==run['id']).values(processing_snapshot={'enabled':False}));db.commit()
    process_one(engine,reviewer(),checker)
    with Session(engine) as db:
        finding=db.scalar(select(Finding))
        finding_id=finding.id
    with Session(engine) as db,pytest.raises(IntegrityError):
        db.execute(update(Finding).where(Finding.id==finding_id).values(rationale='rewritten evidence'));db.commit()
    result=c.get('/api/v1/runs/'+run['id']).json()
    assert 'synthetic-key' not in json.dumps(result['engine_metadata'])


def test_stale_source_epoch_prevents_external_dispatch(setup):
    c,engine,orgs,item,run=prepared(setup)
    mh=login(c,orgs[0])
    replacement=source(c,item['brand_id'],mh,value='30 days')
    assert activate(c,replacement['id'],mh,1).status_code==200
    calls=[]
    process_one(engine,reviewer(calls),checker)
    assert not calls
    login(c,orgs[0],'creator')
    result=c.get('/api/v1/runs/'+run['id']).json()
    assert result['stale'] and result['status']=='incomplete'


def test_admin_provider_status_reports_errors_and_latency(setup):
    c,engine,orgs,item,run=prepared(setup)
    process_one(engine,reviewer(),checker)
    h=login(c,orgs[0],'admin')
    status=c.get('/api/v1/provider-status',headers=h).json()
    assert status['runs_24h']==1 and status['errors_24h']==0 and status['error_rate_24h']==0
    assert status['p95_latency_ms_24h'] is not None and status['last_success_at']
    assert c.get('/api/v1/provider-status',headers=login(c,orgs[0],'manager')).status_code==403


def test_second_evaluated_model_is_allowed_but_unevaluated_ones_are_not():
    from brandguard.semantic import ProviderConfig
    assert ProviderConfig(model='Qwen/Qwen3-30B-A3B-Instruct-2507').model.endswith('30B-A3B-Instruct-2507')
    with pytest.raises(ValueError):
        ProviderConfig(model='Qwen/Qwen3-8B')
