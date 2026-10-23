"""Real P1/P2 engine plus real API/DB/workflow; only the external model is mocked."""
import json
import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session
from test_identity import setup,login
from test_review import brand,activate,content,CONTEXT
from test_orchestration import policy
from test_workflow import submit,decide,REASON
from brandguard.models import Membership
from brandguard.orchestration import process_one
from brandguard.engine_bridge import check_text
from brandguard.semantic import NebiusReviewer,ProviderConfig,PRIMARY_MODEL


def model(calls=None,invalid=False):
    def handle(request):
        if calls is not None:calls.append(request)
        payload=json.loads(json.loads(request.content)['messages'][1]['content'])
        findings=[]
        text=payload['text']
        if '10x' in text:
            rule=next(r for r in payload['rules'] if r['kind']=='claim_policy')
            findings.append(dict(
                source_version_id=rule['source_version_id'],rule_id=rule['id'],evidence_quote=rule['evidence_quote'],
                content_quote='10x productivity',rationale='No approved supporting performance evidence is supplied.',suggested_edit=None))
        return httpx.Response(200,json=dict(model=PRIMARY_MODEL,usage={'prompt_tokens':100,'completion_tokens':100,'total_tokens':200},
            choices=[dict(finish_reason='stop',message=dict(role='assistant',content='{' if invalid else json.dumps(dict(
                evaluated_categories=payload['categories'],findings=findings))))]))
    return NebiusReviewer(ProviderConfig(api_key='synthetic-key'),httpx.MockTransport(handle))


def prepare(setup):
    c,engine,orgs,_=setup
    bid,h=brand(c,orgs)
    body=dict(source_key='brand_guide',title='LumaDesk synthetic rules',
        text='Write LumaDesk. The trial lasts 14 days. Performance claims require approved evidence. Use calm language.',
        valid_from='2026-10-22T00:00:00Z',rules=[
            dict(id='T01',category='terminology',kind='terminology',key='product_name',value='LumaDesk',evidence_quote='Write LumaDesk.'),
            dict(id='F01',category='facts_claims',kind='fact',key='trial_duration',value='14 days',evidence_quote='The trial lasts 14 days.'),
            dict(id='C01',category='facts_claims',kind='claim_policy',key='promotions',value='Substantiate performance claims.',evidence_quote='Performance claims require approved evidence.'),
            dict(id='G01',category='tone',kind='guidance',key='tone',value='Use calm language.',evidence_quote='Use calm language.')])
    r=c.post(f'/api/v1/brands/{bid}/sources',json=body,headers=h)
    assert r.status_code==201,r.text
    sid=r.json()['id'];assert activate(c,sid,h).status_code==200
    assert policy(c,orgs).status_code==200
    item,h=content(c,orgs,bid)
    return c,engine,orgs,item,sid


def analyse(c,orgs,revision,key,consent=True):
    h=login(c,orgs[0],'creator')
    result=c.post(f'/api/v1/revisions/{revision}/analysis',headers={**h,'Idempotency-Key':key},
        json=dict(external_processing_consent=consent,policy_version=1 if consent else None))
    assert result.status_code==202,result.text
    return result.json()


def revise(c,orgs,item,parent,text):
    h=login(c,orgs[0],'creator')
    r=c.post(f"/api/v1/content/{item['id']}/revisions",json=dict(parent_revision_id=parent,text=text,**CONTEXT),headers=h)
    assert r.status_code==201,r.text
    return r.json()['revisions'][-1]['id']


def test_real_engine_bad_draft_then_correction_approval_and_export(setup):
    c,engine,orgs,item,sid=prepare(setup)
    draft='Lumadesk guarantees 10x productivity. Get your 30-day free trial.'
    rev=revise(c,orgs,item,item['revisions'][0]['id'],draft)
    run=analyse(c,orgs,rev,'bad-draft-analysis')
    assert process_one(engine,model(),check_text)
    result=c.get('/api/v1/runs/'+run['id']).json()
    assert result['status']=='complete'
    assert {f['origin'] for f in result['findings']}=={'model','deterministic'}
    assert len(result['findings'])==3 # name, structured trial duration, unsupported promotional claim
    assert {f['evidence_quote'] for f in result['findings']}=={'Write LumaDesk.','The trial lasts 14 days.','Performance claims require approved evidence.'}
    for f in result['findings']:assert draft[f['location']['start']:f['location']['end']]==f['location']['quote']
    assert c.get('/api/v1/content/'+item['id']).json()['state']=='needs_changes'
    with Session(engine) as db:rid=db.scalar(select(Membership.id).where(Membership.role=='reviewer'))
    h=login(c,orgs[0],'creator')
    version=c.get('/api/v1/content/'+item['id']).json()['workflow_version']
    response=c.post(f'/api/v1/revisions/{rev}/submit',json=dict(reviewer_id=rid,expected_item_version=version,
        expected_run_id=run['id'],expected_source_epoch=1),headers=h)
    assert response.status_code==409 and response.json()['code']=='unresolved_blockers'
    clean='Try LumaDesk free for 14 days. Start your trial.'
    current=revise(c,orgs,item,rev,clean)
    run=analyse(c,orgs,current,'clean-draft-analysis')
    process_one(engine,model(),check_text)
    result=c.get('/api/v1/runs/'+run['id']).json()
    assert result['status']=='complete' and result['findings']==[]
    assert result['engine_metadata']['deterministic']['version'].startswith('review-engine.p2')
    item=dict(item,revisions=[dict(id=current)])
    assert submit(c,orgs,item,run,rid).status_code==200
    assert decide(c,orgs,item,run).status_code==201
    export=c.get(f'/api/v1/revisions/{current}/export')
    assert export.status_code==200,export.text
    assert export.json()['text']==clean and export.json()['evidence_record']['manual_checks']==[]
    assert c.get(f'/api/v1/revisions/{rev}/export').status_code==409


