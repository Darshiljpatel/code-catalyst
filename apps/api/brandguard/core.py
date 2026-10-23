"""Shared authentication dependencies; all routers derive tenant identity here."""
import hashlib
import secrets
from datetime import datetime, timezone
from dataclasses import dataclass
from fastapi import Depends, Request
from pydantic import BaseModel, Field
from pwdlib import PasswordHash
from sqlalchemy.orm import Session
from .models import Membership, SessionRecord

passwords = PasswordHash.recommended()
DUMMY_HASH = passwords.hash(secrets.token_urlsafe(32))
COOKIE = 'brandguard_session'

def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()

@dataclass(frozen=True)
class Settings:
    database_url: str
    public_origin: str = 'http://localhost:8000'
    environment: str = 'development'
    max_external_runs_per_day: int = 100

    def __post_init__(self):
        if not 1 <= self.max_external_runs_per_day <= 10000:
            raise ValueError('Invalid external run budget')
        if not self.database_url.startswith('postgresql+psycopg://'):
            raise ValueError('PostgreSQL with psycopg is required')
        from urllib.parse import urlsplit
        origin = urlsplit(self.public_origin)
        if origin.scheme not in ('http', 'https') or not origin.netloc or origin.path or origin.query or origin.fragment or origin.username:
            raise ValueError('PUBLIC_ORIGIN must be an origin without path or credentials')
        if self.environment not in ('development', 'test', 'production'):
            raise ValueError('Invalid environment')
        if self.environment == 'production' and origin.scheme != 'https':
            raise ValueError('Production requires HTTPS')

class Problem(Exception):
    def __init__(self, status, code, message):
        self.status, self.code, self.message = status, code, message

class Login(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=256)
    org_id: str = Field(min_length=1, max_length=36)

class NewBrand(BaseModel):
    name: str = Field(min_length=1, max_length=200)


def db(request: Request):
    with Session(request.app.state.engine) as session:
        yield session

def trusted_origin(request: Request):
    if request.headers.get('origin') != request.app.state.settings.public_origin:
        raise Problem(403, 'origin_denied', 'Request origin is not permitted.')

def identity(request: Request, session: Session = Depends(db)):
    token = request.cookies.get(COOKIE, '')
    record = session.get(SessionRecord, digest(token)) if token else None
    if record is None or record.expires_at <= datetime.now(timezone.utc):
        raise Problem(401, 'unauthenticated', 'Sign in to continue.')
    member = session.get(Membership, record.membership_id)
    if member is None:
        raise Problem(401, 'unauthenticated', 'Sign in to continue.')
    if request.method not in ('GET', 'HEAD', 'OPTIONS'):
        trusted_origin(request)
        if not secrets.compare_digest(record.csrf_hash, digest(request.headers.get('x-csrf-token', ''))):
            raise Problem(403, 'csrf_denied', 'Refresh your session and retry.')
    return member

def manager(member=Depends(identity)):
    if member.role != 'manager':
        raise Problem(403, 'forbidden', 'A brand manager is required.')
    return member

