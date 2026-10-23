"""Initial identity and tenant foundation; immutable migration definition."""
from alembic import op
import sqlalchemy as sa
revision = '0001_identity'
down_revision = None
branch_labels = None
depends_on = None

def upgrade():
    op.create_table('organisations', sa.Column('id', sa.String(36), primary_key=True), sa.Column('name', sa.String(200), nullable=False))
    op.create_table('users', sa.Column('id', sa.String(36), primary_key=True), sa.Column('email', sa.String(254), nullable=False, unique=True), sa.Column('password_hash', sa.String(512), nullable=False))
    op.create_table('memberships', sa.Column('id', sa.String(36), primary_key=True), sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False), sa.Column('org_id', sa.String(36), sa.ForeignKey('organisations.id', ondelete='CASCADE'), nullable=False), sa.Column('role', sa.String(20), nullable=False), sa.UniqueConstraint('user_id', 'org_id'), sa.CheckConstraint("role IN ('creator','manager','reviewer','admin')"))
    op.create_index('ix_memberships_org_id', 'memberships', ['org_id'])
    op.create_table('brands', sa.Column('id', sa.String(36), primary_key=True), sa.Column('org_id', sa.String(36), sa.ForeignKey('organisations.id', ondelete='CASCADE'), nullable=False), sa.Column('name', sa.String(200), nullable=False), sa.Column('source_epoch', sa.Integer, nullable=False), sa.UniqueConstraint('org_id', 'id'))
    op.create_index('ix_brands_org_id', 'brands', ['org_id'])
    op.create_table('sessions', sa.Column('token_hash', sa.String(64), primary_key=True), sa.Column('membership_id', sa.String(36), sa.ForeignKey('memberships.id', ondelete='CASCADE'), nullable=False), sa.Column('csrf_hash', sa.String(64), nullable=False), sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False))
    op.create_index('ix_sessions_expires_at', 'sessions', ['expires_at'])
    op.create_table('login_attempts', sa.Column('key', sa.String(64), primary_key=True), sa.Column('count', sa.Integer, nullable=False), sa.Column('reset_at', sa.DateTime(timezone=True), nullable=False))

def downgrade():
    for table in ('login_attempts', 'sessions', 'brands', 'memberships', 'users', 'organisations'):
        op.drop_table(table)
