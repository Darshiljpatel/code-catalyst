"""guideline requests

Revision ID: 0007_guideline_requests
Revises: 0006_guideline_changes
Create Date: 2026-10-28 00:41:45.368695

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0007_guideline_requests'
down_revision: Union[str, Sequence[str], None] = '0006_guideline_changes'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('example_sets',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('org_id', sa.String(length=36), nullable=False),
    sa.Column('brand_id', sa.String(length=36), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('created_by', sa.String(length=36), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['org_id', 'brand_id'], ['brands.org_id', 'brands.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('org_id', 'id')
    )
    op.create_index(op.f('ix_example_sets_brand_id'), 'example_sets', ['brand_id'], unique=False)
    op.create_index(op.f('ix_example_sets_org_id'), 'example_sets', ['org_id'], unique=False)
    op.create_table('example_cases',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('org_id', sa.String(length=36), nullable=False),
    sa.Column('set_id', sa.String(length=36), nullable=False),
    sa.Column('label', sa.String(length=200), nullable=False),
    sa.Column('text', sa.Text(), nullable=False),
    sa.Column('context', sa.JSON(), nullable=False),
    sa.Column('expectations', sa.JSON(), nullable=False),
    sa.Column('origin_revision_id', sa.String(length=36), nullable=True),
    sa.Column('external_ok', sa.Boolean(), nullable=False),
    sa.Column('author_id', sa.String(length=36), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['org_id', 'set_id'], ['example_sets.org_id', 'example_sets.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('org_id', 'id')
    )
    op.create_index(op.f('ix_example_cases_org_id'), 'example_cases', ['org_id'], unique=False)
    op.create_index(op.f('ix_example_cases_set_id'), 'example_cases', ['set_id'], unique=False)
    op.create_table('guideline_requests',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('org_id', sa.String(length=36), nullable=False),
    sa.Column('brand_id', sa.String(length=36), nullable=False),
    sa.Column('source_key', sa.String(length=100), nullable=False),
    sa.Column('base_source_id', sa.String(length=36), nullable=False),
    sa.Column('rule_id', sa.String(length=100), nullable=True),
    sa.Column('title', sa.String(length=200), nullable=False),
    sa.Column('problem', sa.Text(), nullable=False),
    sa.Column('status', sa.String(length=30), nullable=False),
    sa.Column('signals', sa.JSON(), nullable=False),
    sa.Column('draft_source_id', sa.String(length=36), nullable=True),
    sa.Column('draft_hash', sa.String(length=64), nullable=True),
    sa.Column('change_id', sa.String(length=36), nullable=True),
    sa.Column('created_by', sa.String(length=36), nullable=False),
    sa.Column('assignee_id', sa.String(length=36), nullable=True),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("status IN ('open','in_review','changes_requested','approved','activated','withdrawn')"),
    sa.ForeignKeyConstraint(['org_id', 'assignee_id'], ['memberships.org_id', 'memberships.id'], ),
    sa.ForeignKeyConstraint(['org_id', 'base_source_id'], ['source_versions.org_id', 'source_versions.id'], ),
    sa.ForeignKeyConstraint(['org_id', 'brand_id'], ['brands.org_id', 'brands.id'], ),
    sa.ForeignKeyConstraint(['org_id', 'created_by'], ['memberships.org_id', 'memberships.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('org_id', 'id')
    )
    op.create_index(op.f('ix_guideline_requests_brand_id'), 'guideline_requests', ['brand_id'], unique=False)
    op.create_index(op.f('ix_guideline_requests_org_id'), 'guideline_requests', ['org_id'], unique=False)
    op.create_table('comparison_runs',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('org_id', sa.String(length=36), nullable=False),
    sa.Column('request_id', sa.String(length=36), nullable=False),
    sa.Column('baseline_source_ids', sa.JSON(), nullable=False),
    sa.Column('proposed_source_id', sa.String(length=36), nullable=False),
    sa.Column('proposed_hash', sa.String(length=64), nullable=False),
    sa.Column('example_set_id', sa.String(length=36), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('summary', sa.JSON(), nullable=False),
    sa.Column('created_by', sa.String(length=36), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['org_id', 'request_id'], ['guideline_requests.org_id', 'guideline_requests.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('org_id', 'id')
    )
    op.create_index(op.f('ix_comparison_runs_org_id'), 'comparison_runs', ['org_id'], unique=False)
    op.create_index(op.f('ix_comparison_runs_request_id'), 'comparison_runs', ['request_id'], unique=False)
    op.create_table('request_examples',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('org_id', sa.String(length=36), nullable=False),
    sa.Column('request_id', sa.String(length=36), nullable=False),
    sa.Column('item_id', sa.String(length=36), nullable=True),
    sa.Column('revision_id', sa.String(length=36), nullable=True),
    sa.Column('finding_id', sa.String(length=36), nullable=True),
    sa.Column('kind', sa.String(length=20), nullable=False),
    sa.Column('excerpt', sa.Text(), nullable=False),
    sa.Column('text', sa.Text(), nullable=False),
    sa.Column('context', sa.JSON(), nullable=False),
    sa.Column('dispute', sa.JSON(), nullable=False),
    sa.Column('expected', sa.String(length=20), nullable=False),
    sa.Column('labelled_by', sa.String(length=36), nullable=True),
    sa.Column('external_ok', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("expected IN ('flag','no_flag','unsure')"),
    sa.CheckConstraint("kind IN ('dispute','ambiguity','manual')"),
    sa.ForeignKeyConstraint(['org_id', 'request_id'], ['guideline_requests.org_id', 'guideline_requests.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_request_examples_org_id'), 'request_examples', ['org_id'], unique=False)
    op.create_index(op.f('ix_request_examples_request_id'), 'request_examples', ['request_id'], unique=False)
    op.create_table('request_reviews',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('org_id', sa.String(length=36), nullable=False),
    sa.Column('request_id', sa.String(length=36), nullable=False),
    sa.Column('reviewer_id', sa.String(length=36), nullable=False),
    sa.Column('decision', sa.String(length=30), nullable=False),
    sa.Column('rationale', sa.Text(), nullable=False),
    sa.Column('draft_hash', sa.String(length=64), nullable=False),
    sa.Column('comparison_run_id', sa.String(length=36), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("decision IN ('approved','changes_requested','rejected')"),
    sa.ForeignKeyConstraint(['org_id', 'request_id'], ['guideline_requests.org_id', 'guideline_requests.id'], ),
    sa.ForeignKeyConstraint(['org_id', 'reviewer_id'], ['memberships.org_id', 'memberships.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_request_reviews_org_id'), 'request_reviews', ['org_id'], unique=False)
    op.create_index(op.f('ix_request_reviews_request_id'), 'request_reviews', ['request_id'], unique=False)
    op.create_table('comparison_results',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('org_id', sa.String(length=36), nullable=False),
    sa.Column('run_id', sa.String(length=36), nullable=False),
    sa.Column('case_id', sa.String(length=36), nullable=False),
    sa.Column('side', sa.String(length=20), nullable=False),
    sa.Column('attempt', sa.Integer(), nullable=False),
    sa.Column('findings', sa.JSON(), nullable=False),
    sa.Column('checks', sa.JSON(), nullable=False),
    sa.CheckConstraint("side IN ('live','proposed')"),
    sa.ForeignKeyConstraint(['org_id', 'run_id'], ['comparison_runs.org_id', 'comparison_runs.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_comparison_results_org_id'), 'comparison_results', ['org_id'], unique=False)
    op.create_index(op.f('ix_comparison_results_run_id'), 'comparison_results', ['run_id'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_comparison_results_run_id'), table_name='comparison_results')
    op.drop_index(op.f('ix_comparison_results_org_id'), table_name='comparison_results')
    op.drop_table('comparison_results')
    op.drop_index(op.f('ix_request_reviews_request_id'), table_name='request_reviews')
    op.drop_index(op.f('ix_request_reviews_org_id'), table_name='request_reviews')
    op.drop_table('request_reviews')
    op.drop_index(op.f('ix_request_examples_request_id'), table_name='request_examples')
    op.drop_index(op.f('ix_request_examples_org_id'), table_name='request_examples')
    op.drop_table('request_examples')
    op.drop_index(op.f('ix_comparison_runs_request_id'), table_name='comparison_runs')
    op.drop_index(op.f('ix_comparison_runs_org_id'), table_name='comparison_runs')
    op.drop_table('comparison_runs')
    op.drop_index(op.f('ix_guideline_requests_org_id'), table_name='guideline_requests')
    op.drop_index(op.f('ix_guideline_requests_brand_id'), table_name='guideline_requests')
    op.drop_table('guideline_requests')
    op.drop_index(op.f('ix_example_cases_set_id'), table_name='example_cases')
    op.drop_index(op.f('ix_example_cases_org_id'), table_name='example_cases')
    op.drop_table('example_cases')
    op.drop_index(op.f('ix_example_sets_org_id'), table_name='example_sets')
    op.drop_index(op.f('ix_example_sets_brand_id'), table_name='example_sets')
    op.drop_table('example_sets')
