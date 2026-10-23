"""Durable runner boundary for Surya's engine. All completion writes are lease-guarded."""
import asyncio
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Literal

from pydantic import ValidationError
from sqlalchemy import select, or_, and_
from sqlalchemy.orm import Session

from .models import (Job, ReviewRun, ContentRevision, ContentItem, Brand, ProcessingPolicy,
                     Finding, AuditEvent)
from .schemas import CheckOut
from .semantic import (LocatedFinding, ModelFailure, SemanticResult, validate_findings,
                       PROMPT_VERSION)

CATEGORIES = ('terminology', 'tone', 'messaging', 'facts_claims', 'visual', 'accessibility')
DETERMINISTIC = ('terminology', 'facts_claims', 'visual', 'accessibility')

class EngineFinding(LocatedFinding):
    category: Literal['terminology', 'tone', 'messaging', 'facts_claims', 'visual', 'accessibility']

@dataclass(frozen=True)
class ReviewInput:
    text: str
    context: dict
    sources: list[dict]

@dataclass
class EngineResult:
    """Injected deterministic engine contract; input/output have no database handles."""
    checks: list[dict]
    findings: list[dict]

@dataclass(frozen=True)
class ClaimedRun:
    job_id: str
    run_id: str
    org_id: str
    lease_token: str
    item_id: str
    revision_id: str
    created_at: datetime
    processing: dict
    review_input: ReviewInput
    exhausted: bool = False


def utcnow():
    return datetime.now(timezone.utc)


def claim_one(engine):
    with Session(engine) as db:
        at=utcnow()
        job=db.scalar(select(Job).where(or_(
            and_(Job.status=='queued',Job.available_at<=at),
            and_(Job.status=='running',Job.lease_expires_at<=at)
        )).order_by(Job.available_at,Job.id).with_for_update(skip_locked=True).limit(1))
        if job is None:
            return None
        run=db.get(ReviewRun,job.run_id)
        revision=db.get(ContentRevision,run.revision_id)
        exhausted=job.attempts>=3
        token=secrets.token_hex(32)
        job.status,job.lease_token,job.lease_expires_at='running',token,at+timedelta(seconds=65)
        if not exhausted:
            job.attempts+=1
        run.status='running'
        claim=ClaimedRun(job.id,run.id,run.org_id,token,revision.item_id,revision.id,run.created_at,
                         run.processing_snapshot,ReviewInput(revision.text,
                            {k:getattr(revision,k) for k in ('channel','audience','purpose')},run.source_snapshot),exhausted)
        db.commit()
        return claim


def disabled_semantic(code):
    return SemanticResult([dict(category=c,status='unavailable',reason=code)
                          for c in ('tone','messaging','facts_claims')],[],
                          dict(error_code=code,prompt_version=PROMPT_VERSION))


def can_dispatch(engine, claim, model):
    with Session(engine) as db:
        policy=db.get(ProcessingPolicy,claim.org_id)
        snapshot=claim.processing
        item=db.get(ContentItem,claim.item_id)
        brand=db.get(Brand,item.brand_id)
        run=db.get(ReviewRun,claim.run_id)
        revision=db.get(ContentRevision,claim.revision_id)
        if brand.source_epoch!=run.source_epoch or item.current_revision!=revision.number:
            return False
        return bool(snapshot.get('enabled') and snapshot.get('consent') and
                    snapshot.get('model')==model and policy and policy.enabled and
                    policy.version==snapshot.get('policy_version') and policy.model==model)


def checked_engine_result(result, review_input):
    checks=[CheckOut.model_validate(c).model_dump() for c in result.checks]
    if len({c['category'] for c in checks})!=len(checks):
        raise ModelFailure('duplicate_engine_check')
    if any(c['category'] not in DETERMINISTIC for c in checks):
        raise ModelFailure('unexpected_engine_category')
    categories=[c['category'] for c in checks if c['status']=='complete']
    findings=[EngineFinding.model_validate(f) for f in result.findings]
    if any(f.category not in categories for f in findings):
        raise ModelFailure('engine_finding_without_completed_check')
    # The same literal-evidence and canonical-location guarantees apply to engine findings.
    rules=[dict(source_version_id=s['id'],**r) for s in review_input.sources for r in s['rules']]
    class Output:
        evaluated_categories=categories
    output=Output()
    output.findings=findings
    return checks,validate_findings(output,review_input.text,rules,categories)


