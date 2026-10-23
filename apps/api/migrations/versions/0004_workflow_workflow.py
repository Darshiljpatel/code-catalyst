"""workflow

Revision ID: 0004_workflow
Revises: 0003_semantic
Create Date: 2026-10-23 11:54:49.182564

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0004_workflow'
down_revision: Union[str, Sequence[str], None] = '0003_semantic'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_unique_constraint('uq_finding_org_id', 'findings', ['org_id', 'id'])
    op.create_unique_constraint('uq_finding_revision', 'findings', ['org_id', 'id', 'revision_id'])

    op.create_table('decisions',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('org_id', sa.String(length=36), nullable=False),
    sa.Column('revision_id', sa.String(length=36), nullable=False),
    sa.Column('run_id', sa.String(length=36), nullable=False),
    sa.Column('reviewer_id', sa.String(length=36), nullable=False),
    sa.Column('kind', sa.String(length=30), nullable=False),
    sa.Column('rationale', sa.Text(), nullable=False),
    sa.Column('source_epoch', sa.Integer(), nullable=False),
    sa.Column('text_hash', sa.String(length=64), nullable=False),
    sa.Column('evidence_record', sa.JSON(), nullable=False),
    sa.Column('decided_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("kind IN ('approved','changes_requested')"),
    sa.ForeignKeyConstraint(['org_id', 'reviewer_id'], ['memberships.org_id', 'memberships.id'], ),
    sa.ForeignKeyConstraint(['org_id', 'run_id', 'revision_id'], ['review_runs.org_id', 'review_runs.id', 'review_runs.revision_id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('run_id')
    )
    op.create_index(op.f('ix_decisions_org_id'), 'decisions', ['org_id'], unique=False)
    op.create_table('manual_checks',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('org_id', sa.String(length=36), nullable=False),
    sa.Column('run_id', sa.String(length=36), nullable=False),
    sa.Column('reviewer_id', sa.String(length=36), nullable=False),
    sa.Column('category', sa.String(length=30), nullable=False),
    sa.Column('outcome', sa.String(length=30), nullable=False),
    sa.Column('rationale', sa.Text(), nullable=False),
    sa.Column('source_version_ids', sa.JSON(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("outcome IN ('complete','not_applicable')"),
    sa.ForeignKeyConstraint(['org_id', 'reviewer_id'], ['memberships.org_id', 'memberships.id'], ),
    sa.ForeignKeyConstraint(['org_id', 'run_id'], ['review_runs.org_id', 'review_runs.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('run_id', 'category', 'reviewer_id')
    )
    op.create_index(op.f('ix_manual_checks_org_id'), 'manual_checks', ['org_id'], unique=False)
    op.create_table('comments',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('org_id', sa.String(length=36), nullable=False),
    sa.Column('revision_id', sa.String(length=36), nullable=False),
    sa.Column('author_id', sa.String(length=36), nullable=False),
    sa.Column('finding_id', sa.String(length=36), nullable=True),
    sa.Column('text', sa.Text(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['org_id', 'author_id'], ['memberships.org_id', 'memberships.id'], ),
    sa.ForeignKeyConstraint(['org_id', 'finding_id', 'revision_id'], ['findings.org_id', 'findings.id', 'findings.revision_id'], ),
    sa.ForeignKeyConstraint(['org_id', 'revision_id'], ['content_revisions.org_id', 'content_revisions.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_comments_org_id'), 'comments', ['org_id'], unique=False)
    op.create_table('finding_resolutions',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('org_id', sa.String(length=36), nullable=False),
    sa.Column('finding_id', sa.String(length=36), nullable=False),
    sa.Column('actor_id', sa.String(length=36), nullable=False),
    sa.Column('action', sa.String(length=30), nullable=False),
    sa.Column('rationale', sa.Text(), nullable=False),
    sa.Column('source_version_ids', sa.JSON(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("action IN ('request_exception','request_dismissal','confirm','dismiss','grant_exception','reject_exception')"),
    sa.ForeignKeyConstraint(['org_id', 'actor_id'], ['memberships.org_id', 'memberships.id'], ),
    sa.ForeignKeyConstraint(['org_id', 'finding_id'], ['findings.org_id', 'findings.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_finding_resolutions_finding_id'), 'finding_resolutions', ['finding_id'], unique=False)
    op.create_index(op.f('ix_finding_resolutions_org_id'), 'finding_resolutions', ['org_id'], unique=False)
    op.add_column('content_items', sa.Column('workflow_version', sa.Integer(), server_default='1', nullable=False))
    for table in ('comments','finding_resolutions','manual_checks','decisions'):
        op.execute(f'CREATE TRIGGER immutable_payload BEFORE UPDATE ON {table} '
                   'FOR EACH ROW EXECUTE FUNCTION brandguard_immutable_payload()')


def downgrade() -> None:
    """Downgrade schema."""
    # ### commands auto generated by Alembic - please adjust! ###
    op.drop_column('content_items', 'workflow_version')
    op.drop_index(op.f('ix_finding_resolutions_org_id'), table_name='finding_resolutions')
    op.drop_index(op.f('ix_finding_resolutions_finding_id'), table_name='finding_resolutions')
    op.drop_table('finding_resolutions')
    op.drop_index(op.f('ix_comments_org_id'), table_name='comments')
    op.drop_table('comments')
    op.drop_index(op.f('ix_manual_checks_org_id'), table_name='manual_checks')
    op.drop_table('manual_checks')
    op.drop_index(op.f('ix_decisions_org_id'), table_name='decisions')
    op.drop_table('decisions')
    op.drop_constraint('uq_finding_revision', 'findings', type_='unique')
    op.drop_constraint('uq_finding_org_id', 'findings', type_='unique')
