"""Honest health: schema at the Alembic head, a live worker heartbeat and the deployed commit."""
import os
import socket
import uuid
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from fastapi import APIRouter, Depends, Request
from sqlalchemy import select, text, func
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session
from .core import db, Problem
from .models import WorkerHeartbeat

router = APIRouter(prefix='/api/v1/health')
HEARTBEAT_SECONDS = 10
OFFLINE_AFTER_SECONDS = 60
COMMIT_VARIABLES = ('GIT_COMMIT_SHA', 'RENDER_GIT_COMMIT', 'VERCEL_GIT_COMMIT_SHA', 'SOURCE_COMMIT')


def utcnow():
    return datetime.now(timezone.utc)


@lru_cache(maxsize=1)
def schema_heads():
    from alembic.config import Config
    from alembic.script import ScriptDirectory
    config = Config(str(Path(__file__).resolve().parents[1] / 'alembic.ini'))
    return frozenset(ScriptDirectory.from_config(config).get_heads())


def commit_sha():
    for name in COMMIT_VARIABLES:
        value = os.getenv(name, '').strip()
        if value:
            return value[:40]
    return 'unknown'


def worker_identity():
    return f'{socket.gethostname()[:40]}-{os.getpid()}-{uuid.uuid4().hex[:8]}'


def beat(engine, worker_id, started_at):
    """Upsert this worker's heartbeat. Called from the worker loop every HEARTBEAT_SECONDS."""
    at = utcnow()
    with Session(engine) as session:
        session.execute(insert(WorkerHeartbeat).values(worker_id=worker_id, version=commit_sha(),
            started_at=started_at, seen_at=at).on_conflict_do_update(
            index_elements=['worker_id'], set_=dict(seen_at=at, version=commit_sha())))
        # Rows from crashed or replaced workers are history, not liveness.
        session.execute(WorkerHeartbeat.__table__.delete().where(WorkerHeartbeat.seen_at < at - timedelta(days=1)))
        session.commit()
    return at


def worker_status(session):
    latest = session.scalar(select(WorkerHeartbeat).order_by(WorkerHeartbeat.seen_at.desc()).limit(1))
    if latest is None:
        return dict(status='unknown', last_seen_at=None, age_seconds=None, worker_count=0,
                    offline_after_seconds=OFFLINE_AFTER_SECONDS)
    age = max(0.0, (utcnow() - latest.seen_at).total_seconds())
    fresh = session.scalar(select(func.count()).select_from(WorkerHeartbeat).where(
        WorkerHeartbeat.seen_at >= utcnow() - timedelta(seconds=OFFLINE_AFTER_SECONDS)))
    return dict(status='online' if age <= OFFLINE_AFTER_SECONDS else 'offline',
                last_seen_at=latest.seen_at.isoformat(), age_seconds=round(age, 1), worker_count=fresh,
                offline_after_seconds=OFFLINE_AFTER_SECONDS)


@router.get('/live')
def live():
    return {'status': 'live'}


@router.get('/ready')
def ready(session: Session = Depends(db)):
    try:
        revision = session.execute(text('select version_num from alembic_version')).scalar_one()
        expected = schema_heads()
        if revision not in expected:
            raise ValueError('Unexpected schema')
    except Exception:
        raise Problem(503, 'not_ready', 'Database schema is not ready.')
    return {'status': 'ready', 'schema_revision': revision, 'worker': worker_status(session)['status']}


@router.get('/worker')
def worker(session: Session = Depends(db)):
    try:
        return worker_status(session)
    except Exception:
        raise Problem(503, 'not_ready', 'Worker status is unavailable.')


@router.get('/version')
def version(request: Request):
    return {'commit_sha': commit_sha(), 'api_version': request.app.version,
            'environment': request.app.state.settings.environment}
