"""Re-review inbox for guideline changes (Improvement 1)."""
from typing import Literal
from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from .core import db, manager, Problem
from .impact import OPEN_STATUSES, queue_recheck, utcnow
from .models import GuidelineChange, RecheckAssignment, ContentItem, ContentRevision, ReviewRun, Membership
from .review import brand_for, audit, eligible_sources
from .schemas import (GuidelineChangeSummaryOut, GuidelineChangeOut, RecheckAssignmentOut, RecheckAssignInput,
                      RecheckQueueOut, SourceOut)
from .workflow import reviewer_member

router = APIRouter(prefix='/api/v1')


def change_summary(session, change, counts=None):
    if counts is None:
        counts = dict(session.execute(select(RecheckAssignment.status, func.count()).where(
            RecheckAssignment.change_id == change.id).group_by(RecheckAssignment.status)).all())
    total = sum(counts.values())
    diff = change.diff
    return dict(id=change.id, brand_id=change.brand_id, source_key=change.source_key, from_source_id=change.from_source_id,
        to_source_id=change.to_source_id, title=diff['to_source']['title'],
        from_version=diff['from_source']['version'] if diff['from_source'] else None, to_version=diff['to_source']['version'],
        status=change.status, impact_counts=change.impact_counts,
        resolved=counts.get('resolved', 0) + counts.get('superseded', 0), total=total,
        created_by=change.created_by, created_at=change.created_at, closed_at=change.closed_at)


def change_for(session, member, change_id, lock=False):
    query = select(GuidelineChange).where(GuidelineChange.org_id == member.org_id, GuidelineChange.id == change_id)
    change = session.scalar(query.with_for_update() if lock else query)
    if change is None:
        raise Problem(404, 'not_found', 'Guideline change not found.')
    return change


def assignment_out(assignment, item, run_status):
    return RecheckAssignmentOut(id=assignment.id, change_id=assignment.change_id, item_id=item.id, title=item.title,
        item_state=item.state, creator_id=item.creator_id, revision_id=assignment.revision_id,
        prior_run_id=assignment.prior_run_id, prior_decision_id=assignment.prior_decision_id,
        state_before=assignment.state_before, impact_level=assignment.impact_level, reasons=assignment.reasons,
        recheck_run_id=assignment.recheck_run_id, recheck_status=run_status, findings_delta=assignment.findings_delta,
        reviewer_id=assignment.reviewer_id, status=assignment.status, resolved_decision_id=assignment.resolved_decision_id,
        superseded_by=assignment.superseded_by, version=assignment.version, created_at=assignment.created_at,
        updated_at=assignment.updated_at, resolved_at=assignment.resolved_at)


@router.get('/guideline-changes', response_model=list[GuidelineChangeSummaryOut])
def list_changes(brand_id: str | None = None, status: Literal['open', 'closed'] | None = None,
                 member=Depends(manager), session: Session = Depends(db)):
    conditions = [GuidelineChange.org_id == member.org_id]
    if brand_id:
        brand_for(session, member, brand_id)
        conditions.append(GuidelineChange.brand_id == brand_id)
    if status:
        conditions.append(GuidelineChange.status == status)
    changes = list(session.scalars(select(GuidelineChange).where(*conditions).order_by(
        GuidelineChange.created_at.desc(), GuidelineChange.id).limit(100)))
    counts = {}
    if changes:
        for change_id, state, n in session.execute(select(RecheckAssignment.change_id, RecheckAssignment.status, func.count()).where(
                RecheckAssignment.change_id.in_([c.id for c in changes])).group_by(RecheckAssignment.change_id, RecheckAssignment.status)):
            counts.setdefault(change_id, {})[state] = n
    return [change_summary(session, c, counts.get(c.id, {})) for c in changes]


@router.get('/guideline-changes/{change_id}', response_model=GuidelineChangeOut)
def get_change(change_id: str, member=Depends(manager), session: Session = Depends(db)):
    change = change_for(session, member, change_id)
    rows = session.execute(select(RecheckAssignment, ContentItem, ReviewRun.status).join(
        ContentItem, ContentItem.id == RecheckAssignment.item_id).outerjoin(
        ReviewRun, ReviewRun.id == RecheckAssignment.recheck_run_id).where(
        RecheckAssignment.org_id == member.org_id, RecheckAssignment.change_id == change.id)).all()
    order = {'confirmed': 0, 'likely': 1, 'possible': 2}
    rows.sort(key=lambda r: (order[r[0].impact_level], r[1].title.casefold(), r[1].id))
    return GuidelineChangeOut(**change_summary(session, change), diff=change.diff,
        assignments=[assignment_out(a, i, s) for a, i, s in rows])


