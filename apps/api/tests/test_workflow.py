from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
import copy
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select,update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from test_identity import setup,login
from test_review import source,activate,count,CONTEXT
from test_orchestration import prepared,reviewer,checker
from brandguard.orchestration import process_one
from brandguard.models import (Membership,Finding,ReviewRun,Comment,FindingResolution,ManualCheck,Decision,ContentItem)
from brandguard.core import digest
import brandguard.workflow as workflow

REASON='Reviewed this exact revision against the approved source evidence.'


def ready(setup, *, incomplete=False, blocker=False):
    c,engine,orgs,item,run=prepared(setup)
    if blocker:
        # Use the injected deterministic checker to produce a real validated blocking finding.
        from brandguard.orchestration import EngineResult,DETERMINISTIC
        async def blocking(inp):
            base=await checker(inp)
            src=inp.sources[0]
            return EngineResult(base.checks,[dict(category='facts_claims',severity='blocker',evidence_status='contradicted',
                source_version_id=src['id'],rule_id='F01',evidence_quote=src['rules'][0]['evidence_quote'],
                start=0,end=len(inp.text),content_quote=inp.text,rationale='Synthetic blocker fixture.',suggested_edit=None)])
        process_one(engine,reviewer(),None if incomplete else blocking)
    else:
        process_one(engine,reviewer(),None if incomplete else checker)
    with Session(engine) as db:
        rid=db.scalar(select(Membership.id).where(Membership.role=='reviewer'))
    return c,engine,orgs,item,run,rid


def current(c,item):return c.get('/api/v1/content/'+item['id']).json()


def guard(c,item,run):
    return dict(expected_item_version=current(c,item)['workflow_version'],expected_run_id=run['id'],
                expected_source_epoch=run['source_epoch'])


def assign(c,orgs,item,rid):
    h=login(c,orgs[0],'manager')
    r=c.put('/api/v1/content/'+item['id']+'/reviewer',json=dict(reviewer_id=rid,
        expected_item_version=current(c,item)['workflow_version'],rationale=REASON),headers=h)
    assert r.status_code==200,r.text


def submit(c,orgs,item,run,rid):
    h=login(c,orgs[0],'creator')
    return c.post('/api/v1/revisions/'+item['revisions'][0]['id']+'/submit',json=dict(**guard(c,item,run),reviewer_id=rid),headers=h)


def decide(c,orgs,item,run,kind='approved',extra=None):
    h=login(c,orgs[0],'reviewer')
    body=dict(**guard(c,item,run),kind=kind,rationale=REASON)
    if extra:body.update(extra)
    return c.post('/api/v1/revisions/'+item['revisions'][0]['id']+'/decisions',json=body,headers=h)


def test_t11_full_review_comment_approve_and_exact_export(setup):
    c,engine,orgs,item,run,rid=ready(setup)
    rev=item['revisions'][0]['id']
    assert c.get(f'/api/v1/revisions/{rev}/export').status_code==409
    h=login(c,orgs[0],'creator')
    comment=c.post(f'/api/v1/revisions/{rev}/comments',json={'text':'Please verify this campaign before publication.'},headers=h)
    assert comment.status_code==201
    assert submit(c,orgs,item,run,rid).status_code==200
    d=decide(c,orgs,item,run)
    assert d.status_code==201,d.text
    exported=c.get(f'/api/v1/revisions/{rev}/export')
    assert exported.status_code==200,exported.text
    data=exported.json()
    assert data['text']=='Try LumaDesk.' and data['text_hash']==digest(data['text'])==d.json()['text_hash']
    assert data['revision_id']==d.json()['revision_id']==rev
    assert data['evidence_record']['comments'][0]['id']==comment.json()['id']
    assert data['evidence_record']['source_epoch']==run['source_epoch']
    assert decide(c,orgs,item,run).status_code==409
    # Discussion can continue, but cannot rewrite what was approved/exported.
    h=login(c,orgs[0],'reviewer')
    assert c.post(f'/api/v1/revisions/{rev}/comments',json={'text':'Post-decision discussion.'},headers=h).status_code==201
    assert len(c.get(f'/api/v1/revisions/{rev}/export').json()['evidence_record']['comments'])==1
    with Session(engine) as db,pytest.raises(IntegrityError):
        db.execute(update(Decision).where(Decision.id==d.json()['id']).values(rationale='rewrite'));db.commit()


@pytest.mark.parametrize('role',['creator','manager','admin'])
def test_t02_creator_manager_admin_cannot_approve(setup,role):
    c,_,orgs,item,run,rid=ready(setup)
    assert submit(c,orgs,item,run,rid).status_code==200
    h=login(c,orgs[0],role)
    body=dict(expected_item_version=3,expected_run_id=run['id'],expected_source_epoch=run['source_epoch'],kind='approved',rationale=REASON)
    r=c.post('/api/v1/revisions/'+item['revisions'][0]['id']+'/decisions',json=body,headers=h)
    assert r.status_code in (403,404)


