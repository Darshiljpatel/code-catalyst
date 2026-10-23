"""review_foundation

Revision ID: 0002_review_foundation
Revises: 0001_identity
Create Date: 2026-10-23 11:24:29.793060

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0002_review_foundation'
down_revision: Union[str, Sequence[str], None] = '0001_identity'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_unique_constraint('uq_membership_org_id', 'memberships', ['org_id', 'id'])
    op.create_table('audit_events',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('org_id', sa.String(length=36), nullable=False),
    sa.Column('actor_id', sa.String(length=36), nullable=False),
    sa.Column('action', sa.String(length=100), nullable=False),
    sa.Column('object_id', sa.String(length=36), nullable=False),
    sa.Column('details', sa.JSON(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['org_id', 'actor_id'], ['memberships.org_id', 'memberships.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_audit_events_org_id'), 'audit_events', ['org_id'], unique=False)
    op.create_table('content_items',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('org_id', sa.String(length=36), nullable=False),
    sa.Column('brand_id', sa.String(length=36), nullable=False),
    sa.Column('creator_id', sa.String(length=36), nullable=False),
    sa.Column('reviewer_id', sa.String(length=36), nullable=True),
    sa.Column('title', sa.String(length=200), nullable=False),
    sa.Column('current_revision', sa.Integer(), nullable=False),
    sa.Column('state', sa.String(length=30), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint('reviewer_id IS NULL OR reviewer_id != creator_id'),
    sa.ForeignKeyConstraint(['org_id', 'brand_id'], ['brands.org_id', 'brands.id'], ),
    sa.ForeignKeyConstraint(['org_id', 'creator_id'], ['memberships.org_id', 'memberships.id'], ),
    sa.ForeignKeyConstraint(['org_id', 'reviewer_id'], ['memberships.org_id', 'memberships.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('org_id', 'id')
    )
    op.create_index(op.f('ix_content_items_org_id'), 'content_items', ['org_id'], unique=False)
    op.create_table('source_versions',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('org_id', sa.String(length=36), nullable=False),
    sa.Column('brand_id', sa.String(length=36), nullable=False),
    sa.Column('source_key', sa.String(length=100), nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('owner_id', sa.String(length=36), nullable=False),
    sa.Column('title', sa.String(length=200), nullable=False),
    sa.Column('text', sa.Text(), nullable=False),
    sa.Column('text_hash', sa.String(length=64), nullable=False),
    sa.Column('rules', sa.JSON(), nullable=False),
    sa.Column('valid_from', sa.DateTime(timezone=True), nullable=False),
    sa.Column('valid_until', sa.DateTime(timezone=True), nullable=True),
    sa.Column('state', sa.String(length=20), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('activated_by', sa.String(length=36), nullable=True),
    sa.Column('activated_at', sa.DateTime(timezone=True), nullable=True),
    sa.CheckConstraint("state IN ('draft','active','retired')"),
    sa.CheckConstraint('valid_until IS NULL OR valid_until > valid_from'),
    sa.CheckConstraint('version > 0'),
    sa.ForeignKeyConstraint(['org_id', 'brand_id'], ['brands.org_id', 'brands.id'], ),
    sa.ForeignKeyConstraint(['org_id', 'owner_id'], ['memberships.org_id', 'memberships.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('org_id', 'brand_id', 'source_key', 'version'),
    sa.UniqueConstraint('org_id', 'id')
    )
    op.create_index(op.f('ix_source_versions_brand_id'), 'source_versions', ['brand_id'], unique=False)
    op.create_index(op.f('ix_source_versions_org_id'), 'source_versions', ['org_id'], unique=False)
    op.create_table('content_revisions',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('org_id', sa.String(length=36), nullable=False),
    sa.Column('item_id', sa.String(length=36), nullable=False),
    sa.Column('number', sa.Integer(), nullable=False),
    sa.Column('author_id', sa.String(length=36), nullable=False),
    sa.Column('text', sa.Text(), nullable=False),
    sa.Column('text_hash', sa.String(length=64), nullable=False),
    sa.Column('channel', sa.String(length=100), nullable=False),
    sa.Column('audience', sa.String(length=300), nullable=False),
    sa.Column('purpose', sa.String(length=500), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint('number > 0'),
    sa.ForeignKeyConstraint(['org_id', 'author_id'], ['memberships.org_id', 'memberships.id'], ),
    sa.ForeignKeyConstraint(['org_id', 'item_id'], ['content_items.org_id', 'content_items.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('org_id', 'id'),
    sa.UniqueConstraint('org_id', 'item_id', 'number')
    )
    op.create_index(op.f('ix_content_revisions_org_id'), 'content_revisions', ['org_id'], unique=False)
    op.create_table('review_runs',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('org_id', sa.String(length=36), nullable=False),
    sa.Column('revision_id', sa.String(length=36), nullable=False),
    sa.Column('idempotency_key', sa.String(length=100), nullable=False),
    sa.Column('source_epoch', sa.Integer(), nullable=False),
    sa.Column('source_snapshot', sa.JSON(), nullable=False),
    sa.Column('checks', sa.JSON(), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("status IN ('queued','running','complete','incomplete','failed')"),
    sa.ForeignKeyConstraint(['org_id', 'revision_id'], ['content_revisions.org_id', 'content_revisions.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('org_id', 'id'),
    sa.UniqueConstraint('org_id', 'revision_id', 'idempotency_key')
    )
    op.create_index(op.f('ix_review_runs_org_id'), 'review_runs', ['org_id'], unique=False)
    op.create_index(op.f('ix_review_runs_revision_id'), 'review_runs', ['revision_id'], unique=False)
    op.create_table('jobs',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('org_id', sa.String(length=36), nullable=False),
    sa.Column('run_id', sa.String(length=36), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('attempts', sa.Integer(), nullable=False),
    sa.Column('lease_token', sa.String(length=64), nullable=True),
    sa.Column('lease_expires_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('available_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("status IN ('queued','running','complete','failed')"),
    sa.CheckConstraint('attempts >= 0 AND attempts <= 3'),
    sa.ForeignKeyConstraint(['org_id', 'run_id'], ['review_runs.org_id', 'review_runs.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('run_id')
    )
    op.create_index(op.f('ix_jobs_available_at'), 'jobs', ['available_at'], unique=False)
    op.create_index(op.f('ix_jobs_status'), 'jobs', ['status'], unique=False)
    op.create_table('run_sources',
    sa.Column('run_id', sa.String(length=36), nullable=False),
    sa.Column('source_id', sa.String(length=36), nullable=False),
    sa.Column('org_id', sa.String(length=36), nullable=False),
    sa.ForeignKeyConstraint(['org_id', 'run_id'], ['review_runs.org_id', 'review_runs.id'], ),
    sa.ForeignKeyConstraint(['org_id', 'source_id'], ['source_versions.org_id', 'source_versions.id'], ),
    sa.PrimaryKeyConstraint('run_id', 'source_id')
    )
    # Immutable payloads preserve the evidence an earlier review saw.
    op.execute("""
        CREATE FUNCTION brandguard_immutable_payload() RETURNS trigger AS $$
        BEGIN
            IF (to_jsonb(NEW) - COALESCE(TG_ARGV::text[], ARRAY[]::text[])) IS DISTINCT FROM
               (to_jsonb(OLD) - COALESCE(TG_ARGV::text[], ARRAY[]::text[])) THEN
                RAISE EXCEPTION 'immutable evidence payload' USING ERRCODE = '23514';
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)
    for table, allowed in {
        'source_versions': ['state', 'activated_by', 'activated_at'],
        'content_revisions': [],
        'review_runs': ['status', 'checks'],
        'run_sources': [],
        'audit_events': [],
    }.items():
        args = ','.join("'" + name + "'" for name in allowed)
        op.execute(f'CREATE TRIGGER immutable_payload BEFORE UPDATE ON {table} '
                   f'FOR EACH ROW EXECUTE FUNCTION brandguard_immutable_payload({args})')


