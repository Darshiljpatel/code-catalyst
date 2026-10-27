"""demo sandboxes

Revision ID: 0009_demo_sandboxes
Revises: 0008_image_campaigns
Create Date: 2026-10-28 01:12:38.769344

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0009_demo_sandboxes'
down_revision: Union[str, Sequence[str], None] = '0008_image_campaigns'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('memberships', sa.Column('label', sa.String(length=60), nullable=True))
    op.add_column('organisations', sa.Column('is_demo', sa.Boolean(), server_default='false', nullable=False))
    op.add_column('organisations', sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('organisations', sa.Column('created_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('organisations', sa.Column('created_ip_hash', sa.String(length=64), nullable=True))
    op.add_column('organisations', sa.Column('daily_run_limit', sa.Integer(), nullable=True))
    op.create_index(op.f('ix_organisations_created_ip_hash'), 'organisations', ['created_ip_hash'], unique=False)
    op.create_index(op.f('ix_organisations_expires_at'), 'organisations', ['expires_at'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_organisations_expires_at'), table_name='organisations')
    op.drop_index(op.f('ix_organisations_created_ip_hash'), table_name='organisations')
    op.drop_column('organisations', 'daily_run_limit')
    op.drop_column('organisations', 'created_ip_hash')
    op.drop_column('organisations', 'created_at')
    op.drop_column('organisations', 'expires_at')
    op.drop_column('organisations', 'is_demo')
    op.drop_column('memberships', 'label')
