"""Identity, tenant and immutable review-domain records."""
import uuid
from datetime import datetime
from sqlalchemy import String, ForeignKey, UniqueConstraint, CheckConstraint, DateTime, Integer
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

class Base(DeclarativeBase):
    pass

def uid():
    return str(uuid.uuid4())

class Organisation(Base):
    __tablename__ = 'organisations'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(200))
    # Private demo sandboxes: flagged, expiring and with their own small AI budget.
    is_demo: Mapped[bool] = mapped_column(default=False, server_default='false')
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_ip_hash: Mapped[str | None] = mapped_column(String(64), index=True)
    daily_run_limit: Mapped[int | None] = mapped_column(Integer)
    # Campaigns with no activity for this many days are purged hourly; None keeps them. Set by an admin.
    retention_days: Mapped[int | None] = mapped_column(Integer)
    retention_set_by: Mapped[str | None] = mapped_column(String(36))

class User(Base):
    __tablename__ = 'users'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    email: Mapped[str] = mapped_column(String(254), unique=True)
    password_hash: Mapped[str] = mapped_column(String(512))

class Membership(Base):
    __tablename__ = 'memberships'
    __table_args__ = (UniqueConstraint('user_id', 'org_id'), CheckConstraint("role IN ('creator','manager','reviewer','admin')"))
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'))
    org_id: Mapped[str] = mapped_column(ForeignKey('organisations.id', ondelete='CASCADE'), index=True)
    role: Mapped[str] = mapped_column(String(20))
    # Display name in demo workspaces, e.g. "Brand lead" for the second manager.
    label: Mapped[str | None] = mapped_column(String(60))

class Brand(Base):
    __tablename__ = 'brands'
    __table_args__ = (UniqueConstraint('org_id', 'id'),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey('organisations.id', ondelete='CASCADE'), index=True)
    name: Mapped[str] = mapped_column(String(200))
    source_epoch: Mapped[int] = mapped_column(Integer, default=0)

class SessionRecord(Base):
    __tablename__ = 'sessions'
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    membership_id: Mapped[str] = mapped_column(ForeignKey('memberships.id', ondelete='CASCADE'))
    csrf_hash: Mapped[str] = mapped_column(String(64))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)

class LoginAttempt(Base):
    __tablename__ = 'login_attempts'
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    count: Mapped[int] = mapped_column(Integer, default=0)
    reset_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

# Composite foreign keys make tenant boundaries a database invariant as well as an API policy.
from sqlalchemy import ForeignKeyConstraint, Text, JSON

Membership.__table__.append_constraint(UniqueConstraint('org_id', 'id', name='uq_membership_org_id'))

