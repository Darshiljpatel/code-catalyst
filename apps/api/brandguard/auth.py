from fastapi import APIRouter
import secrets
from datetime import datetime, timedelta, timezone
from fastapi import Depends, Request, Response
from sqlalchemy import select, delete
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session
from .core import (db, identity, trusted_origin, digest, passwords, DUMMY_HASH,
                   COOKIE, Problem, Login)
from .models import User, Membership, SessionRecord, LoginAttempt

router = APIRouter()

@router.post('/api/v1/sessions')
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
    token = secrets.token_urlsafe(32)
    csrf = digest('csrf:' + token)
    session.add(SessionRecord(token_hash=digest(token), csrf_hash=digest(csrf), membership_id=member.id, expires_at=now + timedelta(hours=8)))
    session.commit()
    response.set_cookie(COOKIE, token, httponly=True, secure=request.app.state.settings.environment != 'development', samesite='strict', max_age=28800, path='/')
    return dict(csrf_token=csrf, org_id=member.org_id, role=member.role)

@router.get('/api/v1/me')
def me(request: Request, member=Depends(identity), session: Session=Depends(db)):
    token = request.cookies[COOKIE]
    csrf = digest('csrf:' + token)
    record = session.get(SessionRecord, digest(token))
    if record.csrf_hash != digest(csrf):
        record.csrf_hash = digest(csrf)
        session.commit()
    return dict(user_id=member.user_id, membership_id=member.id, org_id=member.org_id, role=member.role, csrf_token=csrf)

@router.delete('/api/v1/sessions/current', status_code=204)
def logout(request: Request, response: Response, member=Depends(identity), session: Session = Depends(db)):
    session.execute(delete(SessionRecord).where(SessionRecord.token_hash == digest(request.cookies[COOKIE])))
    session.commit()
    response.delete_cookie(COOKIE, path='/')

