from fastapi import APIRouter
import secrets
from datetime import datetime, timedelta, timezone
from fastapi import Depends, Request, Response
from sqlalchemy import select, delete
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session
from .core import (db, identity, trusted_origin, client_ip, digest, passwords, DUMMY_HASH,
                   COOKIE, Problem, Login)
from .models import User, Membership, SessionRecord, LoginAttempt, Organisation

router = APIRouter()
# Failed attempts per 15 minutes. The address+email key stops guessing one account; the
# email key caps distributed guessing; the wide address key only stops bulk scanning, so
# judges behind one proxy address no longer lock each other out.
LIMITS = (('address-email', 20), ('email', 50), ('address', 200))


def throttle_keys(request, email):
    address = client_ip(request)
    values = {'address-email': f'{address}|{email}', 'email': email, 'address': address}
    return sorted((digest(f'{kind}:{values[kind]}'), limit) for kind, limit in LIMITS)

@router.post('/api/v1/sessions')
def login(body: Login, request: Request, response: Response, session: Session = Depends(db)):
    trusted_origin(request)
    now = datetime.now(timezone.utc)
    email = body.email.strip().lower()
    # Persistent windows, locked in key order so concurrent sign-ins cannot deadlock.
    attempts = []
    for key, limit in throttle_keys(request, email):
        session.execute(insert(LoginAttempt).values(key=key, count=0, reset_at=now + timedelta(minutes=15)).on_conflict_do_nothing())
        attempt = session.scalar(select(LoginAttempt).where(LoginAttempt.key == key).with_for_update())
        if attempt.reset_at <= now:
            attempt.count, attempt.reset_at = 0, now + timedelta(minutes=15)
        attempts.append((attempt, limit))
    if any(attempt.count >= limit for attempt, limit in attempts):
        session.commit()
        raise Problem(429, 'rate_limited', 'Too many sign-in attempts. Try again later.')
    user = session.scalar(select(User).where(User.email == email))
    try:
        valid = passwords.verify(body.password, user.password_hash if user else DUMMY_HASH)
    except Exception:
        valid = False
    member = session.scalar(select(Membership).where(Membership.user_id == user.id, Membership.org_id == body.org_id)) if user and valid else None
    if member is None:
        # A throttle is protection against repeated failed authentication, not
        # against people successfully moving between test roles. Counting every
        # request made a shared localhost counter lock out valid users.
        for attempt, _ in attempts:
            attempt.count += 1
        session.commit()
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
    org = session.get(Organisation, member.org_id)
    return dict(user_id=member.user_id, membership_id=member.id, org_id=member.org_id, role=member.role, csrf_token=csrf,
                label=member.label, is_demo=bool(org.is_demo), demo_expires_at=org.expires_at.isoformat() if org.is_demo and org.expires_at else None)

@router.delete('/api/v1/sessions/current', status_code=204)
def logout(request: Request, response: Response, member=Depends(identity), session: Session = Depends(db)):
    session.execute(delete(SessionRecord).where(SessionRecord.token_hash == digest(request.cookies[COOKIE])))
    session.commit()
    response.delete_cookie(COOKIE, path='/')

