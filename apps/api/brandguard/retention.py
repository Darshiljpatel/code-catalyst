"""Retention: admins choose how long campaigns are kept; an hourly purge deletes older ones and writes a
deletion ledger (one audit event per campaign listing every deleted row id) that restore re-applies."""
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select, delete, func, or_
from sqlalchemy.orm import Session
from .core import db, identity, Problem
from .schemas import StrictInput

router = APIRouter(prefix='/api/v1')
# Campaigns someone is actively working through are never purged mid-flight.
ACTIVE_STATES = ('analysing', 'in_review', 'ocr_pending')
BATCH = 200


class RetentionInput(StrictInput):
    retention_days: int | None = Field(default=None, ge=30, le=3650)
    rationale: str = Field(min_length=10, max_length=1000)


class RetentionOut(BaseModel):
    retention_days: int | None
    purged_campaigns: int
    last_purge_at: datetime | None


def utcnow():
    return datetime.now(timezone.utc)


def retention_out(session, org):
    from .models import AuditEvent
    purged = session.scalar(select(func.count()).select_from(AuditEvent).where(AuditEvent.org_id == org.id,
        AuditEvent.action == 'retention.purged'))
    last = session.scalar(select(func.max(AuditEvent.created_at)).where(AuditEvent.org_id == org.id,
        AuditEvent.action == 'retention.purged'))
    return RetentionOut(retention_days=org.retention_days, purged_campaigns=purged, last_purge_at=last)


@router.get('/retention', response_model=RetentionOut)
def get_retention(member=Depends(identity), session: Session = Depends(db)):
    from .models import Organisation
    if member.role not in ('admin', 'manager'):
        raise Problem(403, 'forbidden', 'Only an admin or manager can see the retention policy.')
    return retention_out(session, session.get(Organisation, member.org_id))


@router.put('/retention', response_model=RetentionOut)
def set_retention(body: RetentionInput, member=Depends(identity), session: Session = Depends(db)):
    from .models import Organisation
    from .review import audit
    if member.role != 'admin':
        raise Problem(403, 'forbidden', 'Only an admin can change how long campaigns are kept.')
    org = session.scalar(select(Organisation).where(Organisation.id == member.org_id).with_for_update())
    before = org.retention_days
    org.retention_days, org.retention_set_by = body.retention_days, member.id
    audit(session, member, 'retention.updated', org.id, before=before, after=body.retention_days, rationale=body.rationale)
    session.commit()
    return retention_out(session, org)


