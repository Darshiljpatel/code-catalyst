"""image campaigns

Revision ID: 0008_image_campaigns
Revises: 0007_guideline_requests
Create Date: 2026-10-28 00:55:00.557876

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0008_image_campaigns'
down_revision: Union[str, Sequence[str], None] = '0007_guideline_requests'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('assets',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('org_id', sa.String(length=36), nullable=False),
    sa.Column('item_id', sa.String(length=36), nullable=False),
    sa.Column('kind', sa.String(length=20), nullable=False),
    sa.Column('mime', sa.String(length=30), nullable=False),
    sa.Column('bytes', sa.LargeBinary(), nullable=False),
    sa.Column('sha256', sa.String(length=64), nullable=False),
    sa.Column('original_sha256', sa.String(length=64), nullable=False),
    sa.Column('width', sa.Integer(), nullable=False),
    sa.Column('height', sa.Integer(), nullable=False),
    sa.Column('intake', sa.JSON(), nullable=False),
    sa.Column('created_by', sa.String(length=36), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("mime IN ('image/png','image/jpeg')"),
    sa.ForeignKeyConstraint(['org_id', 'created_by'], ['memberships.org_id', 'memberships.id'], ),
    sa.ForeignKeyConstraint(['org_id', 'item_id'], ['content_items.org_id', 'content_items.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('org_id', 'id')
    )
    op.create_index(op.f('ix_assets_item_id'), 'assets', ['item_id'], unique=False)
    op.create_index(op.f('ix_assets_org_id'), 'assets', ['org_id'], unique=False)
    op.create_table('ocr_results',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('org_id', sa.String(length=36), nullable=False),
    sa.Column('asset_id', sa.String(length=36), nullable=False),
    sa.Column('engine', sa.String(length=40), nullable=False),
    sa.Column('engine_version', sa.String(length=80), nullable=False),
    sa.Column('params', sa.JSON(), nullable=False),
    sa.Column('words', sa.JSON(), nullable=False),
    sa.Column('lines', sa.JSON(), nullable=False),
    sa.Column('mean_confidence', sa.Double(), nullable=True),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('error_code', sa.String(length=60), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
    sa.CheckConstraint("status IN ('queued','running','complete','failed')"),
    sa.ForeignKeyConstraint(['org_id', 'asset_id'], ['assets.org_id', 'assets.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_ocr_results_asset_id'), 'ocr_results', ['asset_id'], unique=False)
    op.create_index(op.f('ix_ocr_results_org_id'), 'ocr_results', ['org_id'], unique=False)
    op.add_column('content_revisions', sa.Column('asset_id', sa.String(length=36), nullable=True))
    op.add_column('content_revisions', sa.Column('asset_sha256', sa.String(length=64), nullable=True))
    op.add_column('content_revisions', sa.Column('region_map', sa.JSON(), nullable=True))
    op.add_column('decisions', sa.Column('asset_sha256', sa.String(length=64), nullable=True))
    op.add_column('jobs', sa.Column('kind', sa.String(length=20), server_default='review', nullable=False))
    op.add_column('jobs', sa.Column('ocr_result_id', sa.String(length=36), nullable=True))
    op.alter_column('jobs', 'run_id',
               existing_type=sa.VARCHAR(length=36),
               nullable=True)
    op.create_unique_constraint('jobs_ocr_result_id_key', 'jobs', ['ocr_result_id'])
    op.create_check_constraint('ck_job_kind', 'jobs', "kind IN ('review','ocr','regression')")
    op.create_check_constraint('ck_job_target', 'jobs', "(kind = 'review') = (run_id IS NOT NULL)")


def downgrade() -> None:
    """Downgrade schema."""
    # WARNING: constraint name is None; this directive will fail as
    # rendered.  Add a name, or use a naming convention; see
    # https://alembic.sqlalchemy.org/en/latest/naming.html
    op.drop_constraint('ck_job_target', 'jobs', type_='check')
    op.drop_constraint('ck_job_kind', 'jobs', type_='check')
    op.drop_constraint('jobs_ocr_result_id_key', 'jobs', type_='unique')
    op.alter_column('jobs', 'run_id',
               existing_type=sa.VARCHAR(length=36),
               nullable=False)
    op.drop_column('jobs', 'ocr_result_id')
    op.drop_column('jobs', 'kind')
    op.drop_column('decisions', 'asset_sha256')
    op.drop_column('content_revisions', 'region_map')
    op.drop_column('content_revisions', 'asset_sha256')
    op.drop_column('content_revisions', 'asset_id')
    op.drop_index(op.f('ix_ocr_results_org_id'), table_name='ocr_results')
    op.drop_index(op.f('ix_ocr_results_asset_id'), table_name='ocr_results')
    op.drop_table('ocr_results')
    op.drop_index(op.f('ix_assets_org_id'), table_name='assets')
    op.drop_index(op.f('ix_assets_item_id'), table_name='assets')
    op.drop_table('assets')
