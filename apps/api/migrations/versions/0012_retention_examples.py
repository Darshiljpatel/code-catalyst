"""retention of guideline-request example copies

Revision ID: 0012_retention_examples
Revises: 0011_retention
Create Date: 2026-10-28 07:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0012_retention_examples'
down_revision: Union[str, Sequence[str], None] = '0011_retention'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('request_examples', sa.Column('redacted_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('request_examples', 'redacted_at')