class SourceVersion(Base):
    __tablename__ = 'source_versions'
    __table_args__ = (
        UniqueConstraint('org_id', 'id'),
        UniqueConstraint('org_id', 'brand_id', 'source_key', 'version'),
        ForeignKeyConstraint(['org_id', 'brand_id'], ['brands.org_id', 'brands.id']),
        ForeignKeyConstraint(['org_id', 'owner_id'], ['memberships.org_id', 'memberships.id']),
        CheckConstraint("state IN ('draft','active','retired')"),
        CheckConstraint('version > 0'),
        CheckConstraint('valid_until IS NULL OR valid_until > valid_from'),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(String(36), index=True)
    brand_id: Mapped[str] = mapped_column(String(36), index=True)
    source_key: Mapped[str] = mapped_column(String(100))
    version: Mapped[int] = mapped_column(Integer)
    owner_id: Mapped[str] = mapped_column(String(36))
    title: Mapped[str] = mapped_column(String(200))
    text: Mapped[str] = mapped_column(Text)
    text_hash: Mapped[str] = mapped_column(String(64))
    rules: Mapped[list] = mapped_column(JSON)
    valid_from: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    valid_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    state: Mapped[str] = mapped_column(String(20), default='draft')
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    activated_by: Mapped[str | None] = mapped_column(String(36))
    activated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

class ContentItem(Base):
    __tablename__ = 'content_items'
    __table_args__ = (
        UniqueConstraint('org_id', 'id'),
        ForeignKeyConstraint(['org_id', 'brand_id'], ['brands.org_id', 'brands.id']),
        ForeignKeyConstraint(['org_id', 'creator_id'], ['memberships.org_id', 'memberships.id']),
        ForeignKeyConstraint(['org_id', 'reviewer_id'], ['memberships.org_id', 'memberships.id']),
        CheckConstraint('reviewer_id IS NULL OR reviewer_id != creator_id'),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(String(36), index=True)
    brand_id: Mapped[str] = mapped_column(String(36))
    creator_id: Mapped[str] = mapped_column(String(36))
    reviewer_id: Mapped[str | None] = mapped_column(String(36))
    title: Mapped[str] = mapped_column(String(200))
    current_revision: Mapped[int] = mapped_column(Integer, default=1)
    workflow_version: Mapped[int] = mapped_column(Integer, default=1, server_default='1')
    state: Mapped[str] = mapped_column(String(30), default='draft')
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

class ContentRevision(Base):
    __tablename__ = 'content_revisions'
    __table_args__ = (
        UniqueConstraint('org_id', 'id'),
        UniqueConstraint('org_id', 'item_id', 'number'),
        ForeignKeyConstraint(['org_id', 'item_id'], ['content_items.org_id', 'content_items.id']),
        ForeignKeyConstraint(['org_id', 'author_id'], ['memberships.org_id', 'memberships.id']),
        CheckConstraint('number > 0'),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(String(36), index=True)
    item_id: Mapped[str] = mapped_column(String(36))
    number: Mapped[int] = mapped_column(Integer)
    author_id: Mapped[str] = mapped_column(String(36))
    text: Mapped[str] = mapped_column(Text)
    text_hash: Mapped[str] = mapped_column(String(64))
    channel: Mapped[str] = mapped_column(String(100))
    audience: Mapped[str] = mapped_column(String(300))
    purpose: Mapped[str] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # Image campaigns: the confirmed image and the map from character ranges to image regions.
    asset_id: Mapped[str | None] = mapped_column(String(36))
    asset_sha256: Mapped[str | None] = mapped_column(String(64))
    region_map: Mapped[list | None] = mapped_column(JSON)
    # Imported PDF/DOCX drafts: file name, type, original hash, page/paragraph blocks and whether the text was edited.
    source_document: Mapped[dict | None] = mapped_column(JSON)

class ReviewRun(Base):
    __tablename__ = 'review_runs'
    __table_args__ = (
        UniqueConstraint('org_id', 'id'),
        UniqueConstraint('org_id', 'revision_id', 'idempotency_key'),
        ForeignKeyConstraint(['org_id', 'revision_id'], ['content_revisions.org_id', 'content_revisions.id']),
        CheckConstraint("status IN ('queued','running','complete','incomplete','failed')"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(String(36), index=True)
    revision_id: Mapped[str] = mapped_column(String(36), index=True)
    idempotency_key: Mapped[str] = mapped_column(String(100))
    source_epoch: Mapped[int] = mapped_column(Integer)
    source_snapshot: Mapped[list] = mapped_column(JSON)
    checks: Mapped[list] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(20), default='queued')
    processing_snapshot: Mapped[dict] = mapped_column(JSON, default=dict, server_default='{}')
    engine_metadata: Mapped[dict] = mapped_column(JSON, default=dict, server_default='{}')
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # creator, guideline_change (Improvement 1 recheck) or regression.
    trigger: Mapped[str] = mapped_column(String(30), default='creator', server_default='creator')
    initiated_by: Mapped[str | None] = mapped_column(String(36))

class RunSource(Base):
    __tablename__ = 'run_sources'
    __table_args__ = (
        ForeignKeyConstraint(['org_id', 'run_id'], ['review_runs.org_id', 'review_runs.id']),
        ForeignKeyConstraint(['org_id', 'source_id'], ['source_versions.org_id', 'source_versions.id']),
    )
    run_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    source_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    org_id: Mapped[str] = mapped_column(String(36))

class Job(Base):
    __tablename__ = 'jobs'
    __table_args__ = (
        UniqueConstraint('run_id'),
        ForeignKeyConstraint(['org_id', 'run_id'], ['review_runs.org_id', 'review_runs.id']),
        CheckConstraint("status IN ('queued','running','complete','failed')"),
        CheckConstraint('attempts >= 0 AND attempts <= 3'),
        CheckConstraint("kind IN ('review','ocr','regression')", name='ck_job_kind'),
        CheckConstraint("(kind = 'review') = (run_id IS NOT NULL)", name='ck_job_target'),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(String(36))
    # One queue serves all background work: review runs and OCR of uploaded images.
    kind: Mapped[str] = mapped_column(String(20), default='review', server_default='review')
    run_id: Mapped[str | None] = mapped_column(String(36))
    ocr_result_id: Mapped[str | None] = mapped_column(String(36), unique=True)
    status: Mapped[str] = mapped_column(String(20), default='queued', index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    lease_token: Mapped[str | None] = mapped_column(String(64))
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    available_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

class AuditEvent(Base):
    __tablename__ = 'audit_events'
    __table_args__ = (ForeignKeyConstraint(['org_id', 'actor_id'], ['memberships.org_id', 'memberships.id']),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(String(36), index=True)
    actor_id: Mapped[str] = mapped_column(String(36))
    action: Mapped[str] = mapped_column(String(100))
    object_id: Mapped[str] = mapped_column(String(36))
    details: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

class ProcessingPolicy(Base):
    __tablename__ = 'processing_policies'
    __table_args__ = (
        ForeignKeyConstraint(['org_id', 'approved_by'], ['memberships.org_id', 'memberships.id']),
        CheckConstraint('version > 0'),
    )
    org_id: Mapped[str] = mapped_column(ForeignKey('organisations.id'), primary_key=True)
    version: Mapped[int] = mapped_column(Integer)
    enabled: Mapped[bool]
    model: Mapped[str] = mapped_column(String(200))
    notice: Mapped[str] = mapped_column(Text)
    approved_by: Mapped[str] = mapped_column(String(36))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

ReviewRun.__table__.append_constraint(UniqueConstraint('org_id', 'id', 'revision_id', name='uq_run_revision'))

class Finding(Base):
    __tablename__ = 'findings'
    __table_args__ = (
        ForeignKeyConstraint(['org_id', 'run_id', 'revision_id'], ['review_runs.org_id', 'review_runs.id', 'review_runs.revision_id']),
        ForeignKeyConstraint(['run_id', 'source_version_id'], ['run_sources.run_id', 'run_sources.source_id']),
        CheckConstraint("origin IN ('model','deterministic')"),
        CheckConstraint("severity IN ('blocker','warning','advisory')"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(String(36), index=True)
    run_id: Mapped[str] = mapped_column(String(36), index=True)
    revision_id: Mapped[str] = mapped_column(String(36))
    category: Mapped[str] = mapped_column(String(30))
    severity: Mapped[str] = mapped_column(String(20))
    evidence_status: Mapped[str] = mapped_column(String(30))
    origin: Mapped[str] = mapped_column(String(20))
    source_version_id: Mapped[str] = mapped_column(String(36))
    rule_id: Mapped[str] = mapped_column(String(100))
    evidence_quote: Mapped[str] = mapped_column(Text)
    location: Mapped[dict] = mapped_column(JSON)
    rationale: Mapped[str] = mapped_column(Text)
    suggested_edit: Mapped[str | None] = mapped_column(Text)
    resolution: Mapped[str] = mapped_column(String(30), default='unresolved')

Finding.__table__.append_constraint(UniqueConstraint('org_id','id',name='uq_finding_org_id'))
Finding.__table__.append_constraint(UniqueConstraint('org_id','id','revision_id',name='uq_finding_revision'))

class Comment(Base):
    __tablename__ = 'comments'
    __table_args__ = (
        ForeignKeyConstraint(['org_id','revision_id'],['content_revisions.org_id','content_revisions.id']),
        ForeignKeyConstraint(['org_id','author_id'],['memberships.org_id','memberships.id']),
        ForeignKeyConstraint(['org_id','finding_id','revision_id'],['findings.org_id','findings.id','findings.revision_id']),
    )
    id: Mapped[str] = mapped_column(String(36),primary_key=True,default=uid)
    org_id: Mapped[str] = mapped_column(String(36),index=True)
    revision_id: Mapped[str] = mapped_column(String(36))
    author_id: Mapped[str] = mapped_column(String(36))
    finding_id: Mapped[str | None] = mapped_column(String(36))
    text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

class FindingResolution(Base):
    __tablename__ = 'finding_resolutions'
    __table_args__ = (
        ForeignKeyConstraint(['org_id','actor_id'],['memberships.org_id','memberships.id']),
        ForeignKeyConstraint(['org_id','finding_id'],['findings.org_id','findings.id']),
        CheckConstraint("action IN ('request_exception','request_dismissal','confirm','dismiss','grant_exception','reject_exception')"),
    )
    id: Mapped[str] = mapped_column(String(36),primary_key=True,default=uid)
    org_id: Mapped[str] = mapped_column(String(36),index=True)
    finding_id: Mapped[str] = mapped_column(String(36),index=True)
    actor_id: Mapped[str] = mapped_column(String(36))
    action: Mapped[str] = mapped_column(String(30))
    rationale: Mapped[str] = mapped_column(Text)
    source_version_ids: Mapped[list] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

class ManualCheck(Base):
    __tablename__ = 'manual_checks'
    __table_args__ = (
        ForeignKeyConstraint(['org_id','run_id'],['review_runs.org_id','review_runs.id']),
        ForeignKeyConstraint(['org_id','reviewer_id'],['memberships.org_id','memberships.id']),
        UniqueConstraint('run_id','category','reviewer_id'),
        CheckConstraint("outcome IN ('complete','not_applicable')"),
    )
    id: Mapped[str] = mapped_column(String(36),primary_key=True,default=uid)
    org_id: Mapped[str] = mapped_column(String(36),index=True)
    run_id: Mapped[str] = mapped_column(String(36))
    reviewer_id: Mapped[str] = mapped_column(String(36))
    category: Mapped[str] = mapped_column(String(30))
    outcome: Mapped[str] = mapped_column(String(30))
    rationale: Mapped[str] = mapped_column(Text)
    source_version_ids: Mapped[list] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

class Decision(Base):
    __tablename__ = 'decisions'
    __table_args__ = (
        ForeignKeyConstraint(['org_id','run_id','revision_id'],['review_runs.org_id','review_runs.id','review_runs.revision_id']),
        ForeignKeyConstraint(['org_id','reviewer_id'],['memberships.org_id','memberships.id']),
        UniqueConstraint('run_id'),
        CheckConstraint("kind IN ('approved','changes_requested')"),
    )
    id: Mapped[str] = mapped_column(String(36),primary_key=True,default=uid)
    org_id: Mapped[str] = mapped_column(String(36),index=True)
    revision_id: Mapped[str] = mapped_column(String(36))
    run_id: Mapped[str] = mapped_column(String(36))
    reviewer_id: Mapped[str] = mapped_column(String(36))
    kind: Mapped[str] = mapped_column(String(30))
    rationale: Mapped[str] = mapped_column(Text)
    source_epoch: Mapped[int] = mapped_column(Integer)
    text_hash: Mapped[str] = mapped_column(String(64))
    evidence_record: Mapped[dict] = mapped_column(JSON)
    decided_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    asset_sha256: Mapped[str | None] = mapped_column(String(64))

class WorkerHeartbeat(Base):
    """One row per worker process; readiness and the offline banner read the freshest row."""
    __tablename__ = 'worker_heartbeats'
    worker_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    version: Mapped[str] = mapped_column(String(64))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)

class GuidelineChange(Base):
    """One activation of a guideline version, with its rule diff and impact counts."""
    __tablename__ = 'guideline_changes'
    __table_args__ = (
        UniqueConstraint('org_id', 'id'),
        ForeignKeyConstraint(['org_id', 'brand_id'], ['brands.org_id', 'brands.id']),
        ForeignKeyConstraint(['org_id', 'to_source_id'], ['source_versions.org_id', 'source_versions.id']),
        ForeignKeyConstraint(['org_id', 'created_by'], ['memberships.org_id', 'memberships.id']),
        CheckConstraint("status IN ('open','closed')"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(String(36), index=True)
    brand_id: Mapped[str] = mapped_column(String(36), index=True)
    source_key: Mapped[str] = mapped_column(String(100))
    from_source_id: Mapped[str | None] = mapped_column(String(36))
    to_source_id: Mapped[str] = mapped_column(String(36))
    retired_source_ids: Mapped[list] = mapped_column(JSON)
    diff: Mapped[dict] = mapped_column(JSON)
    impact_counts: Mapped[dict] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(20), default='open')
    created_by: Mapped[str] = mapped_column(String(36))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

class RecheckAssignment(Base):
    """A campaign that relied on a changed guideline; open until re-approved or superseded."""
    __tablename__ = 'recheck_assignments'
    __table_args__ = (
        UniqueConstraint('change_id', 'item_id'),
        ForeignKeyConstraint(['org_id', 'change_id'], ['guideline_changes.org_id', 'guideline_changes.id']),
        ForeignKeyConstraint(['org_id', 'item_id'], ['content_items.org_id', 'content_items.id']),
        ForeignKeyConstraint(['org_id', 'reviewer_id'], ['memberships.org_id', 'memberships.id']),
        CheckConstraint("impact_level IN ('confirmed','likely','possible')"),
        CheckConstraint("status IN ('open','recheck_queued','awaiting_creator','awaiting_reviewer','resolved','superseded')"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(String(36), index=True)
    change_id: Mapped[str] = mapped_column(String(36), index=True)
    item_id: Mapped[str] = mapped_column(String(36), index=True)
    revision_id: Mapped[str] = mapped_column(String(36))
    prior_run_id: Mapped[str] = mapped_column(String(36))
    prior_decision_id: Mapped[str | None] = mapped_column(String(36))
    state_before: Mapped[str] = mapped_column(String(30))
    impact_level: Mapped[str] = mapped_column(String(20))
    reasons: Mapped[list] = mapped_column(JSON)
    recheck_run_id: Mapped[str | None] = mapped_column(String(36), index=True)
    findings_delta: Mapped[dict | None] = mapped_column(JSON)
    reviewer_id: Mapped[str | None] = mapped_column(String(36))
    status: Mapped[str] = mapped_column(String(30), default='open')
    resolved_decision_id: Mapped[str | None] = mapped_column(String(36))
    superseded_by: Mapped[str | None] = mapped_column(String(36))
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

class GuidelineRequest(Base):
    """A tracked guideline-improvement request (Improvement 3)."""
    __tablename__ = 'guideline_requests'
    __table_args__ = (
        UniqueConstraint('org_id', 'id'),
        ForeignKeyConstraint(['org_id', 'brand_id'], ['brands.org_id', 'brands.id']),
        ForeignKeyConstraint(['org_id', 'base_source_id'], ['source_versions.org_id', 'source_versions.id']),
        ForeignKeyConstraint(['org_id', 'created_by'], ['memberships.org_id', 'memberships.id']),
        ForeignKeyConstraint(['org_id', 'assignee_id'], ['memberships.org_id', 'memberships.id']),
        CheckConstraint("status IN ('open','in_review','changes_requested','approved','activated','withdrawn')"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(String(36), index=True)
    brand_id: Mapped[str] = mapped_column(String(36), index=True)
    source_key: Mapped[str] = mapped_column(String(100))
    base_source_id: Mapped[str] = mapped_column(String(36))
    rule_id: Mapped[str | None] = mapped_column(String(100))
    title: Mapped[str] = mapped_column(String(200))
    problem: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(30), default='open')
    signals: Mapped[dict] = mapped_column(JSON)
    draft_source_id: Mapped[str | None] = mapped_column(String(36))
    draft_hash: Mapped[str | None] = mapped_column(String(64))
    change_id: Mapped[str | None] = mapped_column(String(36))
    created_by: Mapped[str] = mapped_column(String(36))
    assignee_id: Mapped[str | None] = mapped_column(String(36))
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

class RequestExample(Base):
    __tablename__ = 'request_examples'
    __table_args__ = (
        ForeignKeyConstraint(['org_id', 'request_id'], ['guideline_requests.org_id', 'guideline_requests.id']),
        CheckConstraint("kind IN ('dispute','ambiguity','manual')"),
        CheckConstraint("expected IN ('flag','no_flag','unsure')"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(String(36), index=True)
    request_id: Mapped[str] = mapped_column(String(36), index=True)
    item_id: Mapped[str | None] = mapped_column(String(36))
    revision_id: Mapped[str | None] = mapped_column(String(36))
    finding_id: Mapped[str | None] = mapped_column(String(36))
    kind: Mapped[str] = mapped_column(String(20))
    excerpt: Mapped[str] = mapped_column(Text)
    text: Mapped[str] = mapped_column(Text)
    context: Mapped[dict] = mapped_column(JSON)
    dispute: Mapped[dict] = mapped_column(JSON)
    expected: Mapped[str] = mapped_column(String(20), default='unsure')
    labelled_by: Mapped[str | None] = mapped_column(String(36))
    external_ok: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # Set when retention purged the campaign this example was copied from; its text copies are blanked.
    redacted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

class ExampleSet(Base):
    """Brand-scoped saved example campaigns used by comparison runs."""
    __tablename__ = 'example_sets'
    __table_args__ = (
        UniqueConstraint('org_id', 'id'),
        ForeignKeyConstraint(['org_id', 'brand_id'], ['brands.org_id', 'brands.id']),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(String(36), index=True)
    brand_id: Mapped[str] = mapped_column(String(36), index=True)
    name: Mapped[str] = mapped_column(String(200))
    created_by: Mapped[str] = mapped_column(String(36))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

class ExampleCase(Base):
    __tablename__ = 'example_cases'
    __table_args__ = (
        UniqueConstraint('org_id', 'id'),
        ForeignKeyConstraint(['org_id', 'set_id'], ['example_sets.org_id', 'example_sets.id']),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(String(36), index=True)
    set_id: Mapped[str] = mapped_column(String(36), index=True)
    label: Mapped[str] = mapped_column(String(200))
    text: Mapped[str] = mapped_column(Text)
    context: Mapped[dict] = mapped_column(JSON)
    # [{source_key, rule_id, expected: flag|no_flag}]
    expectations: Mapped[list] = mapped_column(JSON)
    origin_revision_id: Mapped[str | None] = mapped_column(String(36))
    # Only team-written cases or copies of consented revisions may ever reach an AI provider.
    external_ok: Mapped[bool] = mapped_column(default=False)
    author_id: Mapped[str] = mapped_column(String(36))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

class ComparisonRun(Base):
    __tablename__ = 'comparison_runs'
    __table_args__ = (
        UniqueConstraint('org_id', 'id'),
        ForeignKeyConstraint(['org_id', 'request_id'], ['guideline_requests.org_id', 'guideline_requests.id']),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(String(36), index=True)
    request_id: Mapped[str] = mapped_column(String(36), index=True)
    baseline_source_ids: Mapped[list] = mapped_column(JSON)
    proposed_source_id: Mapped[str] = mapped_column(String(36))
    proposed_hash: Mapped[str] = mapped_column(String(64))
    example_set_id: Mapped[str] = mapped_column(String(36))
    status: Mapped[str] = mapped_column(String(20))
    summary: Mapped[dict] = mapped_column(JSON)
    created_by: Mapped[str] = mapped_column(String(36))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

class ComparisonResult(Base):
    __tablename__ = 'comparison_results'
    __table_args__ = (
        ForeignKeyConstraint(['org_id', 'run_id'], ['comparison_runs.org_id', 'comparison_runs.id']),
        CheckConstraint("side IN ('live','proposed')"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(String(36), index=True)
    run_id: Mapped[str] = mapped_column(String(36), index=True)
    case_id: Mapped[str] = mapped_column(String(36))
    side: Mapped[str] = mapped_column(String(20))
    attempt: Mapped[int] = mapped_column(Integer, default=1)
    findings: Mapped[list] = mapped_column(JSON)
    checks: Mapped[list] = mapped_column(JSON)

class RequestReview(Base):
    __tablename__ = 'request_reviews'
    __table_args__ = (
        ForeignKeyConstraint(['org_id', 'request_id'], ['guideline_requests.org_id', 'guideline_requests.id']),
        ForeignKeyConstraint(['org_id', 'reviewer_id'], ['memberships.org_id', 'memberships.id']),
        CheckConstraint("decision IN ('approved','changes_requested','rejected')"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(String(36), index=True)
    request_id: Mapped[str] = mapped_column(String(36), index=True)
    reviewer_id: Mapped[str] = mapped_column(String(36))
    decision: Mapped[str] = mapped_column(String(30))
    rationale: Mapped[str] = mapped_column(Text)
    draft_hash: Mapped[str] = mapped_column(String(64))
    comparison_run_id: Mapped[str | None] = mapped_column(String(36))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

from sqlalchemy import LargeBinary

class Asset(Base):
    """An uploaded campaign image, stored in Postgres (capped at 8 MB) with its hashes."""
    __tablename__ = 'assets'
    __table_args__ = (
        UniqueConstraint('org_id', 'id'),
        ForeignKeyConstraint(['org_id', 'item_id'], ['content_items.org_id', 'content_items.id']),
        ForeignKeyConstraint(['org_id', 'created_by'], ['memberships.org_id', 'memberships.id']),
        CheckConstraint("mime IN ('image/png','image/jpeg')"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(String(36), index=True)
    item_id: Mapped[str] = mapped_column(String(36), index=True)
    kind: Mapped[str] = mapped_column(String(20), default='image')
    mime: Mapped[str] = mapped_column(String(30))
    bytes: Mapped[bytes] = mapped_column(LargeBinary)
    sha256: Mapped[str] = mapped_column(String(64))
    original_sha256: Mapped[str] = mapped_column(String(64))
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    # Channel, audience and purpose given at upload, reused when the text is confirmed.
    intake: Mapped[dict] = mapped_column(JSON)
    created_by: Mapped[str] = mapped_column(String(36))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

class OcrResult(Base):
    __tablename__ = 'ocr_results'
    __table_args__ = (
        ForeignKeyConstraint(['org_id', 'asset_id'], ['assets.org_id', 'assets.id']),
        CheckConstraint("status IN ('queued','running','complete','failed')"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(String(36), index=True)
    asset_id: Mapped[str] = mapped_column(String(36), index=True)
    engine: Mapped[str] = mapped_column(String(40))
    engine_version: Mapped[str] = mapped_column(String(80))
    params: Mapped[dict] = mapped_column(JSON)
    words: Mapped[list] = mapped_column(JSON)
    lines: Mapped[list] = mapped_column(JSON)
    mean_confidence: Mapped[float | None]
    status: Mapped[str] = mapped_column(String(20))
    error_code: Mapped[str | None] = mapped_column(String(60))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

class DocumentImport(Base):
    """Text extracted from an uploaded PDF or DOCX draft. Only the hash and text are kept, not the file."""
    __tablename__ = 'document_imports'
    __table_args__ = (
        UniqueConstraint('org_id', 'id'),
        ForeignKeyConstraint(['org_id', 'created_by'], ['memberships.org_id', 'memberships.id']),
        CheckConstraint("media_type IN ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document')"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(String(36), index=True)
    created_by: Mapped[str] = mapped_column(String(36))
    filename: Mapped[str] = mapped_column(String(200))
    media_type: Mapped[str] = mapped_column(String(100))
    size_bytes: Mapped[int] = mapped_column(Integer)
    original_sha256: Mapped[str] = mapped_column(String(64))
    text: Mapped[str] = mapped_column(Text)
    text_hash: Mapped[str] = mapped_column(String(64))
    pages: Mapped[int | None] = mapped_column(Integer)
    # Page and paragraph provenance: [{page, paragraph, start, end}] over `text`.
    blocks: Mapped[list] = mapped_column(JSON)
    warnings: Mapped[list] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
