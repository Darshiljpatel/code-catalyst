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


class ProviderStatusOut(StrictInput):
    model: str
    runs_24h: int
    errors_24h: int
    error_rate_24h: float | None
    p95_latency_ms_24h: int | None
    last_success_at: datetime | None


# Provider-side failures; a rejected finding or a run without consent is not the provider's fault.
PROVIDER_ERRORS = ('rate_limited', 'provider_http_error', 'provider_timeout', 'provider_unreachable', 'provider_auth_failed',
                   'provider_request_rejected', 'model_mismatch', 'truncated_or_unfinished', 'response_too_large',
                   'invalid_model_response', 'incomplete_coverage', 'deadline_exceeded', 'unexpected_model_action')


@router.get('/provider-status', response_model=ProviderStatusOut)
def provider_status(request: Request, member=Depends(identity), session: Session=Depends(db)):
    """Admin card: how the AI provider behaved for this workspace (24-hour window, last success within 7 days)."""
    from datetime import timedelta
    from .models import ReviewRun
    if member.role != 'admin':
        raise Problem(403,'forbidden','A workspace administrator is required.')
    at=datetime.now(timezone.utc)
    rows=session.execute(select(ReviewRun.engine_metadata,ReviewRun.created_at).where(ReviewRun.org_id==member.org_id,
        ReviewRun.created_at>=at-timedelta(days=7),ReviewRun.processing_snapshot['enabled'].as_boolean()==True)).all()
    calls=[((m or {}).get('semantic') or {},created) for m,created in rows]
    calls=[(meta,created) for meta,created in calls if meta.get('returned_model') or meta.get('error_code') in PROVIDER_ERRORS]
    day=[(meta,created) for meta,created in calls if created>=at-timedelta(hours=24)]
    errors=sum(meta.get('error_code') in PROVIDER_ERRORS for meta,_ in day)
    latencies=sorted(meta['latency_ms'] for meta,_ in day if isinstance(meta.get('latency_ms'),int))
    successes=[created for meta,created in calls if meta.get('error_code') not in PROVIDER_ERRORS]
    return ProviderStatusOut(model=request.app.state.provider_config.model,runs_24h=len(day),errors_24h=errors,
        error_rate_24h=round(errors/len(day),3) if day else None,
        p95_latency_ms_24h=latencies[min(len(latencies)-1,round(0.95*(len(latencies)-1)))] if latencies else None,
        last_success_at=max(successes) if successes else None)
