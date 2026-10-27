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
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(String(36))
    run_id: Mapped[str] = mapped_column(String(36))
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

class WorkerHeartbeat(Base):
    """One row per worker process; readiness and the offline banner read the freshest row."""
    __tablename__ = 'worker_heartbeats'
    worker_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    version: Mapped[str] = mapped_column(String(64))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
