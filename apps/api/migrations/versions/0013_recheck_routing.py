"""recheck routing: possible-level campaigns keep their approval through the recheck

Revision ID: 0013_recheck_routing
Revises: 0012_retention_examples
Create Date: 2026-10-28 08:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0013_recheck_routing'
down_revision: Union[str, Sequence[str], None] = '0012_retention_examples'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('recheck_assignments', sa.Column('routing', sa.String(length=20), server_default='hold', nullable=False))
    op.add_column('recheck_assignments', sa.Column('outcome', sa.String(length=30), nullable=True))
    op.create_check_constraint('ck_recheck_assignments_routing', 'recheck_assignments', "routing IN ('hold','keep')")
    op.add_column('decisions', sa.Column('carried_from_decision_id', sa.String(length=36), nullable=True))
    op.add_column('manual_checks', sa.Column('carried_from_id', sa.String(length=36), nullable=True))
    op.add_column('finding_resolutions', sa.Column('carried_from_id', sa.String(length=36), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('finding_resolutions', 'carried_from_id')
    op.drop_column('manual_checks', 'carried_from_id')
    op.drop_column('decisions', 'carried_from_decision_id')
    op.drop_constraint('ck_recheck_assignments_routing', 'recheck_assignments', type_='check')
    op.drop_column('recheck_assignments', 'outcome')
    op.drop_column('recheck_assignments', 'routing')
