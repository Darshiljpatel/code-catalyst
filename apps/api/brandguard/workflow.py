"""Human review and exact-revision export. Locks serialise all approval inputs."""
from datetime import datetime, timezone
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session
from .core import db, identity, manager, Problem, digest
from .models import (Membership, User, ReviewRun, Finding, Comment, FindingResolution,
                     ManualCheck, Decision)
from .impact import resolve_on_decision, recheck_records
from .review import (item_for, revision_for, brand_for, eligible_sources, content_out,
                     audit, CATEGORIES, run_out)
from .schemas import (AssignmentInput, SubmissionInput, DecisionInput, ResolutionInput,
    ManualCheckInput, CommentInput, ContentOut, CommentOut, ResolutionOut, ManualCheckOut,
    DecisionOut, ReviewerOut, ExportOut, FindingOut, CheckOut, ReviewRecordOut)

router=APIRouter(prefix='/api/v1')


def utcnow():
    return datetime.now(timezone.utc)


def conflict(code,message):
    raise Problem(409,code,message)


def expect_version(item,expected):
    if item.workflow_version!=expected:
        conflict('workflow_changed','Review changed. Reload before continuing.')


def reviewer_member(session,org_id,member_id,creator_id):
    reviewer=session.scalar(select(Membership).where(Membership.org_id==org_id,
        Membership.id==member_id,Membership.role=='reviewer').with_for_update(read=True).execution_options(populate_existing=True))
    creator=session.get(Membership,creator_id)
    if reviewer is None or reviewer.user_id==creator.user_id:
        raise Problem(422,'invalid_reviewer','Select a separate authorised reviewer in this workspace.')
    return reviewer


def assigned_reviewer(member,item,session=None):
    if session is not None:
        session.scalar(select(Membership).where(Membership.id==member.id,
            Membership.org_id==member.org_id).with_for_update(read=True).execution_options(populate_existing=True))
    if member.role!='reviewer' or item.reviewer_id!=member.id or item.creator_id==member.id:
        raise Problem(403,'forbidden','Only the assigned separate reviewer can make this decision.')


def latest_run(session,member,revision):
    run=session.scalar(select(ReviewRun).where(ReviewRun.org_id==member.org_id,
        ReviewRun.revision_id==revision.id).order_by(ReviewRun.created_at.desc(),ReviewRun.id.desc()).limit(1))
    if run is None:
        conflict('analysis_required','Analyse this revision before review.')
    return run


def fresh_run(session,member,revision,item,expected_run=None,expected_epoch=None):
    brand=brand_for(session,member,item.brand_id,lock=True)
    if revision.number!=item.current_revision:
        conflict('stale_revision','This is not the current revision.')
    run=latest_run(session,member,revision)
    if expected_run is not None and run.id!=expected_run:
        conflict('analysis_changed','A newer analysis is available. Reload the review.')
    if expected_epoch is not None and brand.source_epoch!=expected_epoch:
        conflict('source_changed','Approved sources changed. Analyse again.')
    current={s.id for s in eligible_sources(session,member,brand.id,utcnow())}
    if current!={s['id'] for s in run.source_snapshot}:
        conflict('source_changed','Approved sources changed or expired. Analyse again.')
    if run.status in ('queued','running'):
        conflict('analysis_pending','Wait for analysis to finish.')
    return run,brand


def manual_checks(session,member,run,item):
    return list(session.scalars(select(ManualCheck).where(ManualCheck.org_id==member.org_id,
        ManualCheck.run_id==run.id,ManualCheck.reviewer_id==item.reviewer_id).order_by(ManualCheck.category)))


def effective_checks(session,member,run,item):
    # Automated results remain untouched; human attestations are separately attributed.
    checks={}
    for raw in run.checks:
        parsed=CheckOut.model_validate(raw).model_dump()
        if parsed['category'] in checks:
            conflict('invalid_check_coverage','Analysis check coverage is invalid.')
        checks[parsed['category']]=dict(parsed,origin='automated')
    for attestation in manual_checks(session,member,run,item):
        previous=checks.get(attestation.category)
        if previous is None or previous['status'] not in ('complete','not_applicable'):
            checks[attestation.category]=dict(category=attestation.category,status=attestation.outcome,
                reason=attestation.rationale,origin='human',manual_check_id=attestation.id)
    return [checks.get(c,dict(category=c,status='unavailable',reason='Missing check.',origin='automated')) for c in CATEGORIES]


def require_checks(session,member,run,item):
    checks=effective_checks(session,member,run,item)
    if any(c['status'] not in ('complete','not_applicable') for c in checks):
        conflict('incomplete_checks','Required checks need a successful rerun or explicit per-check human completion.')
    return checks