async def analyse_claim(engine, claim, reviewer, checker=None):
    metadata={}
    checks={c:dict(category=c,status='unavailable',reason='Deterministic engine is not connected.') for c in DETERMINISTIC}
    findings=[]
    remaining=60-(utcnow()-claim.created_at).total_seconds()
    if claim.exhausted:
        return [dict(category=c,status='failed',reason='attempts_exhausted') for c in CATEGORIES],[],{'error_code':'attempts_exhausted'}
    if remaining<=0:
        return [dict(category=c,status='failed',reason='deadline_exceeded') for c in CATEGORIES],[],{'error_code':'deadline_exceeded'}
    # The checker must be async and cancellable; no blocking untrusted parsing in this process.
    async with asyncio.timeout(remaining):
        if checker is not None:
            try:
                result=await checker(claim.review_input)
                engine_checks,engine_findings=checked_engine_result(result,claim.review_input)
                checks.update({c['category']:c for c in engine_checks})
                findings.extend([dict(f,origin='deterministic') for f in engine_findings])
            except (ValidationError, ModelFailure, ValueError, TypeError, AttributeError):
                checks={c:dict(category=c,status='failed',reason='invalid_engine_result') for c in DETERMINISTIC}
        if can_dispatch(engine,claim,reviewer.config.model):
            semantic=await reviewer.review(claim.review_input.text,claim.review_input.context,
                claim.review_input.sources,consent=True,
                remaining_seconds=60-(utcnow()-claim.created_at).total_seconds())
        else:
            semantic=disabled_semantic('external_processing_not_authorised')
        for check in semantic.checks:
            previous=checks.get(check['category'])
            # Fact/claim review requires both structured and semantic coverage.
            if previous and previous['status'] not in ('complete','not_applicable'):
                checks[check['category']]=previous
            else:
                checks[check['category']]=check
        findings.extend([dict(f,origin='model') for f in semantic.findings])
        metadata['semantic']=semantic.metadata
    return [checks[c] for c in CATEGORIES],findings,metadata


def finish_claim(engine,claim,checks,findings,metadata):
    with Session(engine) as db:
        item=db.scalar(select(ContentItem).where(ContentItem.org_id==claim.org_id,
            ContentItem.id==claim.item_id).with_for_update())
        brand=db.scalar(select(Brand).where(Brand.org_id==claim.org_id,
            Brand.id==item.brand_id).with_for_update())
        job=db.scalar(select(Job).where(Job.id==claim.job_id,Job.org_id==claim.org_id).with_for_update())
        run=db.get(ReviewRun,claim.run_id)
        if job.status!='running' or job.lease_token!=claim.lease_token or job.lease_expires_at<=utcnow():
            return False
        revision=db.get(ContentRevision,claim.revision_id)
        stale=(item.current_revision!=revision.number or brand.source_epoch!=run.source_epoch or
               any(s.get('valid_until') and datetime.fromisoformat(s['valid_until'])<=utcnow() for s in run.source_snapshot))
        if stale:
            # Keep the historical snapshot but never mark stale results ready for review.
            checks=[dict(c,status='needs_manual_review',reason='snapshot_stale') for c in checks]
        if (utcnow()-claim.created_at).total_seconds()>=60:
            checks=[dict(category=c,status='failed',reason='deadline_exceeded') for c in CATEGORIES]
            findings=[]
        complete=all(c['status'] in ('complete','not_applicable') for c in checks)
        run.checks,run.status,run.engine_metadata=checks,'complete' if complete else 'incomplete',metadata
        for finding in findings:
            f=dict(finding)
            start,end,quote=f.pop('start'),f.pop('end'),f.pop('content_quote')
            db.add(Finding(org_id=claim.org_id,run_id=run.id,revision_id=revision.id,
                **f,location=dict(block_id='text',start=start,end=end,quote=quote),resolution='unresolved'))
        job.status,job.lease_token,job.lease_expires_at='complete',None,None
        if item.current_revision==revision.number:
            item.state=('needs_changes' if any(f['severity']=='blocker' for f in findings) else 'ready_for_review') if complete else 'incomplete'
        db.add(AuditEvent(org_id=claim.org_id,actor_id=item.creator_id,action='analysis.finished',object_id=run.id,
            details=dict(status=run.status,finding_count=len(findings),executor='worker',stale=stale),created_at=utcnow()))
        db.commit()
        return True


def process_one(engine,reviewer,checker=None):
    claim=claim_one(engine)
    if claim is None:
        return False
    try:
        checks,findings,metadata=asyncio.run(analyse_claim(engine,claim,reviewer,checker))
    except Exception as exc:
        # Do not log exception text: provider/parser exceptions can contain documents or keys.
        code='deadline_exceeded' if isinstance(exc,TimeoutError) else 'analysis_failed'
        checks=[dict(category=c,status='failed',reason=code) for c in CATEGORIES]
        findings,metadata=[],dict(error_code=code)
    finish_claim(engine,claim,checks,findings,metadata)
    return True