def downgrade() -> None:
    """Downgrade schema."""
    # ### commands auto generated by Alembic - please adjust! ###
    op.drop_table('run_sources')
    op.drop_index(op.f('ix_jobs_status'), table_name='jobs')
    op.drop_index(op.f('ix_jobs_available_at'), table_name='jobs')
    op.drop_table('jobs')
    op.drop_index(op.f('ix_review_runs_revision_id'), table_name='review_runs')
    op.drop_index(op.f('ix_review_runs_org_id'), table_name='review_runs')
    op.drop_table('review_runs')
    op.drop_index(op.f('ix_content_revisions_org_id'), table_name='content_revisions')
    op.drop_table('content_revisions')
    op.drop_index(op.f('ix_source_versions_org_id'), table_name='source_versions')
    op.drop_index(op.f('ix_source_versions_brand_id'), table_name='source_versions')
    op.drop_table('source_versions')
    op.drop_index(op.f('ix_content_items_org_id'), table_name='content_items')
    op.drop_table('content_items')
    op.drop_index(op.f('ix_audit_events_org_id'), table_name='audit_events')
    op.drop_table('audit_events')
    op.drop_constraint('uq_membership_org_id', 'memberships', type_='unique')
    op.execute('DROP FUNCTION brandguard_immutable_payload()')
