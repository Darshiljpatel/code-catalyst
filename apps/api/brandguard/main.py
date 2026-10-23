import hashlib
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from dataclasses import dataclass
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from pwdlib import PasswordHash
from sqlalchemy import create_engine, select, delete, text
from sqlalchemy.orm import Session
from sqlalchemy.dialects.postgresql import insert
from .models import Brand, Membership, User, SessionRecord, LoginAttempt

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

    def __post_init__(self):
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

def create_app(settings=None):
    settings = settings or Settings(os.environ['DATABASE_URL'], os.getenv('PUBLIC_ORIGIN', 'http://localhost:8000'), os.getenv('APP_ENV', 'development'))
    engine = create_engine(settings.database_url, pool_pre_ping=True)
    @asynccontextmanager
    async def lifespan(app):
        yield
        engine.dispose()
    app = FastAPI(title='BrandGuard API', version='0.1.0', lifespan=lifespan)
    app.state.engine = engine

    @app.middleware('http')
    async def security(request, call_next):
        request.state.request_id = str(uuid.uuid4())
        response = await call_next(request)
        response.headers['X-Request-ID'] = request.state.request_id
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Cache-Control'] = 'no-store'
        return response

    @app.exception_handler(Problem)
    async def problem(request, exc):
        return JSONResponse(status_code=exc.status, content=dict(code=exc.code, message=exc.message, request_id=request.state.request_id, details={}))

    @app.exception_handler(RequestValidationError)
    async def invalid(request, exc):
        # Do not echo submitted passwords or confidential input through validation errors.
        return JSONResponse(status_code=422, content=dict(code='invalid_fields', message='Check the supplied fields.', request_id=request.state.request_id, details={}))

    def db():
        with Session(engine) as session:
            yield session

    def trusted_origin(request: Request):
        if request.headers.get('origin') != settings.public_origin:
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

    @app.post('/api/v1/sessions')
    def login(body: Login, request: Request, response: Response, session: Session = Depends(db)):
        trusted_origin(request)
        now = datetime.now(timezone.utc)
        # Persistent per-client window. Never trust forwarded headers from arbitrary clients.
        key = digest(request.client.host if request.client else 'unknown')
        session.execute(insert(LoginAttempt).values(key=key, count=0, reset_at=now + timedelta(minutes=15)).on_conflict_do_nothing())
        attempt = session.scalar(select(LoginAttempt).where(LoginAttempt.key == key).with_for_update())
        if attempt.reset_at <= now:
            attempt.count, attempt.reset_at = 0, now + timedelta(minutes=15)
        if attempt.count >= 20:
            session.commit()
            raise Problem(429, 'rate_limited', 'Too many sign-in attempts. Try again later.')
        attempt.count += 1
        session.commit()
        user = session.scalar(select(User).where(User.email == body.email.strip().lower()))
        try:
            valid = passwords.verify(body.password, user.password_hash if user else DUMMY_HASH)
        except Exception:
            valid = False
        member = session.scalar(select(Membership).where(Membership.user_id == user.id, Membership.org_id == body.org_id)) if user and valid else None
        if member is None:
            raise Problem(401, 'invalid_credentials', 'Invalid credentials or workspace.')
        token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        session.add(SessionRecord(token_hash=digest(token), csrf_hash=digest(csrf), membership_id=member.id, expires_at=now + timedelta(hours=8)))
        session.commit()
        response.set_cookie(COOKIE, token, httponly=True, secure=settings.environment != 'development', samesite='strict', max_age=28800, path='/')
        return dict(csrf_token=csrf, org_id=member.org_id, role=member.role)

    @app.get('/api/v1/me')
    def me(member=Depends(identity)):
        return dict(user_id=member.user_id, org_id=member.org_id, role=member.role)

    @app.delete('/api/v1/sessions/current', status_code=204)
    def logout(request: Request, response: Response, member=Depends(identity), session: Session = Depends(db)):
        session.execute(delete(SessionRecord).where(SessionRecord.token_hash == digest(request.cookies[COOKIE])))
        session.commit()
        response.delete_cookie(COOKIE, path='/')

    @app.get('/api/v1/brands')
    def brands(member=Depends(identity), session: Session = Depends(db)):
        return [dict(id=b.id, name=b.name, source_epoch=b.source_epoch) for b in session.scalars(select(Brand).where(Brand.org_id == member.org_id))]

    @app.get('/api/v1/brands/{brand_id}')
    def brand(brand_id: str, member=Depends(identity), session: Session = Depends(db)):
        b = session.scalar(select(Brand).where(Brand.id == brand_id, Brand.org_id == member.org_id))
        if b is None:
            raise Problem(404, 'not_found', 'Brand not found.')
        return dict(id=b.id, name=b.name, source_epoch=b.source_epoch)

    @app.post('/api/v1/brands', status_code=201)
    def new_brand(body: NewBrand, member=Depends(manager), session: Session = Depends(db)):
        if not body.name.strip():
            raise Problem(422, 'invalid_fields', 'Brand name is required.')
        b = Brand(org_id=member.org_id, name=body.name.strip())
        session.add(b)
        session.commit()
        return dict(id=b.id, name=b.name, source_epoch=b.source_epoch)

    @app.get('/api/v1/health/live')
    def live():
        return {'status': 'live', 'phase': 'S1'}

    @app.get('/api/v1/health/ready')
    def ready(session: Session = Depends(db)):
        try:
            revision = session.execute(text('select version_num from alembic_version')).scalar_one()
            if revision != '0001_identity':
                raise ValueError('Unexpected schema')
        except Exception:
            raise Problem(503, 'not_ready', 'Database schema is not ready.')
        return {'status': 'ready', 'scope': 'S1 identity only; worker not implemented'}

    return app
