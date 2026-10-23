"""Source curation and durable analysis submission. Execution is delegated to the S3 worker."""
from datetime import datetime, timezone
from typing import Annotated
from fastapi import APIRouter, Depends, Header, Body, Request
from sqlalchemy import select, or_, func
from sqlalchemy.orm import Session
from .core import db, identity, manager, Problem, digest
from .models import Brand, Membership, SourceVersion, ContentItem, ContentRevision, ReviewRun, RunSource, Job, AuditEvent, ProcessingPolicy, Organisation, Finding
from .schemas import (SourceInput, ActivationInput, ContentInput, NewRevisionInput,
                      SourceOut, ContentOut, RevisionOut, RunOut, AnalysisInput, FindingOut)

router = APIRouter(prefix='/api/v1')
CATEGORIES = ('terminology','tone','messaging','facts_claims','visual','accessibility')

def now():
    return datetime.now(timezone.utc)

def audit(session, member, action, object_id, **details):
    session.add(AuditEvent(org_id=member.org_id, actor_id=member.id, action=action,
                          object_id=object_id, details=details, created_at=now()))

def brand_for(session, member, brand_id, lock=False):
    query = select(Brand).where(Brand.org_id == member.org_id, Brand.id == brand_id)
    brand = session.scalar(query.with_for_update() if lock else query)
    if brand is None:
        raise Problem(404, 'not_found', 'Brand not found.')
    return brand

def item_for(session, member, item_id, lock=False, edit=False):
    query = select(ContentItem).where(ContentItem.org_id == member.org_id, ContentItem.id == item_id)
    item = session.scalar(query.with_for_update() if lock else query)
    if item is None or not (item.creator_id == member.id or item.reviewer_id == member.id or member.role == 'manager'):
        raise Problem(404, 'not_found', 'Content not found.')
    if edit and item.creator_id != member.id:
        raise Problem(403, 'forbidden', 'Only the creator can revise or analyse this content.')
    return item

def revision_for(session, member, revision_id, lock=False, edit=False):
    revision = session.scalar(select(ContentRevision).where(ContentRevision.org_id == member.org_id, ContentRevision.id == revision_id))
    if revision is None:
        raise Problem(404, 'not_found', 'Revision not found.')
    return revision, item_for(session, member, revision.item_id, lock=lock, edit=edit)

def eligible_sources(session, member, brand_id, at):
    return list(session.scalars(select(SourceVersion).where(
        SourceVersion.org_id == member.org_id, SourceVersion.brand_id == brand_id,
        SourceVersion.state == 'active', SourceVersion.valid_from <= at,
        or_(SourceVersion.valid_until.is_(None), SourceVersion.valid_until > at),
    ).order_by(SourceVersion.id)))

def content_out(session, item):
    revisions = list(session.scalars(select(ContentRevision).where(
        ContentRevision.org_id == item.org_id, ContentRevision.item_id == item.id
    ).order_by(ContentRevision.number)))
    approval_stale=False
    if item.state=='approved':
        current=next((r for r in revisions if r.number==item.current_revision),None)
        latest=session.scalar(select(ReviewRun).where(ReviewRun.org_id==item.org_id,
            ReviewRun.revision_id==current.id).order_by(ReviewRun.created_at.desc(),ReviewRun.id.desc()).limit(1)) if current else None
        brand=session.get(Brand,item.brand_id)
        active=set(s.id for s in eligible_sources(session,item,item.brand_id,now()))
        approval_stale=(latest is None or brand.source_epoch!=latest.source_epoch or
                        active!={s['id'] for s in latest.source_snapshot})
    return ContentOut(id=item.id, brand_id=item.brand_id, title=item.title, creator_id=item.creator_id,
                      reviewer_id=item.reviewer_id, current_revision=item.current_revision, workflow_version=item.workflow_version, approval_stale=approval_stale, state=item.state,
                      revisions=[RevisionOut.model_validate(r) for r in revisions])

def run_out(session, member, run, revision, item):
    brand = brand_for(session, member, item.brand_id)
    active_ids = {s.id for s in eligible_sources(session, member, brand.id, now())}
    stale = (item.current_revision != revision.number or brand.source_epoch != run.source_epoch
             or active_ids != {s['id'] for s in run.source_snapshot})
    return RunOut(id=run.id, revision_id=run.revision_id, source_epoch=run.source_epoch,
                  source_snapshot=run.source_snapshot, checks=run.checks, status=run.status,
                  created_at=run.created_at, stale=stale, processing_snapshot=run.processing_snapshot,
                  engine_metadata=run.engine_metadata, findings=[FindingOut.model_validate(f) for f in session.scalars(
                      select(Finding).where(Finding.org_id==member.org_id, Finding.run_id==run.id).order_by(Finding.id))])