def run_findings(session,member,run):
    return list(session.scalars(select(Finding).where(Finding.org_id==member.org_id,
        Finding.run_id==run.id).order_by(Finding.id)))


def resolutions(session,member,run):
    return list(session.scalars(select(FindingResolution).join(Finding,Finding.id==FindingResolution.finding_id).where(
        FindingResolution.org_id==member.org_id,Finding.run_id==run.id).order_by(FindingResolution.created_at,FindingResolution.id)))


def require_blockers(session,member,run,item):
    authorised={}
    for entry in resolutions(session,member,run):
        if entry.actor_id==item.reviewer_id and entry.action in ('confirm','dismiss','grant_exception','reject_exception'):
            authorised[entry.finding_id]=entry.action
    for finding in run_findings(session,member,run):
        if finding.severity=='blocker' and authorised.get(finding.id) not in ('dismiss','grant_exception'):
            conflict('unresolved_blockers','Resolve blocking findings or obtain a reasoned reviewer exception.')


def source_references(run,ids):
    if len(set(ids))!=len(ids) or not set(ids).issubset({s['id'] for s in run.source_snapshot}):
        raise Problem(422,'invalid_evidence','Evidence must reference this review source snapshot.')


def evidence_record(session,member,revision,item,run):
    return dict(source_snapshot=run.source_snapshot,source_epoch=run.source_epoch,
        automated_checks=run.checks,effective_checks=effective_checks(session,member,run,item),
        processing_snapshot=run.processing_snapshot,engine_metadata=run.engine_metadata,
        findings=[FindingOut.model_validate(f).model_dump(mode='json') for f in run_findings(session,member,run)],
        resolutions=[ResolutionOut.model_validate(r).model_dump(mode='json') for r in resolutions(session,member,run)],
        manual_checks=[ManualCheckOut.model_validate(r).model_dump(mode='json') for r in manual_checks(session,member,run,item)],
        comments=[CommentOut.model_validate(r).model_dump(mode='json') for r in session.scalars(select(Comment).where(
            Comment.org_id==member.org_id,Comment.revision_id==revision.id).order_by(Comment.created_at,Comment.id))],
        exception_notice='A reviewer exception is not proof that a promotional claim is true.')


@router.get('/reviewers',response_model=list[ReviewerOut])
def list_reviewers(member=Depends(identity),session:Session=Depends(db)):
    return [ReviewerOut(id=m.id,user_id=m.user_id,email=u.email) for m,u in session.execute(
        select(Membership,User).join(User,Membership.user_id==User.id).where(
            Membership.org_id==member.org_id,Membership.role=='reviewer').order_by(User.email))]


@router.put('/content/{item_id}/reviewer',response_model=ContentOut)
def assign_reviewer(item_id:str,body:AssignmentInput,member=Depends(manager),session:Session=Depends(db)):
    item=item_for(session,member,item_id,lock=True)
    expect_version(item,body.expected_item_version)
    if item.state=='approved':conflict('workflow_locked','Create a new revision before changing an approved review.')
    reviewer_member(session,member.org_id,body.reviewer_id,item.creator_id)
    item.reviewer_id=body.reviewer_id
    item.workflow_version+=1
    audit(session,member,'reviewer.assigned',item.id,reviewer_id=item.reviewer_id,rationale=body.rationale)
    session.commit()
    return content_out(session,item)


@router.get('/revisions/{revision_id}/comments',response_model=list[CommentOut])
def list_comments(revision_id:str,member=Depends(identity),session:Session=Depends(db)):
    revision_for(session,member,revision_id)
    return list(session.scalars(select(Comment).where(Comment.org_id==member.org_id,
        Comment.revision_id==revision_id).order_by(Comment.created_at,Comment.id)))


@router.post('/revisions/{revision_id}/comments',status_code=201,response_model=CommentOut)
def add_comment(revision_id:str,body:CommentInput,member=Depends(identity),session:Session=Depends(db)):
    revision,item=revision_for(session,member,revision_id,lock=True)
    if body.finding_id:
        finding=session.scalar(select(Finding).where(Finding.org_id==member.org_id,
            Finding.id==body.finding_id,Finding.revision_id==revision.id))
        if finding is None:raise Problem(404,'not_found','Finding not found in this revision.')
    comment=Comment(org_id=member.org_id,revision_id=revision.id,author_id=member.id,
        finding_id=body.finding_id,text=body.text,created_at=utcnow())
    session.add(comment);session.flush()
    audit(session,member,'comment.created',comment.id,revision_id=revision.id)
    session.commit()
    return comment


