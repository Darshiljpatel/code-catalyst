"""Per-member hourly caps on drafting, analysis and uploads, counted from the rows each action already writes."""
from datetime import datetime, timedelta, timezone
from sqlalchemy import select, func
from .core import Problem
from .models import ContentRevision, ReviewRun, Asset, DocumentImport

# Generous for real work and demos; they only stop a runaway script or a shared demo account being hammered.
HOURLY_LIMITS = dict(revisions=200, analysis=200, uploads=60)
MESSAGES = dict(
    revisions='You have saved many drafts in the last hour. Wait a few minutes and try again.',
    analysis='You have started many checks in the last hour. Wait a few minutes and try again.',
    uploads='You have uploaded many files in the last hour. Wait a few minutes and try again.',
)


def used(session, member, bucket, since):
    def count(model, column):
        return session.scalar(select(func.count()).select_from(model).where(
            model.org_id == member.org_id, column == member.id, model.created_at >= since))
    if bucket == 'revisions':
        return count(ContentRevision, ContentRevision.author_id)
    if bucket == 'analysis':
        return count(ReviewRun, ReviewRun.initiated_by)
    return count(Asset, Asset.created_by) + count(DocumentImport, DocumentImport.created_by)


def enforce(session, member, bucket):
    since = datetime.now(timezone.utc) - timedelta(hours=1)
    if used(session, member, bucket, since) >= HOURLY_LIMITS[bucket]:
        raise Problem(429, 'member_rate_limited', MESSAGES[bucket])
