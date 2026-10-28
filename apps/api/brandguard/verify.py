"""Approval-record verification: check a downloaded audit record against what the workspace recorded."""
import json
from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session
from .core import db, identity, digest
from .impact import OPEN_STATUSES
from .models import Decision, ContentRevision, ContentItem, RecheckAssignment
from .review import audit

router = APIRouter(prefix='/api/v1')


class RecordDecision(BaseModel):
    model_config = ConfigDict(extra='ignore')
    id: str = Field(min_length=1, max_length=36)


class RecordInput(BaseModel):
    """The audit record JSON downloaded from an approved export. Extra fields are ignored."""
    model_config = ConfigDict(extra='ignore')
    revision_id: str = Field(min_length=1, max_length=36)
    text: str = Field(max_length=100000)
    text_hash: str = Field(max_length=64)
    decision: RecordDecision
    evidence_record: dict
    image_sha256: str | None = Field(default=None, max_length=64)


class VerificationCheck(BaseModel):
    code: str
    passed: bool
    message: str


class VerificationOut(BaseModel):
    verified: bool
    still_current: bool | None
    decision_id: str
    content_id: str | None
    checks: list[VerificationCheck]


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, default=str)


@router.post('/verify/approval-record', response_model=VerificationOut)
def verify_record(body: RecordInput, member=Depends(identity), session: Session = Depends(db)):
    checks = []

    def add(code, passed, ok, failed):
        checks.append(VerificationCheck(code=code, passed=passed, message=ok if passed else failed))

    decision = session.scalar(select(Decision).where(Decision.org_id == member.org_id, Decision.id == body.decision.id))
    add('decision_found', decision is not None, 'This workspace recorded this decision.',
        'No decision with this id exists in this workspace. The record is from another workspace or was invented.')
    if decision is None:
        return VerificationOut(verified=False, still_current=None, decision_id=body.decision.id, content_id=None, checks=checks)
    revision = session.scalar(select(ContentRevision).where(ContentRevision.org_id == member.org_id,
                                                            ContentRevision.id == decision.revision_id))
    item = session.scalar(select(ContentItem).where(ContentItem.org_id == member.org_id, ContentItem.id == revision.item_id))
    add('approved', decision.kind == 'approved', 'The decision is an approval.', 'The decision was not an approval.')
    add('same_revision', body.revision_id == decision.revision_id, 'The record names the approved revision.',
        'The record names a different revision from the one approved.')
    add('text_unchanged', digest(body.text) == decision.text_hash == body.text_hash,
        'The text is exactly the text that was approved.', 'The text differs from the approved text, even if only slightly.')
    add('evidence_unchanged', canonical(body.evidence_record) == canonical(decision.evidence_record),
        'The approval evidence (checks, findings and guideline versions) is unchanged.',
        'The approval evidence in this record was edited.')
    if decision.asset_sha256 or body.image_sha256:
        add('image_unchanged', body.image_sha256 == decision.asset_sha256, 'The image fingerprint matches the approved image.',
            'The image fingerprint differs from the approved image.')
    verified = all(c.passed for c in checks)
    # Still current: the campaign was not reopened by a later revision or a guideline change.
    reopened = session.scalar(select(RecheckAssignment.id).where(RecheckAssignment.org_id == member.org_id,
        RecheckAssignment.item_id == item.id, RecheckAssignment.status.in_(OPEN_STATUSES)).limit(1))
    # A later decision (a re-approval, or an approval kept through a guideline recheck) replaces this one.
    latest = session.scalar(select(Decision.id).where(Decision.org_id == member.org_id, Decision.revision_id == revision.id)
        .order_by(Decision.decided_at.desc(), Decision.id.desc()).limit(1))
    still_current = (verified and item.state == 'approved' and revision.number == item.current_revision and reopened is None
                     and latest == decision.id)
    audit(session, member, 'approval_record.verified', decision.id, verified=verified, still_current=still_current)
    session.commit()
    return VerificationOut(verified=verified, still_current=still_current, decision_id=decision.id, content_id=item.id, checks=checks)