@router.post('/findings/{finding_id}/resolutions',status_code=201,response_model=ResolutionOut)
def resolve_finding(finding_id:str,body:ResolutionInput,member=Depends(identity),session:Session=Depends(db)):
    finding=session.scalar(select(Finding).where(Finding.org_id==member.org_id,Finding.id==finding_id))
    if finding is None:raise Problem(404,'not_found','Finding not found.')
    revision,item=revision_for(session,member,finding.revision_id,lock=True)
    expect_version(item,body.expected_item_version)
    run,_=fresh_run(session,member,revision,item,expected_run=finding.run_id)
    if item.state in ('approved','changes_requested') or session.scalar(select(Decision.id).where(Decision.run_id==run.id)):
        conflict('workflow_locked','This review is already decided. Create a new revision or analysis.')
    if body.action in ('request_exception','request_dismissal'):
        if item.creator_id!=member.id:raise Problem(403,'forbidden','Only the creator can request an exception or dismissal.')
    else:
        assigned_reviewer(member,item,session)
        if body.action=='dismiss' and finding.category=='facts_claims' and finding.evidence_status in ('unsupported','contradicted'):
            conflict('claim_requires_exception','Correct the claim or record an explicit reviewer exception.')
    source_references(run,body.source_version_ids)
    entry=FindingResolution(org_id=member.org_id,finding_id=finding.id,actor_id=member.id,
        action=body.action,rationale=body.rationale,source_version_ids=body.source_version_ids,created_at=utcnow())
    session.add(entry);session.flush()
    finding.resolution={'request_exception':'exception_requested','request_dismissal':'dismissal_requested',
        'confirm':'confirmed','dismiss':'dismissed','grant_exception':'exception','reject_exception':'exception_rejected'}[body.action]
    item.workflow_version+=1
    audit(session,member,'finding.'+body.action,finding.id,resolution_id=entry.id,run_id=run.id)
    session.commit()
    return entry


@router.post('/runs/{run_id}/manual-checks',status_code=201,response_model=ManualCheckOut)
def complete_manual_check(run_id:str,body:ManualCheckInput,member=Depends(identity),session:Session=Depends(db)):
    run=session.scalar(select(ReviewRun).where(ReviewRun.org_id==member.org_id,ReviewRun.id==run_id))
    if run is None:raise Problem(404,'not_found','Review run not found.')
    revision,item=revision_for(session,member,run.revision_id,lock=True)
    assigned_reviewer(member,item)
    expect_version(item,body.expected_item_version)
    fresh_run(session,member,revision,item,expected_run=run.id)
    assigned_reviewer(member,item,session)
    if item.state=='approved' or session.scalar(select(Decision.id).where(Decision.run_id==run.id)):
        conflict('workflow_locked','This review is already decided.')
    if session.scalar(select(ManualCheck.id).where(ManualCheck.run_id==run.id,
        ManualCheck.category==body.category,ManualCheck.reviewer_id==member.id)):
        conflict('check_already_recorded','This manual check is already recorded. Reanalyse to start a new review.')
    source_references(run,body.source_version_ids)
    if body.outcome=='complete' and not body.source_version_ids:
        raise Problem(422,'evidence_required','A completed manual check needs approved source references.')
    relevant=[s for s in run.source_snapshot if any(r['category']==body.category for r in s['rules'])]
    if body.outcome=='not_applicable' and relevant:
        conflict('applicable_rule','A source rule applies to this category; inspect it explicitly.')
    if body.outcome=='complete' and relevant and not set(body.source_version_ids).intersection(s['id'] for s in relevant):
        raise Problem(422,'evidence_required','Cite an approved source for this category.')
    entry=ManualCheck(org_id=member.org_id,run_id=run.id,reviewer_id=member.id,category=body.category,
        outcome=body.outcome,rationale=body.rationale,source_version_ids=body.source_version_ids,created_at=utcnow())
    session.add(entry);session.flush()
    item.workflow_version+=1
    audit(session,member,'check.manually_completed',run.id,manual_check_id=entry.id,category=body.category)
    session.commit()
    return entry


@router.get('/revisions/{revision_id}/review',response_model=ReviewRecordOut)
def review_record(revision_id:str,member=Depends(identity),session:Session=Depends(db)):
    revision,item=revision_for(session,member,revision_id)
    run=latest_run(session,member,revision)
    decisions=list(session.scalars(select(Decision).where(Decision.org_id==member.org_id,
        Decision.revision_id==revision.id).order_by(Decision.decided_at)))
    return dict(run_id=run.id,workflow_version=item.workflow_version,
        stale=run_out(session,member,run,revision,item).stale,evidence=evidence_record(session,member,revision,item,run),
        decisions=[DecisionOut.model_validate(d).model_dump(mode='json') for d in decisions])