def test_t03_edit_after_approval_requires_new_analysis_and_approval(setup):
    c,_,orgs,item,run,rid=ready(setup)
    submit(c,orgs,item,run,rid);assert decide(c,orgs,item,run).status_code==201
    rev=item['revisions'][0]['id'];h=login(c,orgs[0],'creator')
    r=c.post('/api/v1/content/'+item['id']+'/revisions',json=dict(parent_revision_id=rev,text='New campaign.',**CONTEXT),headers=h)
    assert r.status_code==201 and r.json()['state']=='draft'
    assert c.get(f'/api/v1/revisions/{rev}/export').status_code==409
    assert c.get('/api/v1/revisions/'+r.json()['revisions'][-1]['id']+'/export').status_code==409


@pytest.mark.parametrize('phase',['before_approval','after_approval'])
def test_t04_changed_source_blocks_approval_and_fresh_export(setup,phase):
    c,_,orgs,item,run,rid=ready(setup)
    submit(c,orgs,item,run,rid)
    if phase=='after_approval':assert decide(c,orgs,item,run).status_code==201
    h=login(c,orgs[0],'manager')
    new=source(c,item['brand_id'],h,value='30 days')
    assert activate(c,new['id'],h,1).status_code==200
    if phase=='before_approval':assert decide(c,orgs,item,run).status_code==409
    else:
        # The approval relied on the changed fact, so the campaign goes on hold for a recheck.
        state=current(c,item)
        assert state['state']=='recheck_required' and state['recheck']['impact_level']=='confirmed'
    assert c.get('/api/v1/revisions/'+item['revisions'][0]['id']+'/export').status_code==409


def test_t04_expired_source_blocks_export_without_activation(setup,monkeypatch):
    c,_,orgs,item,run,rid=ready(setup)
    # Simulate eligibility expiry using the same guard used by submission/approval/export.
    submit(c,orgs,item,run,rid);assert decide(c,orgs,item,run).status_code==201
    monkeypatch.setattr(workflow,'eligible_sources',lambda *args:[])
    assert c.get('/api/v1/revisions/'+item['revisions'][0]['id']+'/export').status_code==409


def test_t13_creator_request_is_not_a_granted_exception(setup):
    c,engine,orgs,item,run,rid=ready(setup,blocker=True)
    assign(c,orgs,item,rid)
    finding=next(f for f in c.get('/api/v1/runs/'+run['id']).json()['findings'] if f['severity']=='blocker')
    h=login(c,orgs[0],'creator')
    body=dict(expected_item_version=current(c,item)['workflow_version'],action='grant_exception',rationale=REASON)
    assert c.post('/api/v1/findings/'+finding['id']+'/resolutions',json=body,headers=h).status_code==403
    body['action']='request_exception'
    assert c.post('/api/v1/findings/'+finding['id']+'/resolutions',json=body,headers=h).status_code==201
    assert submit(c,orgs,item,run,rid).status_code==409
    h=login(c,orgs[0],'reviewer')
    body.update(expected_item_version=current(c,item)['workflow_version'],action='dismiss')
    assert c.post('/api/v1/findings/'+finding['id']+'/resolutions',json=body,headers=h).status_code==409
    body['action']='grant_exception'
    assert c.post('/api/v1/findings/'+finding['id']+'/resolutions',json=body,headers=h).status_code==201
    assert submit(c,orgs,item,run,rid).status_code==200
    assert decide(c,orgs,item,run).status_code==201
    result=c.get('/api/v1/revisions/'+item['revisions'][0]['id']+'/export').json()
    assert result['evidence_record']['resolutions'][-1]['action']=='grant_exception'
    assert 'not proof' in result['evidence_record']['exception_notice']


