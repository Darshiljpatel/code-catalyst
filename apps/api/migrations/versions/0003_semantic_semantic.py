"""semantic

Revision ID: 0003_semantic
Revises: 0002_review_foundation
Create Date: 2026-10-23 11:35:28.458629

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0003_semantic'
down_revision: Union[str, Sequence[str], None] = '0002_review_foundation'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_unique_constraint('uq_run_revision', 'review_runs', ['org_id', 'id', 'revision_id'])

    op.create_table('processing_policies',
    sa.Column('org_id', sa.String(length=36), nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('enabled', sa.Boolean(), nullable=False),
    sa.Column('model', sa.String(length=200), nullable=False),
    sa.Column('notice', sa.Text(), nullable=False),
    sa.Column('approved_by', sa.String(length=36), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint('version > 0'),
    sa.ForeignKeyConstraint(['org_id', 'approved_by'], ['memberships.org_id', 'memberships.id'], ),
    sa.ForeignKeyConstraint(['org_id'], ['organisations.id'], ),
    sa.PrimaryKeyConstraint('org_id')
    )
    op.create_table('findings',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('org_id', sa.String(length=36), nullable=False),
    sa.Column('run_id', sa.String(length=36), nullable=False),
    sa.Column('revision_id', sa.String(length=36), nullable=False),
    sa.Column('category', sa.String(length=30), nullable=False),
    sa.Column('severity', sa.String(length=20), nullable=False),
    sa.Column('evidence_status', sa.String(length=30), nullable=False),
    sa.Column('origin', sa.String(length=20), nullable=False),
    sa.Column('source_version_id', sa.String(length=36), nullable=False),
    sa.Column('rule_id', sa.String(length=100), nullable=False),
    sa.Column('evidence_quote', sa.Text(), nullable=False),
    sa.Column('location', sa.JSON(), nullable=False),
    sa.Column('rationale', sa.Text(), nullable=False),
    sa.Column('suggested_edit', sa.Text(), nullable=True),
    sa.Column('resolution', sa.String(length=30), nullable=False),
    sa.CheckConstraint("origin IN ('model','deterministic')"),
    sa.CheckConstraint("severity IN ('blocker','warning','advisory')"),
    sa.ForeignKeyConstraint(['org_id', 'run_id', 'revision_id'], ['review_runs.org_id', 'review_runs.id', 'review_runs.revision_id'], ),
    sa.ForeignKeyConstraint(['run_id', 'source_version_id'], ['run_sources.run_id', 'run_sources.source_id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_findings_org_id'), 'findings', ['org_id'], unique=False)
    op.create_index(op.f('ix_findings_run_id'), 'findings', ['run_id'], unique=False)
    op.add_column('review_runs', sa.Column('processing_snapshot', sa.JSON(), server_default='{}', nullable=False))
    op.add_column('review_runs', sa.Column('engine_metadata', sa.JSON(), server_default='{}', nullable=False))
    op.execute('DROP TRIGGER immutable_payload ON review_runs')
    op.execute("CREATE TRIGGER immutable_payload BEFORE UPDATE ON review_runs FOR EACH ROW "
               "EXECUTE FUNCTION brandguard_immutable_payload('status','checks','engine_metadata')")
    op.execute("CREATE TRIGGER immutable_payload BEFORE UPDATE ON findings FOR EACH ROW "
               "EXECUTE FUNCTION brandguard_immutable_payload('resolution')")


def downgrade() -> None:
    op.drop_table('findings')
    op.drop_table('processing_policies')
    op.execute('DROP TRIGGER immutable_payload ON review_runs')
    op.execute("CREATE TRIGGER immutable_payload BEFORE UPDATE ON review_runs FOR EACH ROW "
               "EXECUTE FUNCTION brandguard_immutable_payload('status','checks')")
    op.drop_constraint('uq_run_revision', 'review_runs', type_='unique')
    op.drop_column('review_runs', 'engine_metadata')
    op.drop_column('review_runs', 'processing_snapshot')