@router.put('/recheck-assignments/reviewer', response_model=list[RecheckAssignmentOut])
def assign_rechecks(body: RecheckAssignInput, member=Depends(manager), session: Session = Depends(db)):
    if set(body.expected_versions) != set(body.assignment_ids) or len(set(body.assignment_ids)) != len(body.assignment_ids):
        raise Problem(422, 'invalid_fields', 'Send the expected version of every selected recheck.')
    assignments = list(session.scalars(select(RecheckAssignment).where(RecheckAssignment.org_id == member.org_id,
        RecheckAssignment.id.in_(body.assignment_ids)).order_by(RecheckAssignment.id).with_for_update()))
    if len(assignments) != len(body.assignment_ids):
        raise Problem(404, 'not_found', 'Recheck not found.')
    reviewer = session.get(Membership, body.reviewer_id)
    at, results = utcnow(), []
    for assignment in assignments:
        if assignment.version != body.expected_versions[assignment.id]:
            raise Problem(409, 'recheck_changed', 'A selected recheck changed. Reload the inbox and try again.')
        if assignment.status not in OPEN_STATUSES:
            raise Problem(409, 'recheck_closed', 'A selected recheck is already resolved.')
        item = session.scalar(select(ContentItem).where(ContentItem.org_id == member.org_id,
            ContentItem.id == assignment.item_id).with_for_update())
        reviewer_member(session, member.org_id, body.reviewer_id, item.creator_id)
        assignment.reviewer_id = reviewer.id
        assignment.version += 1
        assignment.updated_at = at
        if item.reviewer_id != reviewer.id:
            item.reviewer_id = reviewer.id
            item.workflow_version += 1
        audit(session, member, 'recheck.assigned', assignment.id, item_id=item.id, reviewer_id=reviewer.id,
              change_id=assignment.change_id)
        results.append((assignment, item))
    session.commit()
    statuses = dict(session.execute(select(ReviewRun.id, ReviewRun.status).where(
        ReviewRun.id.in_([a.recheck_run_id for a, _ in results if a.recheck_run_id]))).all()) if results else {}
    return [assignment_out(a, i, statuses.get(a.recheck_run_id)) for a, i in results]


@router.post('/guideline-changes/{change_id}/rechecks', response_model=RecheckQueueOut)
def requeue_rechecks(change_id: str, request: Request, member=Depends(manager), session: Session = Depends(db)):
    """Re-queue rechecks that never queued or whose run failed. Safe to repeat."""
    change = change_for(session, member, change_id)
    brand = brand_for(session, member, change.brand_id, lock=True)
    at = utcnow()
    sources = [SourceOut.model_validate(s).model_dump(mode='json') for s in eligible_sources(session, member, brand.id, at)]
    queued = []
    for assignment in session.scalars(select(RecheckAssignment).where(RecheckAssignment.org_id == member.org_id,
            RecheckAssignment.change_id == change.id, RecheckAssignment.status.in_(('open', 'recheck_queued'))).with_for_update()):
        run = session.get(ReviewRun, assignment.recheck_run_id) if assignment.recheck_run_id else None
        if run is not None and run.status != 'failed':
            continue
        item = session.scalar(select(ContentItem).where(ContentItem.id == assignment.item_id).with_for_update())
        revision = session.scalar(select(ContentRevision).where(ContentRevision.org_id == member.org_id,
            ContentRevision.item_id == item.id, ContentRevision.number == item.current_revision))
        if session.scalar(select(ReviewRun.id).where(ReviewRun.revision_id == revision.id,
                ReviewRun.status.in_(('queued', 'running')))) or not sources:
            continue
        queue_recheck(session, member, assignment, item, revision, session.get(ReviewRun, assignment.prior_run_id),
                      sources, brand.source_epoch, request.app.state.settings.max_external_runs_per_day, at)
        queued.append(assignment.id)
    if queued:
        audit(session, member, 'recheck.requeued', change.id, assignment_ids=queued)
    session.commit()
    return RecheckQueueOut(change_id=change.id, queued=queued)