def test_incomplete_checks_need_explicit_per_category_manual_evidence(setup):
    c,engine,orgs,item,run,rid=ready(setup,incomplete=True)
    assign(c,orgs,item,rid)
    assert submit(c,orgs,item,run,rid).status_code==409
    h=login(c,orgs[0],'reviewer')
    result=c.get('/api/v1/runs/'+run['id']).json()
    source_id=result['source_snapshot'][0]['id']
    for check in result['checks']:
        if check['status'] in ('complete','not_applicable'):continue
        category=check['category']
        body=dict(expected_item_version=current(c,item)['workflow_version'],category=category,
            outcome='complete' if category=='facts_claims' else 'not_applicable',rationale=REASON,
            source_version_ids=[source_id] if category=='facts_claims' else [])
        if category=='facts_claims':
            invalid=dict(body,outcome='not_applicable')
            assert c.post('/api/v1/runs/'+run['id']+'/manual-checks',json=invalid,headers=h).status_code==409
        r=c.post('/api/v1/runs/'+run['id']+'/manual-checks',json=body,headers=h)
        assert r.status_code==201,r.text
    assert submit(c,orgs,item,run,rid).status_code==200
    assert decide(c,orgs,item,run).status_code==201
    data=c.get('/api/v1/revisions/'+item['revisions'][0]['id']+'/export').json()
    assert data['evidence_record']['manual_checks']
    assert any(x['origin']=='human' for x in data['evidence_record']['effective_checks'])
    assert any(x['status']=='unavailable' for x in data['evidence_record']['automated_checks'])
    assert c.get('/api/v1/runs/'+run['id']).json()['status']=='incomplete'


def test_t03_stale_browser_and_concurrent_decisions(setup):
    c,engine,orgs,item,run,rid=ready(setup)
    submit(c,orgs,item,run,rid)
    h=login(c,orgs[0],'reviewer')
    body=dict(**guard(c,item,run),kind='approved',rationale=REASON)
    stale=dict(body,expected_item_version=body['expected_item_version']-1)
    path='/api/v1/revisions/'+item['revisions'][0]['id']+'/decisions'
    assert c.post(path,json=stale,headers=h).status_code==409
    with ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(lambda _:c.post(path,json=body,headers=h),range(2)))
    assert sorted(r.status_code for r in results)==[201,409]
    assert count(engine,Decision)==1


def test_changes_requested_records_reason_and_requires_a_new_review(setup):
    c,_,orgs,item,run,rid=ready(setup)
    assert submit(c,orgs,item,run,rid).status_code==200
    result=decide(c,orgs,item,run,'changes_requested')
    assert result.status_code==201
    assert c.get('/api/v1/content/'+item['id']).json()['state']=='changes_requested'
    assert submit(c,orgs,item,run,rid).status_code==409
    assert c.get('/api/v1/revisions/'+item['revisions'][0]['id']+'/export').status_code==409


def test_comments_cannot_reference_another_revision_finding(setup):
    c,_,orgs,item,run,rid=ready(setup)
    finding=c.get('/api/v1/runs/'+run['id']).json()['findings'][0]
    h=login(c,orgs[0],'creator')
    new=c.post('/api/v1/content/'+item['id']+'/revisions',json=dict(parent_revision_id=item['revisions'][0]['id'],text='Next draft.',**CONTEXT),headers=h).json()
    rev=new['revisions'][-1]['id']
    assert c.post(f'/api/v1/revisions/{rev}/comments',json=dict(text='A contextual comment.',finding_id=finding['id']),headers=h).status_code==404
    assert c.post(f'/api/v1/revisions/{rev}/comments',json=dict(text='   '),headers=h).status_code==422
    login(c,orgs[0],'admin')
    assert c.get(f'/api/v1/revisions/{rev}/comments').status_code==404


def test_reassignment_invalidates_old_reviewer_authority(setup):
    c,engine,orgs,item,run,rid=ready(setup)
    assert submit(c,orgs,item,run,rid).status_code==200
    with Session(engine) as db:
        # Revocation can occur independently of the review UI.
        db.execute(update(Membership).where(Membership.id==rid).values(role='creator'));db.commit()
    h=login(c,orgs[0],'reviewer') # same email, server now derives creator role
    path='/api/v1/revisions/'+item['revisions'][0]['id']+'/decisions'
    assert c.post(path,json=dict(**guard(c,item,run),kind='approved',rationale=REASON),headers=h).status_code==403


def test_source_change_racing_approval_cannot_leave_export_eligible(setup):
    c,_,orgs,item,run,rid=ready(setup)
    submit(c,orgs,item,run,rid)
    manager_client=TestClient(c.app,base_url='https://testserver')
    mh=login(manager_client,orgs[0],'manager')
    new=source(manager_client,item['brand_id'],mh,value='30 days')
    rh=login(c,orgs[0],'reviewer')
    body=dict(**guard(c,item,run),kind='approved',rationale=REASON)
    with ThreadPoolExecutor(max_workers=2) as pool:
        approval=pool.submit(lambda:c.post('/api/v1/revisions/'+item['revisions'][0]['id']+'/decisions',json=body,headers=rh))
        activation=pool.submit(lambda:activate(manager_client,new['id'],mh,1))
        assert approval.result().status_code in (201,409)
        assert activation.result().status_code==200
    manager_client.close()
    assert c.get('/api/v1/revisions/'+item['revisions'][0]['id']+'/export').status_code==409