@router.get('/brands/{brand_id}/sources', response_model=list[SourceOut])
def list_sources(brand_id: str, member=Depends(identity), session: Session=Depends(db)):
    brand_for(session, member, brand_id)
    return list(session.scalars(select(SourceVersion).where(SourceVersion.org_id == member.org_id,
        SourceVersion.brand_id == brand_id).order_by(SourceVersion.source_key, SourceVersion.version)))

@router.post('/brands/{brand_id}/sources', status_code=201, response_model=SourceOut)
def create_source(brand_id: str, body: SourceInput, member=Depends(manager), session: Session=Depends(db)):
    brand_for(session, member, brand_id, lock=True)
    previous = session.scalar(select(SourceVersion).where(SourceVersion.org_id == member.org_id,
        SourceVersion.brand_id == brand_id, SourceVersion.source_key == body.source_key
    ).order_by(SourceVersion.version.desc()).limit(1))
    source = SourceVersion(org_id=member.org_id, brand_id=brand_id, source_key=body.source_key,
        version=previous.version + 1 if previous else 1, owner_id=member.id, title=body.title,
        text=body.text, text_hash=digest(body.text), rules=[r.model_dump() for r in body.rules],
        valid_from=body.valid_from, valid_until=body.valid_until, state='draft', created_at=now())
    session.add(source); session.flush()
    audit(session, member, 'source.created', source.id, version=source.version)
    session.commit()
    return source

@router.post('/sources/{source_id}/activate', response_model=SourceOut)
def activate_source(source_id: str, body: ActivationInput, member=Depends(manager), session: Session=Depends(db)):
    source = session.scalar(select(SourceVersion).where(SourceVersion.org_id == member.org_id, SourceVersion.id == source_id))
    if source is None:
        raise Problem(404, 'not_found', 'Source not found.')
    brand = brand_for(session, member, source.brand_id, lock=True)
    session.refresh(source)
    at = now()
    if source.state != 'draft' or body.expected_epoch != brand.source_epoch:
        raise Problem(409, 'source_conflict', 'Source state or brand source epoch changed.')
    if source.valid_from > at or (source.valid_until is not None and source.valid_until <= at):
        raise Problem(409, 'invalid_validity', 'Only currently effective sources can be activated.')
    active = list(session.scalars(select(SourceVersion).where(SourceVersion.org_id == member.org_id,
        SourceVersion.brand_id == brand.id, SourceVersion.state == 'active')))
    active_ids = {s.id for s in active}
    if not set(body.retire_source_ids).issubset(active_ids):
        raise Problem(409, 'source_conflict', 'Retirement must reference active sources of this brand.')
    retired = {s.id for s in active if s.source_key == source.source_key} | set(body.retire_source_ids)
    facts = {r['key']: r['value'] for r in source.rules if r['kind'] == 'fact'}
    for other in active:
        if other.id in retired or (other.valid_until is not None and other.valid_until <= at):
            continue
        for rule in other.rules:
            if rule['kind'] == 'fact' and rule['key'] in facts and rule['value'] != facts[rule['key']]:
                raise Problem(409, 'conflicting_facts', 'Resolve conflicting facts by explicitly retiring the superseded source.')
    for other in active:
        if other.id in retired:
            other.state = 'retired'
    source.state, source.activated_by, source.activated_at = 'active', member.id, at
    brand.source_epoch += 1
    audit(session, member, 'source.activated', source.id, source_epoch=brand.source_epoch,
          retired_source_ids=sorted(retired), rationale=body.rationale)
    session.commit()
    return source

@router.post('/content', status_code=201, response_model=ContentOut)
def create_content(body: ContentInput, member=Depends(identity), session: Session=Depends(db)):
    if member.role != 'creator':
        raise Problem(403, 'forbidden', 'A creator identity is required.')
    brand_for(session, member, body.brand_id)
    if body.reviewer_id is not None:
        reviewer = session.scalar(select(Membership).where(Membership.org_id == member.org_id,
            Membership.id == body.reviewer_id, Membership.role == 'reviewer'))
        if reviewer is None or reviewer.id == member.id:
            raise Problem(422, 'invalid_reviewer', 'Select a separate reviewer in this workspace.')
    item = ContentItem(org_id=member.org_id, brand_id=body.brand_id, title=body.title,
        creator_id=member.id, reviewer_id=body.reviewer_id, current_revision=1, state='draft', created_at=now())
    session.add(item); session.flush()
    revision = ContentRevision(org_id=member.org_id, item_id=item.id, number=1, author_id=member.id,
        **{k:getattr(body,k) for k in ('text','channel','audience','purpose')}, text_hash=digest(body.text), created_at=now())
    session.add(revision); session.flush()
    audit(session, member, 'content.created', item.id, revision_id=revision.id)
    session.commit()
    return content_out(session, item)

@router.get('/content/{item_id}', response_model=ContentOut)
def get_content(item_id: str, member=Depends(identity), session: Session=Depends(db)):
    return content_out(session, item_for(session, member, item_id))