def test_real_deterministic_findings_survive_failed_model(setup):
    c,engine,orgs,item,_=prepare(setup)
    rev=revise(c,orgs,item,item['revisions'][0]['id'],'Lumadesk offers a 30-day trial.')
    run=analyse(c,orgs,rev,'model-failure-test')
    process_one(engine,model(invalid=True),check_text)
    result=c.get('/api/v1/runs/'+run['id']).json()
    assert result['status']=='incomplete' and len(result['findings'])==2
    assert all(f['origin']=='deterministic' for f in result['findings'])


def test_local_processing_does_not_dispatch_external_model(setup):
    c,engine,orgs,item,_=prepare(setup)
    rev=revise(c,orgs,item,item['revisions'][0]['id'],'Lumadesk offers a 30-day trial.')
    run=analyse(c,orgs,rev,'local-mode-check',False)
    calls=[];process_one(engine,model(calls),check_text)
    result=c.get('/api/v1/runs/'+run['id']).json()
    assert calls==[] and result['status']=='incomplete' and len(result['findings'])==2


def test_scoped_queue_and_governance_counts_use_real_events(setup):
    c,engine,orgs,item,sid=prepare(setup)
    rev=revise(c,orgs,item,item['revisions'][0]['id'],'Lumadesk offers a 30-day trial.')
    run=analyse(c,orgs,rev,'governance-check');process_one(engine,model(),check_text)
    h=login(c,orgs[0],'creator')
    assert c.get('/api/v1/content?limit=1').json()['total']==1
    assert c.get('/api/v1/content?limit=0').status_code==422
    assert c.get('/api/v1/brands/'+item['brand_id']+'/insights').status_code==403
    for _ in range(2):
        r=c.post('/api/v1/sources/'+sid+'/ambiguity-reports',json=dict(rule_id='T01',revision_id=rev,
            rationale='This rule needs an example of how hyphenated product names should be treated.'),headers=h)
        assert r.status_code==201,r.text
    with Session(engine) as db:rid=db.scalar(select(Membership.id).where(Membership.role=='reviewer'))
    mh=login(c,orgs[0],'manager')
    version=c.get('/api/v1/content/'+item['id']).json()['workflow_version']
    assert c.put('/api/v1/content/'+item['id']+'/reviewer',json=dict(reviewer_id=rid,expected_item_version=version,rationale=REASON),headers=mh).status_code==200
    rh=login(c,orgs[0],'reviewer')
    assert c.get('/api/v1/content?state=needs_changes').json()['total']==1
    finding=c.get('/api/v1/runs/'+run['id']).json()['findings'][0]
    version=c.get('/api/v1/content/'+item['id']).json()['workflow_version']
    assert c.post('/api/v1/findings/'+finding['id']+'/resolutions',json=dict(action='confirm',rationale=REASON,
        expected_item_version=version),headers=rh).status_code==201
    login(c,orgs[0],'manager')
    result=c.get('/api/v1/brands/'+item['brand_id']+'/insights').json()
    assert result['confirmed_total']==1 and result['ambiguous_total']==1 and result['reviewed_items_denominator']==1
    assert result['rules'][0]['confirmed_per_reviewed_item']==1.0
    login(c,orgs[0],'admin')
    assert c.get('/api/v1/content').json()['items']==[]


def test_reanalysis_does_not_inflate_confirmed_issue_counts(setup):
    c,engine,orgs,item,_=prepare(setup)
    rev=revise(c,orgs,item,item['revisions'][0]['id'],'Lumadesk offers a 30-day trial.')
    with Session(engine) as db:rid=db.scalar(select(Membership.id).where(Membership.role=='reviewer'))
    mh=login(c,orgs[0],'manager')
    version=c.get('/api/v1/content/'+item['id']).json()['workflow_version']
    assert c.put('/api/v1/content/'+item['id']+'/reviewer',json=dict(reviewer_id=rid,expected_item_version=version,rationale=REASON),headers=mh).status_code==200
    for key in ('first-review-count','second-review-count'):
        run=analyse(c,orgs,rev,key);process_one(engine,model(),check_text)
        rh=login(c,orgs[0],'reviewer')
        finding=next(f for f in c.get('/api/v1/runs/'+run['id']).json()['findings'] if f['rule_id']=='T01')
        version=c.get('/api/v1/content/'+item['id']).json()['workflow_version']
        assert c.post('/api/v1/findings/'+finding['id']+'/resolutions',json=dict(action='confirm',rationale=REASON,
            expected_item_version=version),headers=rh).status_code==201
    login(c,orgs[0],'manager')
    data=c.get('/api/v1/brands/'+item['brand_id']+'/insights').json()
    assert data['reviewed_items_denominator']==1 and data['confirmed_total']==1


def test_new_queue_and_insights_do_not_leak_other_tenants(setup):
    from brandguard.models import User,Membership
    from brandguard.core import passwords
    c,engine,orgs,item,sid=prepare(setup)
    with Session(engine) as db:
        u=User(email='othermanager@example.test',password_hash=passwords.hash('correct-password'))
        db.add(u);db.flush();db.add(Membership(user_id=u.id,org_id=orgs[1],role='manager'));db.commit()
    h=login(c,orgs[1],'othermanager')
    assert c.get('/api/v1/content').json()['total']==0
    assert c.get('/api/v1/brands/'+item['brand_id']+'/insights').status_code==404
    assert c.post('/api/v1/sources/'+sid+'/ambiguity-reports',json=dict(rationale=REASON),headers=h).status_code==404
