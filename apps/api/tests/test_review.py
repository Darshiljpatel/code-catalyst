from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import pytest
from sqlalchemy import select, func, update, event
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from test_identity import setup, login
from brandguard.models import (SourceVersion, ContentRevision, ReviewRun, RunSource, Job,
                              ContentItem, Membership, Brand, AuditEvent, uid)

CONTEXT = dict(channel='email', audience='New customers', purpose='Promote a trial')

def brand(c, orgs):
    h = login(c, orgs[0])
    r = c.post('/api/v1/brands', json={'name':'LumaDesk'}, headers=h)
    assert r.status_code == 201, r.text
    return r.json()['id'], h

def source_body(key='trial', value='14 days'):
    return dict(source_key=key, title='Trial terms', text=f'The trial lasts {value}.',
        rules=[dict(id='F01', category='facts_claims', kind='fact', key='trial_duration', value=value,
                    evidence_quote=f'The trial lasts {value}.')],
        valid_from=(datetime.now(timezone.utc)-timedelta(days=1)).isoformat())

def source(c, bid, h, key='trial', value='14 days'):
    r = c.post(f'/api/v1/brands/{bid}/sources', json=source_body(key,value), headers=h)
    assert r.status_code == 201, r.text
    return r.json()

def activate(c, sid, h, epoch=0, retire=None):
    return c.post(f'/api/v1/sources/{sid}/activate', json=dict(expected_epoch=epoch, verified=True,
        retire_source_ids=retire or [], rationale='Verified against the approved trial terms.'), headers=h)

def content(c, orgs, bid, reviewer=None):
    h = login(c, orgs[0], 'creator')
    r = c.post('/api/v1/content', json=dict(brand_id=bid, title='Trial campaign', text='Try LumaDesk.',
                                         reviewer_id=reviewer, **CONTEXT), headers=h)
    assert r.status_code == 201, r.text
    return r.json(), h

def enqueue(c, revision, h, key='initial-run'):
    return c.post(f'/api/v1/revisions/{revision}/analysis', headers={**h, 'Idempotency-Key':key})

def count(engine, model):
    with Session(engine) as db:
        return db.scalar(select(func.count()).select_from(model))

def test_t28_source_verification_conflicts_versions_and_epoch(setup):
    c, engine, orgs, _ = setup
    bid,h = brand(c,orgs)
    first = source(c,bid,h)
    assert activate(c,first['id'],h).status_code == 200
    second = source(c,bid,h,'another','30 days')
    assert activate(c,second['id'],h,1).status_code == 409
    assert activate(c,second['id'],h,0,[first['id']]).status_code == 409
    assert activate(c,second['id'],h,1,[first['id']]).status_code == 200
    replacement = source(c,bid,h,'another','7 days')
    assert replacement['version'] == 2
    assert activate(c,replacement['id'],h,2).status_code == 200
    rows = c.get(f'/api/v1/brands/{bid}/sources').json()
    assert [s['state'] for s in rows if s['id'] == second['id']] == ['retired']
    assert c.get(f'/api/v1/brands/{bid}').json()['source_epoch'] == 3
    with Session(engine) as db:
        actions = sorted(db.scalars(select(AuditEvent.action)))
    # Every activation also records a guideline change for the re-review inbox.
    assert actions.count('source.created') == 3 and actions.count('source.activated') == 3
    assert actions.count('guideline.changed') == 3 and len(actions) == 9

@pytest.mark.parametrize('problem', ['quote','expired','future','unverified','timezone','internal_conflict'])
def test_source_rejects_invalid_evidence_and_activation(setup, problem):
    c, _, orgs, _ = setup
    bid,h = brand(c,orgs)
    body=source_body()
    if problem == 'quote': body['rules'][0]['evidence_quote']='invented'
    if problem == 'timezone': body['valid_from']='2026-01-01T00:00:00'
    if problem == 'internal_conflict': body['rules'].append({**body['rules'][0], 'id':'F02','value':'30 days'})
    if problem == 'expired': body['valid_until']=(datetime.now(timezone.utc)-timedelta(hours=1)).isoformat()
    if problem == 'future': body['valid_from']=(datetime.now(timezone.utc)+timedelta(days=1)).isoformat()
    r=c.post(f'/api/v1/brands/{bid}/sources',json=body,headers=h)
    if problem in ('quote','timezone','internal_conflict'):
        assert r.status_code == 422
    elif problem == 'unverified':
        assert c.post(f"/api/v1/sources/{r.json()['id']}/activate",json=dict(expected_epoch=0,verified=False,rationale='not verified'),headers=h).status_code == 422
    else:
        assert activate(c,r.json()['id'],h).status_code == 409


