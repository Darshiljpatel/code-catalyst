"""S1 identity and tenant foundation. Domain tables arrive in S2."""
import uuid
from datetime import datetime
from sqlalchemy import String, ForeignKey, UniqueConstraint, CheckConstraint, DateTime, Integer
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

class Base(DeclarativeBase):
    pass

def uid():
    return str(uuid.uuid4())

class Organisation(Base):
    __tablename__ = 'organisations'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(200))

class User(Base):
    __tablename__ = 'users'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    email: Mapped[str] = mapped_column(String(254), unique=True)
    password_hash: Mapped[str] = mapped_column(String(512))

class Membership(Base):
    __tablename__ = 'memberships'
    __table_args__ = (UniqueConstraint('user_id', 'org_id'), CheckConstraint("role IN ('creator','manager','reviewer','admin')"))
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'))
    org_id: Mapped[str] = mapped_column(ForeignKey('organisations.id', ondelete='CASCADE'), index=True)
    role: Mapped[str] = mapped_column(String(20))

class Brand(Base):
    __tablename__ = 'brands'
    __table_args__ = (UniqueConstraint('org_id', 'id'),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey('organisations.id', ondelete='CASCADE'), index=True)
    name: Mapped[str] = mapped_column(String(200))
    source_epoch: Mapped[int] = mapped_column(Integer, default=0)

class SessionRecord(Base):
    __tablename__ = 'sessions'
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    membership_id: Mapped[str] = mapped_column(ForeignKey('memberships.id', ondelete='CASCADE'))
    csrf_hash: Mapped[str] = mapped_column(String(64))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)

class LoginAttempt(Base):
    __tablename__ = 'login_attempts'
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    count: Mapped[int] = mapped_column(Integer, default=0)
    reset_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
