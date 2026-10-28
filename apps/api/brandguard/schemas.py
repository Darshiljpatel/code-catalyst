"""Shared input/output models for S2. IDs/tenant/actor fields are server-owned."""
from datetime import datetime
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

class StrictInput(BaseModel):
    model_config = ConfigDict(extra='forbid')

class RuleInput(StrictInput):
    id: str = Field(min_length=1, max_length=100)
    category: Literal['terminology','tone','messaging','facts_claims','visual','accessibility']
    kind: Literal['terminology','fact','claim_policy','guidance','asset','contrast','alt_text']
    key: str = Field(min_length=1, max_length=100)
    value: str = Field(min_length=1, max_length=2000)
    evidence_quote: str = Field(min_length=1, max_length=4000)
    # Terminology only: exact spellings that are also acceptable, and spellings always flagged.
    allowed_variants: list[str] | None = Field(default=None, max_length=20)
    forbidden_variants: list[str] | None = Field(default=None, max_length=20)

    @field_validator('allowed_variants', 'forbidden_variants')
    @classmethod
    def clean_variants(cls, value):
        if value is None:
            return None
        cleaned = [v.strip() for v in value]
        if any(not v or len(v) > 100 for v in cleaned) or len(set(cleaned)) != len(cleaned):
            raise ValueError('Variants must be distinct, non-blank and at most 100 characters')
        return cleaned or None

    @model_validator(mode='after')
    def variants_are_terminology(self):
        if (self.allowed_variants or self.forbidden_variants) and self.kind != 'terminology':
            raise ValueError('Variants apply to terminology rules only')
        if set(self.allowed_variants or []) & set(self.forbidden_variants or []):
            raise ValueError('A variant cannot be both allowed and forbidden')
        return self

class SourceInput(StrictInput):
    source_key: str = Field(pattern=r'^[A-Za-z0-9_-]{1,100}$')
    title: str = Field(min_length=1, max_length=200)
    text: str = Field(min_length=1, max_length=100000)
    rules: list[RuleInput] = Field(min_length=1, max_length=100)
    valid_from: datetime
    valid_until: datetime | None = None

    @model_validator(mode='after')
    def validate_source(self):
        if not self.title.strip() or not self.text.strip():
            raise ValueError('Source title and text must not be blank')
        for date in (self.valid_from, self.valid_until):
            if date is not None and date.utcoffset() is None:
                raise ValueError('Source dates must include timezone')
        if self.valid_until and self.valid_until <= self.valid_from:
            raise ValueError('Invalid validity window')
        if len({r.id for r in self.rules}) != len(self.rules):
            raise ValueError('Duplicate rule IDs')
        if any(r.evidence_quote not in self.text for r in self.rules):
            raise ValueError('Evidence must be present in source text')
        seen = {}
        for r in self.rules:
            if r.kind == 'fact':
                if r.key in seen and seen[r.key] != r.value:
                    raise ValueError('Contradictory facts in source')
                seen[r.key] = r.value
        return self

class ActivationInput(StrictInput):
    expected_epoch: int = Field(ge=0)
    verified: Literal[True]
    retire_source_ids: list[str] = Field(default_factory=list, max_length=100)
    rationale: str = Field(min_length=10, max_length=2000)
    # Required when the linked improvement request's comparison found regressions.
    regression_acknowledgement: str | None = Field(default=None, max_length=2000)

class RevisionInput(StrictInput):
    text: str = Field(min_length=1, max_length=100000)
    channel: str = Field(min_length=1, max_length=100)
    audience: str = Field(min_length=1, max_length=300)
    purpose: str = Field(min_length=1, max_length=500)

    @field_validator('text', 'channel', 'audience', 'purpose')
    @classmethod
    def nonempty(cls, value):
        if not value.strip():
            raise ValueError('Must not be blank')
        return value.replace('\r\n', '\n').replace('\r', '\n')

class ContentInput(RevisionInput):
    document_import_id: str | None = Field(default=None, min_length=1, max_length=36)
    brand_id: str = Field(min_length=1, max_length=36)
    title: str = Field(min_length=1, max_length=200)
    reviewer_id: str | None = Field(default=None, min_length=1, max_length=36)

class NewRevisionInput(RevisionInput):
    parent_revision_id: str = Field(min_length=1, max_length=36)
    document_import_id: str | None = Field(default=None, min_length=1, max_length=36)

class SourceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    brand_id: str
    source_key: str
    version: int
    owner_id: str
    title: str
    text: str
    text_hash: str
    rules: list[RuleInput]
    valid_from: datetime
    valid_until: datetime | None
    state: str
    created_at: datetime
    activated_by: str | None
    activated_at: datetime | None

class RevisionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    item_id: str
    number: int
    author_id: str
    text: str
    text_hash: str
    channel: str
    audience: str
    purpose: str
    created_at: datetime
    asset_id: str | None = None
    asset_sha256: str | None = None
    region_map: list[dict] | None = None
    source_document: dict | None = None

class ImageOut(BaseModel):
    asset_id: str
    sha256: str
    original_sha256: str
    mime: str
    width: int
    height: int
    intake: dict
    ocr_status: str | None
    ocr_result_id: str | None

class RecheckNoticeOut(BaseModel):
    assignment_id: str
    change_id: str
    status: str
    impact_level: str
    reasons: list[dict]
    state_before: str
    findings_delta: dict | None
    guideline_title: str
    from_version: int | None
    to_version: int
    changed_rules: int
    changed_at: datetime
    routing: str = 'hold'

class ContentOut(BaseModel):
    id: str
    brand_id: str
    title: str
    creator_id: str
    reviewer_id: str | None
    current_revision: int
    workflow_version: int
    approval_stale: bool = False
    latest_run_id: str | None = None
    state: str
    revisions: list[RevisionOut]
    recheck: RecheckNoticeOut | None = None
    image: ImageOut | None = None

class CheckOut(BaseModel):
    category: Literal['terminology','tone','messaging','facts_claims','visual','accessibility']
    status: Literal['complete','unavailable','failed','needs_manual_review','not_applicable']
    reason: str

class RunOut(BaseModel):
    id: str
    revision_id: str
    source_epoch: int
    source_snapshot: list[SourceOut]
    checks: list[CheckOut]
    status: str
    created_at: datetime
    stale: bool
    processing_snapshot: dict
    engine_metadata: dict
    findings: list['FindingOut']

class AnalysisInput(StrictInput):
    external_processing_consent: bool = False
    policy_version: int | None = Field(default=None, ge=1)

class FindingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    revision_id: str
    run_id: str
    category: str
    severity: str
    evidence_status: str
    origin: str
    source_version_id: str
    rule_id: str
    evidence_quote: str
    location: dict
    rationale: str
    suggested_edit: str | None
    resolution: str

class RationaleInput(StrictInput):
    rationale: str = Field(min_length=20,max_length=4000)

    @field_validator('rationale')
    @classmethod
    def meaningful_reason(cls,value):
        if len(value.strip())<20:
            raise ValueError('A meaningful rationale is required')
        return value.strip()

class ReviewGuard(StrictInput):
    expected_item_version: int = Field(ge=1)
    expected_run_id: str = Field(min_length=1,max_length=36)
    expected_source_epoch: int = Field(ge=0)

class SubmissionInput(ReviewGuard):
    reviewer_id: str = Field(min_length=1,max_length=36)

class AssignmentInput(RationaleInput):
    expected_item_version: int = Field(ge=1)
    reviewer_id: str = Field(min_length=1,max_length=36)

class DecisionInput(ReviewGuard,RationaleInput):
    kind: Literal['approved','changes_requested']

class ResolutionInput(RationaleInput):
    expected_item_version: int = Field(ge=1)
    action: Literal['request_exception','request_dismissal','confirm','dismiss','grant_exception','reject_exception']
    source_version_ids: list[str] = Field(default_factory=list,max_length=100)

class ManualCheckInput(RationaleInput):
    expected_item_version: int = Field(ge=1)
    category: Literal['terminology','tone','messaging','facts_claims','visual','accessibility']
    outcome: Literal['complete','not_applicable']
    source_version_ids: list[str] = Field(default_factory=list,max_length=100)

class CommentInput(StrictInput):
    text: str = Field(min_length=1,max_length=4000)
    finding_id: str | None = Field(default=None,min_length=1,max_length=36)

    @field_validator('text')
    @classmethod
    def comment_nonempty(cls,value):
        if not value.strip():raise ValueError('A comment is required')
        return value.strip()

class CommentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    revision_id: str
    finding_id: str | None
    author_id: str
    text: str
    created_at: datetime

class ResolutionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    finding_id: str
    actor_id: str
    action: str
    rationale: str
    source_version_ids: list[str]
    created_at: datetime

class ManualCheckOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    run_id: str
    reviewer_id: str
    category: str
    outcome: str
    rationale: str
    source_version_ids: list[str]
    created_at: datetime

class DecisionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    revision_id: str
    run_id: str
    reviewer_id: str
    kind: str
    rationale: str
    source_epoch: int
    text_hash: str
    decided_at: datetime
    asset_sha256: str | None = None

class ReviewerOut(BaseModel):
    id: str
    user_id: str
    email: str

class ExportOut(BaseModel):
    revision_id: str
    content_id: str
    text: str
    text_hash: str
    channel: str
    audience: str
    purpose: str
    decision: DecisionOut
    evidence_record: dict
    exported_at: datetime
    image_sha256: str | None = None
    region_map: list[dict] | None = None
    source_document: dict | None = None

class ReviewRecordOut(BaseModel):
    run_id: str
    workflow_version: int
    stale: bool
    evidence: dict
    decisions: list[DecisionOut]

class ContentSummaryOut(BaseModel):
    id: str
    brand_id: str
    title: str
    creator_id: str
    reviewer_id: str | None
    current_revision: int
    workflow_version: int
    approval_stale: bool
    state: str
    created_at: datetime
    recheck_status: str | None = None

class ContentPageOut(BaseModel):
    items: list[ContentSummaryOut]
    total: int
    limit: int
    offset: int

class AmbiguityInput(RationaleInput):
    rule_id: str | None = Field(default=None,min_length=1,max_length=100)
    revision_id: str | None = Field(default=None,min_length=1,max_length=36)

class AmbiguityOut(BaseModel):
    id: str
    source_id: str
    actor_id: str
    rule_id: str | None
    revision_id: str | None
    rationale: str
    created_at: datetime

class RuleInsightOut(BaseModel):
    source_key: str
    rule_id: str
    category: str
    confirmed_items: int
    dismissed_items: int
    exception_items: int
    confirmed_per_reviewed_item: float | None

class InsightsOut(BaseModel):
    brand_id: str
    reviewed_items_denominator: int
    denominator_definition: str
    confirmed_total: int
    dismissed_total: int
    exception_total: int
    ambiguous_total: int
    ambiguity_definition: str
    rules: list[RuleInsightOut]

class ActivationOut(SourceOut):
    change_id: str
    impact_counts: dict

class ImpactEntryOut(BaseModel):
    item_id: str
    title: str
    state: str
    creator_id: str
    reviewer_id: str | None
    revision_id: str
    prior_run_id: str
    impact_level: Literal['confirmed','likely','possible']
    reasons: list[dict]
    local_delta: dict | None
    # hold: goes back to a reviewer; keep: keeps its approval unless the recheck finds a difference.
    routing: Literal['hold','keep'] = 'hold'

class ImpactPreviewOut(BaseModel):
    source_id: str
    brand_id: str
    expected_epoch: int
    retired_source_ids: list[str]
    diff: dict
    counts: dict
    entries: list[ImpactEntryOut]

class GuidelineChangeSummaryOut(BaseModel):
    id: str
    brand_id: str
    source_key: str
    from_source_id: str | None
    to_source_id: str
    title: str
    from_version: int | None
    to_version: int
    status: str
    impact_counts: dict
    resolved: int
    total: int
    created_by: str
    created_at: datetime
    closed_at: datetime | None

class RecheckAssignmentOut(BaseModel):
    id: str
    change_id: str
    item_id: str
    title: str
    item_state: str
    creator_id: str
    revision_id: str
    prior_run_id: str
    prior_decision_id: str | None
    state_before: str
    impact_level: str
    reasons: list[dict]
    recheck_run_id: str | None
    recheck_status: str | None
    findings_delta: dict | None
    reviewer_id: str | None
    status: str
    resolved_decision_id: str | None
    superseded_by: str | None
    # keep: possible-level campaign that keeps its approval unless the recheck finds a difference.
    routing: str = 'hold'
    outcome: str | None = None
    version: int
    created_at: datetime
    updated_at: datetime
    resolved_at: datetime | None

class GuidelineChangeOut(GuidelineChangeSummaryOut):
    diff: dict
    assignments: list[RecheckAssignmentOut]

class RecheckAssignInput(StrictInput):
    assignment_ids: list[str] = Field(min_length=1, max_length=200)
    reviewer_id: str = Field(min_length=1, max_length=36)
    expected_versions: dict[str, int]

class RecheckQueueOut(BaseModel):
    change_id: str
    queued: list[str]
