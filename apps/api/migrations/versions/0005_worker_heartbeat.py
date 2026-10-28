"""worker heartbeat

Revision ID: 0005_worker_heartbeat
Revises: 0004_workflow
Create Date: 2026-10-28 00:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0005_worker_heartbeat'
down_revision: Union[str, Sequence[str], None] = '0004_workflow'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('worker_heartbeats',
    sa.Column('worker_id', sa.String(length=64), nullable=False),
    sa.Column('version', sa.String(length=64), nullable=False),
    sa.Column('started_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('seen_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('worker_id')
    )
    op.create_index(op.f('ix_worker_heartbeats_seen_at'), 'worker_heartbeats', ['seen_at'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_worker_heartbeats_seen_at'), table_name='worker_heartbeats')
    op.drop_table('worker_heartbeats')