def test_t01_content_and_run_scoped_to_creator_assigned_reviewer_and_tenant(setup):
    c,engine,orgs,foreign = setup
    bid,mh = brand(c,orgs)
    s=source(c,bid,mh); assert activate(c,s['id'],mh).status_code == 200
    with Session(engine) as db:
        reviewer=db.scalar(select(Membership).where(Membership.role=='reviewer'))
        rid=reviewer.id
    item,ch=content(c,orgs,bid,rid)
    run=enqueue(c,item['revisions'][0]['id'],ch).json()
    login(c,orgs[0],'reviewer')
    assert c.get('/api/v1/content/'+item['id']).status_code == 200
    assert c.get('/api/v1/runs/'+run['id']).status_code == 200
    rh=login(c,orgs[0],'admin')
    assert c.get('/api/v1/content/'+item['id']).status_code == 404
    assert c.get('/api/v1/runs/'+run['id']).status_code == 404
    ch=login(c,orgs[0],'creator')
    assert c.post(f'/api/v1/brands/{bid}/sources',json=source_body(),headers=ch).status_code == 403
    assert c.get(f'/api/v1/brands/{foreign}/sources').status_code == 404
    assert c.post('/api/v1/content',json=dict(brand_id=foreign,title='No',text='Text',**CONTEXT),headers=ch).status_code == 404
    # Same-tenant, unassigned reviewer cannot read another creator's work.
    item2,ch=content(c,orgs,bid)
    login(c,orgs[0],'reviewer')
    assert c.get('/api/v1/content/'+item2['id']).status_code == 404


def test_t03_immutable_revisions_stale_writes_and_snapshot(setup):
    c,engine,orgs,_=setup
    bid,mh=brand(c,orgs); s=source(c,bid,mh); activate(c,s['id'],mh)
    item,ch=content(c,orgs,bid)
    revision=item['revisions'][0]
    run=enqueue(c,revision['id'],ch)
    assert run.status_code == 202,run.text
    assert run.json()['status']=='queued' and all(x['status']=='unavailable' for x in run.json()['checks'])
    edit=dict(parent_revision_id=revision['id'],text='Corrected trial.',**CONTEXT)
    r=c.post(f"/api/v1/content/{item['id']}/revisions",json=edit,headers=ch)
    assert r.status_code == 201
    assert r.json()['revisions'][0]['text']==revision['text']
    assert r.json()['current_revision']==2 and r.json()['state']=='draft'
    assert c.post(f"/api/v1/content/{item['id']}/revisions",json=edit,headers=ch).status_code==409
    assert enqueue(c,revision['id'],ch,'different-run').status_code==409
    assert c.get('/api/v1/runs/'+run.json()['id']).json()['stale']
    mh=login(c,orgs[0]); replacement=source(c,bid,mh,value='30 days');activate(c,replacement['id'],mh,1)
    historical=c.get('/api/v1/runs/'+run.json()['id']).json()
    assert historical['source_snapshot'][0]['text']=='The trial lasts 14 days.'
    for model,ident,changes in ((ContentRevision,revision['id'],dict(text='overwrite')),
                                (SourceVersion,s['id'],dict(text='overwrite')),
                                (ReviewRun,run.json()['id'],dict(source_epoch=999))):
        with Session(engine) as db, pytest.raises(IntegrityError):
            db.execute(update(model).where(model.id==ident).values(**changes));db.commit()