@router.post('/content/{item_id}/revisions', status_code=201, response_model=ContentOut)
def create_revision(item_id: str, body: NewRevisionInput, member=Depends(identity), session: Session=Depends(db)):
    item = item_for(session, member, item_id, lock=True, edit=True)
    parent = session.scalar(select(ContentRevision).where(ContentRevision.org_id == member.org_id,
        ContentRevision.item_id == item.id, ContentRevision.number == item.current_revision))
    if body.parent_revision_id != parent.id:
        raise Problem(409, 'stale_revision', 'Content changed. Reload before saving your revision.')
    item.current_revision += 1
    item.workflow_version += 1
    item.state = 'draft'
    revision = ContentRevision(org_id=member.org_id, item_id=item.id, number=item.current_revision, author_id=member.id,
        **{k:getattr(body,k) for k in ('text','channel','audience','purpose')}, text_hash=digest(body.text), created_at=now())
    session.add(revision); session.flush()
    audit(session, member, 'revision.created', revision.id, parent_revision_id=parent.id)
    session.commit()
    return content_out(session, item)

@router.post('/revisions/{revision_id}/analysis', status_code=202, response_model=RunOut)
def queue_analysis(revision_id: str, request: Request, idempotency_key: Annotated[str, Header(min_length=8, max_length=100)],
                   body: AnalysisInput = Body(default=AnalysisInput()),
                   member=Depends(identity), session: Session=Depends(db)):
    revision, item = revision_for(session, member, revision_id, lock=True, edit=True)
    existing = session.scalar(select(ReviewRun).where(ReviewRun.org_id == member.org_id,
        ReviewRun.revision_id == revision_id, ReviewRun.idempotency_key == idempotency_key))
    if existing:
        return run_out(session, member, existing, revision, item)
    if item.current_revision != revision.number:
        raise Problem(409, 'stale_revision', 'Analyse the current revision.')
    if item.state in ('in_review','approved'):
        raise Problem(409,'workflow_locked','Create a new revision before reanalysing reviewed content.')
    if session.scalar(select(ReviewRun.id).where(ReviewRun.org_id == member.org_id,
        ReviewRun.revision_id == revision_id, ReviewRun.status.in_(('queued','running')))):
        raise Problem(409, 'analysis_pending', 'An analysis of this revision is already pending.')
    brand = brand_for(session, member, item.brand_id, lock=True)
    # Serialise consent with policy updates. Never enable external processing from a request alone.
    session.scalar(select(Organisation).where(Organisation.id==member.org_id).with_for_update())
    policy = session.get(ProcessingPolicy,member.org_id)
    processing = dict(enabled=False, provider='nebius', consent=False)
    if body.external_processing_consent:
        if policy is None or not policy.enabled or policy.version != body.policy_version:
            raise Problem(409,'policy_changed','External processing requires consent to the current enabled policy.')
        start_of_day=now().replace(hour=0,minute=0,second=0,microsecond=0)
        reserved=session.scalar(select(func.count()).select_from(ReviewRun).where(
            ReviewRun.org_id==member.org_id, ReviewRun.created_at>=start_of_day,
            ReviewRun.processing_snapshot['enabled'].as_boolean()==True))
        if reserved>=request.app.state.settings.max_external_runs_per_day:
            raise Problem(429,'external_budget_exceeded','The workspace daily external-review limit has been reached.')
        processing = dict(enabled=True, provider='nebius', model=policy.model,
                          policy_version=policy.version, notice=policy.notice, consent=True)
    at = now()
    sources = eligible_sources(session, member, brand.id, at)
    if not sources:
        raise Problem(409, 'no_approved_sources', 'Activate an effective source before analysis.')
    run = ReviewRun(org_id=member.org_id, revision_id=revision.id, idempotency_key=idempotency_key,
        source_epoch=brand.source_epoch, source_snapshot=[SourceOut.model_validate(s).model_dump(mode='json') for s in sources],
        checks=[dict(category=c, status='unavailable', reason='Queued; no worker has completed this check.') for c in CATEGORIES],
        status='queued', created_at=at, processing_snapshot=processing)
    session.add(run); session.flush()
    for source in sources:
        session.add(RunSource(org_id=member.org_id, run_id=run.id, source_id=source.id))
    session.add(Job(org_id=member.org_id, run_id=run.id, status='queued', attempts=0, available_at=at, created_at=at))
    item.state = 'analysing'
    item.workflow_version += 1
    audit(session, member, 'analysis.queued', run.id, revision_id=revision.id, source_epoch=brand.source_epoch)
    session.commit()
    return run_out(session, member, run, revision, item)

@router.get('/runs/{run_id}', response_model=RunOut)
def get_run(run_id: str, member=Depends(identity), session: Session=Depends(db)):
    run = session.scalar(select(ReviewRun).where(ReviewRun.org_id == member.org_id, ReviewRun.id == run_id))
    if run is None:
        raise Problem(404, 'not_found', 'Review run not found.')
    revision, item = revision_for(session, member, run.revision_id)
    return run_out(session, member, run, revision, item)
