"""Workspace-authorised external processing; no credentials in API or database."""
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session
from pydantic import Field
from .core import db, identity, Problem
from .schemas import StrictInput
from .models import Organisation, ProcessingPolicy
from .review import audit
from .semantic import NEBIUS_BASE_URL

router = APIRouter(prefix='/api/v1')

class PolicyInput(StrictInput):
    enabled: bool
    expected_version: int = Field(ge=0)
    notice: str = Field(min_length=20, max_length=2000)
    rationale: str = Field(min_length=10, max_length=2000)

class PolicyOut(StrictInput):
    version: int
    enabled: bool
    provider: str
    model: str
    boundary: str
    notice: str
    max_input_bytes: int


def policy_out(policy, model, max_input_bytes):
    return PolicyOut(version=policy.version if policy else 0, enabled=policy.enabled if policy else False,
                     provider='nebius',model=model,boundary=NEBIUS_BASE_URL,
                     notice=policy.notice if policy else 'External processing is disabled.',
                     max_input_bytes=max_input_bytes)

@router.get('/processing-policy', response_model=PolicyOut)
def get_policy(request: Request, member=Depends(identity), session: Session=Depends(db)):
    config = request.app.state.provider_config
    return policy_out(session.get(ProcessingPolicy,member.org_id),config.model,config.max_input_bytes)

@router.put('/processing-policy', response_model=PolicyOut)
def update_policy(body: PolicyInput, request: Request, member=Depends(identity), session: Session=Depends(db)):
    if member.role != 'admin':
        raise Problem(403,'forbidden','A workspace administrator is required.')
    if len(body.notice.strip()) < 20 or len(body.rationale.strip()) < 10:
        raise Problem(422,'invalid_fields','A processing notice and rationale are required.')
    session.scalar(select(Organisation).where(Organisation.id==member.org_id).with_for_update())
    policy=session.get(ProcessingPolicy,member.org_id)
    version=policy.version if policy else 0
    if body.expected_version!=version:
        raise Problem(409,'policy_changed','Processing policy changed. Reload before saving.')
    if policy is None:
        policy=ProcessingPolicy(org_id=member.org_id)
        session.add(policy)
    policy.version=version+1
    policy.enabled=body.enabled
    policy.model=request.app.state.provider_config.model
    policy.notice=body.notice.strip()
    policy.approved_by=member.id
    policy.updated_at=datetime.now(timezone.utc)
    audit(session,member,'processing_policy.updated',member.org_id,version=policy.version,
          enabled=policy.enabled,rationale=body.rationale.strip())
    session.commit()
    return policy_out(policy,policy.model,request.app.state.provider_config.max_input_bytes)
