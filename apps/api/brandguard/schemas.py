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
    brand_id: str = Field(min_length=1, max_length=36)
    title: str = Field(min_length=1, max_length=200)
    reviewer_id: str | None = Field(default=None, min_length=1, max_length=36)

class NewRevisionInput(RevisionInput):
    parent_revision_id: str = Field(min_length=1, max_length=36)

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

class ContentOut(BaseModel):
    id: str
    brand_id: str
    title: str
    creator_id: str
    reviewer_id: str | None
    current_revision: int
    state: str
    revisions: list[RevisionOut]

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
