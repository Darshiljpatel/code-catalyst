"""guideline changes

Revision ID: 0006_guideline_changes
Revises: 0005_worker_heartbeat
Create Date: 2026-10-28 00:22:36.666661

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0006_guideline_changes'
down_revision: Union[str, Sequence[str], None] = '0005_worker_heartbeat'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('guideline_changes',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('org_id', sa.String(length=36), nullable=False),
    sa.Column('brand_id', sa.String(length=36), nullable=False),
    sa.Column('source_key', sa.String(length=100), nullable=False),
    sa.Column('from_source_id', sa.String(length=36), nullable=True),
    sa.Column('to_source_id', sa.String(length=36), nullable=False),
    sa.Column('retired_source_ids', sa.JSON(), nullable=False),
    sa.Column('diff', sa.JSON(), nullable=False),
    sa.Column('impact_counts', sa.JSON(), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('created_by', sa.String(length=36), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('closed_at', sa.DateTime(timezone=True), nullable=True),
    sa.CheckConstraint("status IN ('open','closed')"),
    sa.ForeignKeyConstraint(['org_id', 'brand_id'], ['brands.org_id', 'brands.id'], ),
    sa.ForeignKeyConstraint(['org_id', 'created_by'], ['memberships.org_id', 'memberships.id'], ),
    sa.ForeignKeyConstraint(['org_id', 'to_source_id'], ['source_versions.org_id', 'source_versions.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('org_id', 'id')
    )
    op.create_index(op.f('ix_guideline_changes_brand_id'), 'guideline_changes', ['brand_id'], unique=False)
    op.create_index(op.f('ix_guideline_changes_org_id'), 'guideline_changes', ['org_id'], unique=False)
    op.create_table('recheck_assignments',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('org_id', sa.String(length=36), nullable=False),
    sa.Column('change_id', sa.String(length=36), nullable=False),
    sa.Column('item_id', sa.String(length=36), nullable=False),
    sa.Column('revision_id', sa.String(length=36), nullable=False),
    sa.Column('prior_run_id', sa.String(length=36), nullable=False),
    sa.Column('prior_decision_id', sa.String(length=36), nullable=True),
    sa.Column('state_before', sa.String(length=30), nullable=False),
    sa.Column('impact_level', sa.String(length=20), nullable=False),
    sa.Column('reasons', sa.JSON(), nullable=False),
    sa.Column('recheck_run_id', sa.String(length=36), nullable=True),
    sa.Column('findings_delta', sa.JSON(), nullable=True),
    sa.Column('reviewer_id', sa.String(length=36), nullable=True),
    sa.Column('status', sa.String(length=30), nullable=False),
    sa.Column('resolved_decision_id', sa.String(length=36), nullable=True),
    sa.Column('superseded_by', sa.String(length=36), nullable=True),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
    sa.CheckConstraint("impact_level IN ('confirmed','likely','possible')"),
    sa.CheckConstraint("status IN ('open','recheck_queued','awaiting_creator','awaiting_reviewer','resolved','superseded')"),
    sa.ForeignKeyConstraint(['org_id', 'change_id'], ['guideline_changes.org_id', 'guideline_changes.id'], ),
    sa.ForeignKeyConstraint(['org_id', 'item_id'], ['content_items.org_id', 'content_items.id'], ),
    sa.ForeignKeyConstraint(['org_id', 'reviewer_id'], ['memberships.org_id', 'memberships.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('change_id', 'item_id')
    )
    op.create_index(op.f('ix_recheck_assignments_change_id'), 'recheck_assignments', ['change_id'], unique=False)
    op.create_index(op.f('ix_recheck_assignments_item_id'), 'recheck_assignments', ['item_id'], unique=False)
    op.create_index(op.f('ix_recheck_assignments_org_id'), 'recheck_assignments', ['org_id'], unique=False)
    op.create_index(op.f('ix_recheck_assignments_recheck_run_id'), 'recheck_assignments', ['recheck_run_id'], unique=False)
    op.add_column('review_runs', sa.Column('trigger', sa.String(length=30), server_default='creator', nullable=False))
    op.add_column('review_runs', sa.Column('initiated_by', sa.String(length=36), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('review_runs', 'initiated_by')
    op.drop_column('review_runs', 'trigger')
    op.drop_index(op.f('ix_recheck_assignments_recheck_run_id'), table_name='recheck_assignments')
    op.drop_index(op.f('ix_recheck_assignments_org_id'), table_name='recheck_assignments')
    op.drop_index(op.f('ix_recheck_assignments_item_id'), table_name='recheck_assignments')
    op.drop_index(op.f('ix_recheck_assignments_change_id'), table_name='recheck_assignments')
    op.drop_table('recheck_assignments')
    op.drop_index(op.f('ix_guideline_changes_org_id'), table_name='guideline_changes')
    op.drop_index(op.f('ix_guideline_changes_brand_id'), table_name='guideline_changes')
    op.drop_table('guideline_changes')