@router.post('/revisions/{revision_id}/submit',response_model=ContentOut)
def submit_revision(revision_id:str,body:SubmissionInput,member=Depends(identity),session:Session=Depends(db)):
    revision,item=revision_for(session,member,revision_id,lock=True,edit=True)
    expect_version(item,body.expected_item_version)
    if item.state in ('approved','in_review'):conflict('workflow_locked','This revision is already submitted or approved.')
    reviewer_member(session,member.org_id,body.reviewer_id,item.creator_id)
    run,_=fresh_run(session,member,revision,item,body.expected_run_id,body.expected_source_epoch)
    if session.scalar(select(Decision.id).where(Decision.run_id==run.id)):
        conflict('review_decided','Start a new revision or analysis after changes were requested.')
    item.reviewer_id=body.reviewer_id
    require_checks(session,member,run,item)
    require_blockers(session,member,run,item)
    item.state='in_review'
    item.workflow_version+=1
    audit(session,member,'revision.submitted',revision.id,run_id=run.id,reviewer_id=item.reviewer_id)
    session.commit()
    return content_out(session,item)


@router.post('/revisions/{revision_id}/decisions',status_code=201,response_model=DecisionOut)
def decide_revision(revision_id:str,body:DecisionInput,member=Depends(identity),session:Session=Depends(db)):
    revision,item=revision_for(session,member,revision_id,lock=True)
    assigned_reviewer(member,item)
    expect_version(item,body.expected_item_version)
    if item.state!='in_review':conflict('not_in_review','The creator must submit this revision before a decision.')
    run,brand=fresh_run(session,member,revision,item,body.expected_run_id,body.expected_source_epoch)
    assigned_reviewer(member,item,session)
    if session.scalar(select(Decision.id).where(Decision.run_id==run.id)):
        conflict('review_decided','This review already has a final decision.')
    if body.kind=='approved':
        require_checks(session,member,run,item)
        require_blockers(session,member,run,item)
    evidence=evidence_record(session,member,revision,item,run)
    # A re-approval after a guideline change closes the recheck and names both guideline versions.
    recheck_of=recheck_records(session,item) if body.kind=='approved' else []
    if recheck_of:evidence['recheck_of']=recheck_of
    decision=Decision(org_id=member.org_id,revision_id=revision.id,run_id=run.id,reviewer_id=member.id,
        kind=body.kind,rationale=body.rationale,source_epoch=brand.source_epoch,text_hash=revision.text_hash,
        evidence_record=evidence,decided_at=utcnow())
    session.add(decision);session.flush()
    resolve_on_decision(session,item,decision,decision.decided_at)
    item.state='approved' if body.kind=='approved' else 'changes_requested'
    item.workflow_version+=1
    audit(session,member,'revision.'+body.kind,revision.id,decision_id=decision.id,run_id=run.id,rationale=body.rationale)
    session.commit()
    return decision


@router.get('/revisions/{revision_id}/export',response_model=ExportOut)
def export_revision(revision_id:str,member=Depends(identity),session:Session=Depends(db)):
    revision,item=revision_for(session,member,revision_id,lock=True)
    if item.state!='approved':conflict('not_approved','Only the current approved revision can be exported.')
    run,brand=fresh_run(session,member,revision,item)
    decision=session.scalar(select(Decision).where(Decision.org_id==member.org_id,Decision.run_id==run.id,
        Decision.revision_id==revision.id,Decision.kind=='approved'))
    if decision is None or decision.reviewer_id!=item.reviewer_id:
        conflict('approval_stale','Approval is no longer current.')
    reviewer_member(session,member.org_id,decision.reviewer_id,item.creator_id)
    if digest(revision.text)!=decision.text_hash or revision.text_hash!=decision.text_hash:
        conflict('content_hash_mismatch','The content no longer matches the approved revision.')
    require_checks(session,member,run,item)
    require_blockers(session,member,run,item)
    result=ExportOut(revision_id=revision.id,content_id=item.id,text=revision.text,text_hash=decision.text_hash,
        channel=revision.channel,audience=revision.audience,purpose=revision.purpose,
        decision=DecisionOut.model_validate(decision),evidence_record=decision.evidence_record,exported_at=utcnow())
    audit(session,member,'revision.exported',revision.id,decision_id=decision.id,text_hash=decision.text_hash)
    session.commit()
    return result