def test_cross_tenant_workflow_endpoints_deny_object_ids(setup):
    from brandguard.models import User
    from brandguard.core import passwords
    c,engine,orgs,item,run,rid=ready(setup)
    finding=c.get('/api/v1/runs/'+run['id']).json()['findings'][0]
    with Session(engine) as db:
        user=User(email='tenant2@example.test',password_hash=passwords.hash('correct-password'))
        db.add(user);db.flush()
        db.add(Membership(user_id=user.id,org_id=orgs[1],role='creator'));db.commit()
    h=login(c,orgs[1],'tenant2')
    rev=item['revisions'][0]['id']
    for suffix in ('comments','review','export'):
        assert c.get(f'/api/v1/revisions/{rev}/{suffix}').status_code==404
    assert c.post(f'/api/v1/revisions/{rev}/comments',json={'text':'Cross-tenant attempt.'},headers=h).status_code==404
    assert c.post(f"/api/v1/findings/{finding['id']}/resolutions",json=dict(action='request_exception',
        rationale=REASON,expected_item_version=3),headers=h).status_code==404
    assert c.post(f"/api/v1/runs/{run['id']}/manual-checks",json=dict(category='tone',outcome='complete',
        rationale=REASON,expected_item_version=3),headers=h).status_code==404
    assert c.post(f'/api/v1/revisions/{rev}/decisions',json=dict(expected_run_id=run['id'],expected_source_epoch=1,
        expected_item_version=3,kind='approved',rationale=REASON),headers=h).status_code==404


def test_latest_analysis_required_and_creator_cannot_assign_self(setup):
    c,engine,orgs,item,run,rid=ready(setup)
    h=login(c,orgs[0],'creator')
    creator_id=current(c,item)['creator_id']
    invalid=c.post('/api/v1/revisions/'+item['revisions'][0]['id']+'/submit',json=dict(
        **guard(c,item,run),reviewer_id=creator_id),headers=h)
    assert invalid.status_code==422
    pending=c.post('/api/v1/revisions/'+item['revisions'][0]['id']+'/analysis',headers={**h,'Idempotency-Key':'newest-analysis'})
    assert pending.status_code==202
    old=c.post('/api/v1/revisions/'+item['revisions'][0]['id']+'/submit',json=dict(
        **guard(c,item,run),reviewer_id=rid),headers=h)
    assert old.status_code==409 and old.json()['code']=='analysis_changed'


def test_expiry_of_real_dated_source_blocks_approved_export(setup,monkeypatch):
    from test_review import brand,source_body,content
    from test_orchestration import policy
    c,engine,orgs,_=setup
    bid,h=brand(c,orgs)
    real_now=workflow.utcnow()
    body=source_body();body['valid_until']=(real_now+timedelta(days=1)).isoformat()
    source_id=c.post(f'/api/v1/brands/{bid}/sources',json=body,headers=h).json()['id']
    assert activate(c,source_id,h).status_code==200
    policy(c,orgs)
    item,h=content(c,orgs,bid)
    run=c.post('/api/v1/revisions/'+item['revisions'][0]['id']+'/analysis',json=dict(
        external_processing_consent=True,policy_version=1),headers={**h,'Idempotency-Key':'dated-source'}).json()
    process_one(engine,reviewer(),checker)
    with Session(engine) as db:rid=db.scalar(select(Membership.id).where(Membership.role=='reviewer'))
    assert submit(c,orgs,item,run,rid).status_code==200
    assert decide(c,orgs,item,run).status_code==201
    assert c.get('/api/v1/revisions/'+item['revisions'][0]['id']+'/export').status_code==200
    monkeypatch.setattr(workflow,'utcnow',lambda:real_now+timedelta(days=2))
    assert c.get('/api/v1/revisions/'+item['revisions'][0]['id']+'/export').status_code==409


def test_approval_and_audit_commit_or_roll_back_together(setup):
    from sqlalchemy import event
    from brandguard.models import AuditEvent
    c,engine,orgs,item,run,rid=ready(setup)
    assert submit(c,orgs,item,run,rid).status_code==200
    version=current(c,item)['workflow_version']
    def fail_audit(mapper,connection,target):
        if target.action=='revision.approved':raise RuntimeError('injected audit failure')
    event.listen(AuditEvent,'before_insert',fail_audit)
    try:
        with pytest.raises(RuntimeError,match='injected audit failure'):
            decide(c,orgs,item,run)
    finally:event.remove(AuditEvent,'before_insert',fail_audit)
    assert count(engine,Decision)==0
    latest=current(c,item)
    assert latest['state']=='in_review' and latest['workflow_version']==version
    assert c.get('/api/v1/revisions/'+item['revisions'][0]['id']+'/export').status_code==409