def purge_campaigns(session, org, item_ids):
    """Delete the campaigns and every row that belongs to them. Returns the ledger details per campaign."""
    from . import models as m
    revisions = select(m.ContentRevision.id).where(m.ContentRevision.org_id == org.id, m.ContentRevision.item_id.in_(item_ids))
    runs = select(m.ReviewRun.id).where(m.ReviewRun.org_id == org.id, m.ReviewRun.revision_id.in_(revisions))
    findings = select(m.Finding.id).where(m.Finding.org_id == org.id, m.Finding.run_id.in_(runs))
    assets = select(m.Asset.id).where(m.Asset.org_id == org.id, m.Asset.item_id.in_(item_ids))
    ocr = select(m.OcrResult.id).where(m.OcrResult.org_id == org.id, m.OcrResult.asset_id.in_(assets))
    plan = [
        (m.Comment, m.Comment.revision_id.in_(revisions)),
        (m.FindingResolution, m.FindingResolution.finding_id.in_(findings)),
        (m.ManualCheck, m.ManualCheck.run_id.in_(runs)),
        (m.RecheckAssignment, m.RecheckAssignment.item_id.in_(item_ids)),
        (m.Decision, m.Decision.run_id.in_(runs)),
        (m.Finding, m.Finding.run_id.in_(runs)),
        (m.Job, or_(m.Job.run_id.in_(runs), m.Job.ocr_result_id.in_(ocr))),
        (m.OcrResult, m.OcrResult.asset_id.in_(assets)),
        (m.RunSource, m.RunSource.run_id.in_(runs)),
        (m.ReviewRun, m.ReviewRun.revision_id.in_(revisions)),
        (m.ContentRevision, m.ContentRevision.item_id.in_(item_ids)),
        (m.Asset, m.Asset.item_id.in_(item_ids)),
        (m.ContentItem, m.ContentItem.id.in_(item_ids)),
    ]
    ledger = {item_id: [] for item_id in item_ids}
    # Map every child row to its campaign before deleting, so restore can suppress each id.
    owner = dict(session.execute(select(m.ContentRevision.id, m.ContentRevision.item_id).where(m.ContentRevision.id.in_(revisions))).all())
    run_owner = {run_id: owner[rev] for run_id, rev in session.execute(
        select(m.ReviewRun.id, m.ReviewRun.revision_id).where(m.ReviewRun.id.in_(runs)))}
    for revision_id, item_id in owner.items():
        ledger[item_id].append(revision_id)
    for run_id, item_id in run_owner.items():
        ledger[item_id].append(run_id)
    for model, column in ((m.Finding, m.Finding.run_id), (m.Decision, m.Decision.run_id)):
        for row_id, run_id in session.execute(select(model.id, column).where(column.in_(runs))):
            ledger[run_owner[run_id]].append(row_id)
    for asset_id, item_id in session.execute(select(m.Asset.id, m.Asset.item_id).where(m.Asset.id.in_(assets))):
        ledger[item_id].append(asset_id)
    for model, condition in plan:
        session.execute(delete(model).where(model.org_id == org.id, condition))
    return ledger


def purge_expired_content(engine, now=None):
    """Hourly: delete campaigns with no activity for longer than their workspace's retention period."""
    from . import models as m
    now = now or utcnow()
    total = 0
    with Session(engine) as session:
        orgs = list(session.scalars(select(m.Organisation).where(m.Organisation.retention_days.is_not(None),
                                                                  m.Organisation.retention_set_by.is_not(None))))
        for org in orgs:
            cutoff = now - timedelta(days=org.retention_days)
            last_activity = (select(m.ContentRevision.item_id, func.max(m.ContentRevision.created_at).label('at'))
                             .where(m.ContentRevision.org_id == org.id).group_by(m.ContentRevision.item_id).subquery())
            item_ids = list(session.scalars(select(m.ContentItem.id).outerjoin(last_activity, last_activity.c.item_id == m.ContentItem.id)
                .where(m.ContentItem.org_id == org.id, ~m.ContentItem.state.in_(ACTIVE_STATES),
                       func.coalesce(last_activity.c.at, m.ContentItem.created_at) < cutoff).limit(BATCH)))
            imports = list(session.scalars(select(m.DocumentImport.id).where(m.DocumentImport.org_id == org.id,
                m.DocumentImport.created_at < cutoff).limit(BATCH)))
            if imports:
                session.execute(delete(m.DocumentImport).where(m.DocumentImport.id.in_(imports)))
                session.add(m.AuditEvent(org_id=org.id, actor_id=org.retention_set_by, action='retention.purged_imports', object_id=org.id,
                    details=dict(reason='retention_purge', retention_days=org.retention_days, deleted_ids=imports), created_at=now))
            if not item_ids:
                continue
            titles = dict(session.execute(select(m.ContentItem.id, m.ContentItem.title).where(m.ContentItem.id.in_(item_ids))).all())
            ledger = purge_campaigns(session, org, item_ids)
            for item_id, deleted_ids in ledger.items():
                # The ledger is the audit trail: restore re-applies these deletions after a backup is loaded.
                session.add(m.AuditEvent(org_id=org.id, actor_id=org.retention_set_by, action='retention.purged', object_id=item_id,
                    details=dict(reason='retention_purge', retention_days=org.retention_days, title_length=len(titles.get(item_id, '')),
                                 deleted_ids=deleted_ids), created_at=now))
            total += len(item_ids)
        session.commit()
    return total