def test_t14_atomic_idempotent_enqueue_and_rollback(setup):
    c,engine,orgs,_=setup
    bid,mh=brand(c,orgs); item,ch=content(c,orgs,bid); rev=item['revisions'][0]['id']
    assert enqueue(c,rev,ch).status_code==409
    mh=login(c,orgs[0]); s=source(c,bid,mh);activate(c,s['id'],mh);ch=login(c,orgs[0],'creator')
    def fail_job(*args): raise RuntimeError('injected insert failure')
    event.listen(Job,'before_insert',fail_job)
    try:
        with pytest.raises(RuntimeError,match='injected insert failure'): enqueue(c,rev,ch)
    finally:
        event.remove(Job,'before_insert',fail_job)
    assert count(engine,ReviewRun)==count(engine,Job)==count(engine,RunSource)==0
    assert c.get('/api/v1/content/'+item['id']).json()['state']=='draft'
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses=list(pool.map(lambda _:enqueue(c,rev,ch),range(2)))
    assert [r.status_code for r in responses]==[202,202]
    assert responses[0].json()['id']==responses[1].json()['id']
    assert count(engine,ReviewRun)==count(engine,Job)==count(engine,RunSource)==1
    assert enqueue(c,rev,ch,'another-run').status_code==409


def test_database_rejects_cross_tenant_reference(setup):
    c,engine,orgs,foreign=setup
    bid,mh=brand(c,orgs);item,ch=content(c,orgs,bid)
    with Session(engine) as db,pytest.raises(IntegrityError):
        # A valid brand ID still cannot be attached to content from a different tenant.
        db.execute(update(ContentItem).where(ContentItem.id==item['id']).values(brand_id=foreign));db.commit()


def test_parallel_source_activation_serialises_epoch(setup):
    c,_,orgs,_=setup
    bid,h=brand(c,orgs)
    first=source(c,bid,h,'terms_a');second=source(c,bid,h,'terms_b')
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses=list(pool.map(lambda s:activate(c,s['id'],h),[first,second]))
    assert sorted(r.status_code for r in responses)==[200,409]
    assert c.get(f'/api/v1/brands/{bid}').json()['source_epoch']==1


def test_expired_snapshot_is_stale_without_epoch_change(setup, monkeypatch):
    import brandguard.review as review
    c,_,orgs,_=setup
    bid,mh=brand(c,orgs)
    body=source_body(); body['valid_until']=(datetime.now(timezone.utc)+timedelta(days=1)).isoformat()
    r=c.post(f'/api/v1/brands/{bid}/sources',json=body,headers=mh)
    assert r.status_code==201
    activate(c,r.json()['id'],mh)
    item,ch=content(c,orgs,bid);r=enqueue(c,item['revisions'][0]['id'],ch)
    assert r.status_code==202 and not r.json()['stale']
    future=datetime.now(timezone.utc)+timedelta(days=2)
    monkeypatch.setattr(review,'now',lambda:future)
    expired=c.get('/api/v1/runs/'+r.json()['id']).json()
    assert expired['stale'] and expired['source_epoch']==r.json()['source_epoch']


def test_parallel_revision_saves_do_not_lose_updates(setup):
    c,_,orgs,_=setup
    bid,_=brand(c,orgs);item,ch=content(c,orgs,bid)
    def save(i):
        return c.post(f"/api/v1/content/{item['id']}/revisions",json=dict(
            parent_revision_id=item['revisions'][0]['id'],text=f'Variant {i}',**CONTEXT),headers=ch)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(save,range(2)))
    assert sorted(r.status_code for r in results)==[201,409]
    assert len(c.get('/api/v1/content/'+item['id']).json()['revisions'])==2


def test_database_rejects_cross_tenant_run_source_link(setup):
    c,engine,orgs,foreign=setup
    bid,mh=brand(c,orgs);s=source(c,bid,mh);activate(c,s['id'],mh)
    item,ch=content(c,orgs,bid);run=enqueue(c,item['revisions'][0]['id'],ch).json()
    with Session(engine) as db,pytest.raises(IntegrityError):
        db.add(RunSource(run_id=run['id'],source_id=s['id'],org_id=orgs[1]));db.commit()
