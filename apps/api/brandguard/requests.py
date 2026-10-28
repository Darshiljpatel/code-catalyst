"""Guideline improvement requests, peer review and comparison runs (Improvement 3).

A recurring dispute becomes a tracked request. The manager labels examples, drafts a
clearer rule as a new draft source version, runs the live and proposed rules over the
brand's saved examples, and a second authorised member approves the exact draft before
activation hands over to the Improvement 1 re-review inbox.
"""
import json
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Literal
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from .core import db, identity, manager, Problem, digest
from .evaluation import evaluate_many
from .impact import rule_diff
from .models import (GuidelineRequest, RequestExample, ExampleSet, ExampleCase, ComparisonRun, ComparisonResult,
                     RequestReview, SourceVersion, Finding, FindingResolution, ContentRevision, ContentItem,
                     ReviewRun, AuditEvent, Membership)
from .review import brand_for, revision_for, audit, eligible_sources
from .schemas import StrictInput, RationaleInput, RuleInput, SourceInput, SourceOut

router = APIRouter(prefix='/api/v1')
DISPUTE_ACTIONS = ('request_exception', 'request_dismissal', 'dismiss', 'grant_exception')
UNCLEAR_THRESHOLD = 3
WINDOW_DAYS = 30
CLOSED = ('activated', 'withdrawn')


def utcnow():
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Contracts
# ---------------------------------------------------------------------------

class RequestInput(StrictInput):
    brand_id: str = Field(min_length=1, max_length=36)
    source_id: str = Field(min_length=1, max_length=36)
    rule_id: str | None = Field(default=None, min_length=1, max_length=100)
    ambiguity_report_id: str | None = Field(default=None, min_length=1, max_length=36)
    title: str = Field(min_length=3, max_length=200)
    problem: str = Field(min_length=10, max_length=4000)


class ExampleLabel(StrictInput):
    example_id: str = Field(min_length=1, max_length=36)
    expected: Literal['flag', 'no_flag', 'unsure']


class RequestPatch(StrictInput):
    expected_version: int = Field(ge=1)
    labels: list[ExampleLabel] = Field(default_factory=list, max_length=200)
    assignee_id: str | None = Field(default=None, min_length=1, max_length=36)
    status: Literal['in_review', 'withdrawn'] | None = None


class DraftInput(StrictInput):
    expected_version: int = Field(ge=1)
    title: str = Field(min_length=1, max_length=200)
    text: str = Field(min_length=1, max_length=100000)
    rules: list[RuleInput] = Field(min_length=1, max_length=100)


class ReviewInput(RationaleInput):
    decision: Literal['approved', 'changes_requested', 'rejected']
    comparison_run_id: str | None = Field(default=None, min_length=1, max_length=36)


class CaseExpectation(StrictInput):
    source_key: str = Field(pattern=r'^[A-Za-z0-9_-]{1,100}$')
    rule_id: str = Field(min_length=1, max_length=100)
    expected: Literal['flag', 'no_flag']


class CaseInput(StrictInput):
    label: str = Field(min_length=1, max_length=200)
    text: str | None = Field(default=None, min_length=1, max_length=20000)
    revision_id: str | None = Field(default=None, min_length=1, max_length=36)
    channel: str = Field(default='example', min_length=1, max_length=100)
    audience: str = Field(default='example', min_length=1, max_length=300)
    purpose: str = Field(default='example', min_length=1, max_length=500)
    expectations: list[CaseExpectation] = Field(default_factory=list, max_length=20)


class RuleHealthOut(BaseModel):
    source_id: str
    source_key: str
    source_title: str
    rule_id: str
    category: str
    kind: str
    value: str
    flagged_items: int
    confirmed_items: int
    disputed_items: int
    ambiguity_reports: int
    dispute_rate: float | None
    likely_unclear: bool
    open_request_id: str | None


class GuidelineHealthOut(BaseModel):
    brand_id: str
    window_days: int
    unclear_threshold: int
    dispute_definition: str
    rules: list[RuleHealthOut]
    open_requests: list[dict]


class RequestSummaryOut(BaseModel):
    id: str
    brand_id: str
    source_key: str
    rule_id: str | None
    title: str
    status: str
    created_by: str
    assignee_id: str | None
    created_at: datetime
    updated_at: datetime
    example_count: int


class RequestOut(RequestSummaryOut):
    problem: str
    base_source_id: str
    draft_source_id: str | None
    draft_hash: str | None
    change_id: str | None
    version: int
    signals: dict
    examples: list[dict]
    base_source: SourceOut
    draft_source: SourceOut | None
    diff: dict | None
    comparisons: list[dict]
    reviews: list[dict]
    activity: list[dict]
    gates: dict


class ComparisonOut(BaseModel):
    id: str
    request_id: str
    proposed_source_id: str
    proposed_hash: str
    example_set_id: str
    status: str
    current: bool
    summary: dict
    created_by: str
    created_at: datetime


class ExampleSetOut(BaseModel):
    id: str
    brand_id: str
    name: str
    cases: list[dict]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def request_for(session, member, request_id, lock=False):
    query = select(GuidelineRequest).where(GuidelineRequest.org_id == member.org_id, GuidelineRequest.id == request_id)
    found = session.scalar(query.with_for_update() if lock else query)
    if found is None:
        raise Problem(404, 'not_found', 'Improvement request not found.')
    return found


def source_for(session, member, source_id):
    source = session.scalar(select(SourceVersion).where(SourceVersion.org_id == member.org_id, SourceVersion.id == source_id))
    if source is None:
        raise Problem(404, 'not_found', 'Source not found.')
    return source


def draft_hash(source):
    return digest(json.dumps(dict(text=source.text, rules=source.rules, title=source.title), sort_keys=True))


def expect_version(found, expected):
    if found.version != expected:
        raise Problem(409, 'request_changed', 'This request changed. Reload before continuing.')


def default_set(session, member, brand_id, create=False):
    found = session.scalar(select(ExampleSet).where(ExampleSet.org_id == member.org_id, ExampleSet.brand_id == brand_id)
                           .order_by(ExampleSet.created_at).limit(1))
    if found is None and create:
        found = ExampleSet(org_id=member.org_id, brand_id=brand_id, name='Saved examples', created_by=member.id, created_at=utcnow())
        session.add(found); session.flush()
    return found


def latest_comparison(session, found):
    if not found.draft_hash:
        return None
    return session.scalar(select(ComparisonRun).where(ComparisonRun.request_id == found.id,
        ComparisonRun.proposed_hash == found.draft_hash, ComparisonRun.status == 'complete').order_by(
        ComparisonRun.created_at.desc(), ComparisonRun.id.desc()).limit(1))


def gates(session, found):
    """Activation unlocks only when approval and comparison both match the exact current draft."""
    draft = session.get(SourceVersion, found.draft_source_id) if found.draft_source_id else None
    base = session.get(SourceVersion, found.base_source_id)
    comparison = latest_comparison(session, found)
    review = session.scalar(select(RequestReview).where(RequestReview.request_id == found.id).order_by(
        RequestReview.created_at.desc(), RequestReview.id.desc()).limit(1))
    approval_current = bool(review and review.decision == 'approved' and found.draft_hash
                            and review.draft_hash == found.draft_hash and comparison
                            and review.comparison_run_id == comparison.id)
    regressions = comparison.summary['counts'].get('regressed', 0) if comparison else 0
    base_changed = base.state != 'active'
    return dict(has_draft=bool(draft and draft.state == 'draft'), comparison_current=comparison is not None,
                comparison_run_id=comparison.id if comparison else None, approval_current=approval_current,
                regressions=regressions, base_changed=base_changed,
                can_activate=bool(draft and draft.state == 'draft' and comparison and approval_current and not base_changed
                                  and found.status not in CLOSED))


def require_peer_review(session, member, source, acknowledgement):
    """Called from activate_source. A request-linked draft needs a current approval and comparison."""
    found = session.scalar(select(GuidelineRequest).where(GuidelineRequest.org_id == member.org_id,
        GuidelineRequest.draft_source_id == source.id).with_for_update())
    if found is None:
        return None
    if found.status in CLOSED:
        raise Problem(409, 'request_closed', 'This improvement request was withdrawn or already activated.')
    state = gates(session, found)
    if state['base_changed']:
        raise Problem(409, 'base_changed', 'The live guideline changed while this request was open. Rebase the draft.')
    if not (state['comparison_current'] and state['approval_current']):
        raise Problem(409, 'peer_review_required',
                      'Run the comparison on this exact draft and get approval from another manager or admin first.')
    if state['regressions'] and not (acknowledgement and len(acknowledgement.strip()) >= 10):
        raise Problem(409, 'regression_unacknowledged', 'The comparison found regressions. Acknowledge them with a reason.')
    return found


def mark_activated(session, member, found, change, acknowledgement):
    found.status, found.change_id, found.updated_at = 'activated', change.id, utcnow()
    found.version += 1
    audit(session, member, 'guideline_request.activated', found.id, change_id=change.id,
          regression_acknowledgement=acknowledgement)


def finding_summary(f, keys):
    return dict(source_key=keys.get(f['source_version_id']), rule_id=f['rule_id'], category=f['category'],
                severity=f['severity'], quote=f.get('content_quote', ''), start=f['start'], end=f['end'])


def flags(findings, expectation):
    return any(f['rule_id'] == expectation['rule_id'] and f['source_key'] == expectation['source_key'] for f in findings)


def case_verdict(case, live, proposed):
    if any(c['status'] == 'failed' for c in live['checks'] + proposed['checks']):
        return 'not_run', 0, 0
    live_f, prop_f = live['summaries'], proposed['summaries']
    if not case.expectations:
        same = sorted(map(lambda f: (f['rule_id'], f['start'], f['end']), live_f)) == sorted(
            map(lambda f: (f['rule_id'], f['start'], f['end']), prop_f))
        return ('unchanged' if same else 'changed'), 0, 0
    live_wrong = sum(flags(live_f, e) != (e['expected'] == 'flag') for e in case.expectations)
    prop_wrong = sum(flags(prop_f, e) != (e['expected'] == 'flag') for e in case.expectations)
    verdict = 'fixed' if prop_wrong < live_wrong else 'regressed' if prop_wrong > live_wrong else 'unchanged'
    return verdict, live_wrong, prop_wrong


def precision_recall(cases, side):
    tp = fp = fn = 0
    for case in cases:
        for e in case['expectations']:
            flagged = flags(case[side], e)
            if flagged and e['expected'] == 'flag': tp += 1
            elif flagged: fp += 1
            elif e['expected'] == 'flag': fn += 1
    return dict(true_positives=tp, false_positives=fp, false_negatives=fn,
                precision=round(tp / (tp + fp), 3) if tp + fp else None,
                recall=round(tp / (tp + fn), 3) if tp + fn else None)


def verdict_text(counts):
    fixed, regressed, unstable = counts.get('fixed', 0), counts.get('regressed', 0), counts.get('unstable', 0)
    return (f"Fixes {fixed} example{'s' if fixed != 1 else ''}, {regressed} regression{'s' if regressed != 1 else ''}, "
            f"{unstable} unstable case{'s' if unstable != 1 else ''}.")


def comparison_out(session, run, found=None):
    found = found or session.get(GuidelineRequest, run.request_id)
    return ComparisonOut(id=run.id, request_id=run.request_id, proposed_source_id=run.proposed_source_id,
        proposed_hash=run.proposed_hash, example_set_id=run.example_set_id, status=run.status,
        current=run.proposed_hash == found.draft_hash, summary=run.summary, created_by=run.created_by,
        created_at=run.created_at)


def request_out(session, member, found):
    base = session.get(SourceVersion, found.base_source_id)
    draft = session.get(SourceVersion, found.draft_source_id) if found.draft_source_id else None
    examples = list(session.scalars(select(RequestExample).where(RequestExample.request_id == found.id).order_by(
        RequestExample.created_at, RequestExample.id)))
    comparisons = list(session.scalars(select(ComparisonRun).where(ComparisonRun.request_id == found.id).order_by(
        ComparisonRun.created_at.desc()).limit(5)))
    reviews = list(session.scalars(select(RequestReview).where(RequestReview.request_id == found.id).order_by(
        RequestReview.created_at)))
    activity = list(session.scalars(select(AuditEvent).where(AuditEvent.org_id == member.org_id,
        AuditEvent.object_id == found.id).order_by(AuditEvent.created_at)))
    return RequestOut(id=found.id, brand_id=found.brand_id, source_key=found.source_key, rule_id=found.rule_id,
        title=found.title, status=found.status, created_by=found.created_by, assignee_id=found.assignee_id,
        created_at=found.created_at, updated_at=found.updated_at, example_count=len(examples), problem=found.problem,
        base_source_id=found.base_source_id, draft_source_id=found.draft_source_id, draft_hash=found.draft_hash,
        change_id=found.change_id, version=found.version, signals=found.signals,
        examples=[dict(id=e.id, item_id=e.item_id, revision_id=e.revision_id, finding_id=e.finding_id, kind=e.kind,
                       excerpt=e.excerpt, dispute=e.dispute, expected=e.expected, labelled_by=e.labelled_by,
                       redacted_at=e.redacted_at) for e in examples],
        base_source=SourceOut.model_validate(base), draft_source=SourceOut.model_validate(draft) if draft else None,
        diff=rule_diff(base, draft) if draft else None,
        comparisons=[comparison_out(session, c, found).model_dump(mode='json') for c in comparisons],
        reviews=[dict(id=r.id, reviewer_id=r.reviewer_id, decision=r.decision, rationale=r.rationale,
                      draft_hash=r.draft_hash, comparison_run_id=r.comparison_run_id, current=r.draft_hash == found.draft_hash,
                      created_at=r.created_at.isoformat()) for r in reviews],
        activity=[dict(action=a.action, actor_id=a.actor_id, created_at=a.created_at.isoformat(), details=a.details)
                  for a in activity],
        gates=gates(session, found))


def disputes(session, member, brand_id, since=None):
    """Latest dispute per (campaign, guideline key, rule), joined to the finding and revision."""
    query = select(FindingResolution, Finding, ContentRevision, SourceVersion.source_key).join(
        Finding, FindingResolution.finding_id == Finding.id).join(
        ContentRevision, Finding.revision_id == ContentRevision.id).join(
        ContentItem, ContentRevision.item_id == ContentItem.id).join(
        SourceVersion, Finding.source_version_id == SourceVersion.id).where(
        FindingResolution.org_id == member.org_id, ContentItem.brand_id == brand_id,
        FindingResolution.action.in_(DISPUTE_ACTIONS)).order_by(FindingResolution.created_at)
    if since is not None:
        query = query.where(FindingResolution.created_at >= since)
    latest = {}
    for entry, finding, revision, key in session.execute(query):
        latest[(revision.item_id, key, finding.rule_id)] = (entry, finding, revision, key)
    return latest


# ---------------------------------------------------------------------------
# Guideline health
# ---------------------------------------------------------------------------

@router.get('/brands/{brand_id}/guideline-health', response_model=GuidelineHealthOut)
def guideline_health(brand_id: str, member=Depends(manager), session: Session = Depends(db)):
    brand_for(session, member, brand_id)
    since = utcnow() - timedelta(days=WINDOW_DAYS)
    disputed = defaultdict(set)
    for (item_id, key, rule_id) in disputes(session, member, brand_id, since):
        disputed[(key, rule_id)].add(item_id)
    flagged, confirmed = defaultdict(set), defaultdict(set)
    for item_id, key, rule_id in session.execute(select(ContentRevision.item_id, SourceVersion.source_key, Finding.rule_id).join(
            Finding, Finding.revision_id == ContentRevision.id).join(ReviewRun, ReviewRun.id == Finding.run_id).join(
            SourceVersion, SourceVersion.id == Finding.source_version_id).where(Finding.org_id == member.org_id,
            SourceVersion.brand_id == brand_id, ReviewRun.created_at >= since)):
        flagged[(key, rule_id)].add(item_id)
    for item_id, key, rule_id in session.execute(select(ContentRevision.item_id, SourceVersion.source_key, Finding.rule_id).join(
            Finding, Finding.revision_id == ContentRevision.id).join(FindingResolution, FindingResolution.finding_id == Finding.id).join(
            SourceVersion, SourceVersion.id == Finding.source_version_id).where(Finding.org_id == member.org_id,
            SourceVersion.brand_id == brand_id, FindingResolution.action == 'confirm', FindingResolution.created_at >= since)):
        confirmed[(key, rule_id)].add(item_id)
    reports = defaultdict(set)
    for event, key in session.execute(select(AuditEvent, SourceVersion.source_key).join(
            SourceVersion, AuditEvent.object_id == SourceVersion.id).where(AuditEvent.org_id == member.org_id,
            AuditEvent.action == 'source.ambiguity_reported', SourceVersion.brand_id == brand_id)):
        reports[(key, event.details.get('rule_id'))].add((event.actor_id, event.details.get('revision_id')))
    open_requests = list(session.scalars(select(GuidelineRequest).where(GuidelineRequest.org_id == member.org_id,
        GuidelineRequest.brand_id == brand_id, GuidelineRequest.status.notin_(CLOSED)).order_by(GuidelineRequest.created_at.desc())))
    by_rule = {(r.source_key, r.rule_id): r.id for r in open_requests}
    rows = []
    for source in eligible_sources(session, member, brand_id, utcnow()):
        for rule in source.rules:
            key = (source.source_key, rule['id'])
            n_flagged, n_disputed = len(flagged[key] | disputed[key]), len(disputed[key])
            rows.append(RuleHealthOut(source_id=source.id, source_key=source.source_key, source_title=source.title,
                rule_id=rule['id'], category=rule['category'], kind=rule['kind'], value=rule['value'],
                flagged_items=n_flagged, confirmed_items=len(confirmed[key]), disputed_items=n_disputed,
                ambiguity_reports=len(reports[key]), dispute_rate=round(n_disputed / n_flagged, 3) if n_flagged else None,
                likely_unclear=n_disputed >= UNCLEAR_THRESHOLD, open_request_id=by_rule.get(key)))
    rows.sort(key=lambda r: (not r.likely_unclear, -(r.dispute_rate or 0), r.source_key, r.rule_id))
    return GuidelineHealthOut(brand_id=brand_id, window_days=WINDOW_DAYS, unclear_threshold=UNCLEAR_THRESHOLD,
        dispute_definition=('A creator dismissal or exception request, or a reviewer dismissal or granted exception, '
                            f'counted once per campaign in the last {WINDOW_DAYS} days.'),
        rules=rows, open_requests=[dict(id=r.id, title=r.title, rule_id=r.rule_id, source_key=r.source_key,
                                        status=r.status) for r in open_requests])


# ---------------------------------------------------------------------------
# Requests
# ---------------------------------------------------------------------------

@router.post('/guideline-requests', status_code=201, response_model=RequestOut)
def create_request(body: RequestInput, member=Depends(manager), session: Session = Depends(db)):
    brand_for(session, member, body.brand_id)
    source = source_for(session, member, body.source_id)
    if source.brand_id != body.brand_id or source.state != 'active':
        raise Problem(422, 'invalid_source', 'Choose an active guideline of this brand.')
    if body.rule_id is not None and body.rule_id not in {r['id'] for r in source.rules}:
        raise Problem(422, 'invalid_rule', 'Choose a rule from this guideline.')
    at = utcnow()
    found = GuidelineRequest(org_id=member.org_id, brand_id=body.brand_id, source_key=source.source_key,
        base_source_id=source.id, rule_id=body.rule_id, title=body.title.strip(), problem=body.problem.strip(),
        status='open', signals={}, created_by=member.id, version=1, created_at=at, updated_at=at)
    session.add(found); session.flush()
    examples = 0
    if body.rule_id:
        for (item_id, key, rule_id), (entry, finding, revision, _) in disputes(session, member, body.brand_id).items():
            if key != source.source_key or rule_id != body.rule_id:
                continue
            run = session.get(ReviewRun, finding.run_id)
            session.add(RequestExample(org_id=member.org_id, request_id=found.id, item_id=item_id, revision_id=revision.id,
                finding_id=finding.id, kind='dispute', excerpt=finding.location.get('quote', ''), text=revision.text,
                context=dict(channel=revision.channel, audience=revision.audience, purpose=revision.purpose),
                dispute=dict(actor_id=entry.actor_id, action=entry.action, rationale=entry.rationale),
                expected='unsure', external_ok=bool(run.processing_snapshot.get('consent')), created_at=at))
            examples += 1
    if body.ambiguity_report_id:
        report = session.scalar(select(AuditEvent).where(AuditEvent.org_id == member.org_id,
            AuditEvent.id == body.ambiguity_report_id, AuditEvent.action == 'source.ambiguity_reported'))
        if report is None:
            raise Problem(404, 'not_found', 'Ambiguity report not found.')
        revision = session.get(ContentRevision, report.details['revision_id']) if report.details.get('revision_id') else None
        session.add(RequestExample(org_id=member.org_id, request_id=found.id, item_id=revision.item_id if revision else None,
            revision_id=revision.id if revision else None, kind='ambiguity', excerpt=(revision.text[:300] if revision else ''),
            text=revision.text if revision else '', context=dict(channel=revision.channel, audience=revision.audience,
            purpose=revision.purpose) if revision else {}, dispute=dict(actor_id=report.actor_id, action='ambiguity_report',
            rationale=report.details.get('rationale', '')), expected='unsure', created_at=at))
        examples += 1
    found.signals = dict(linked_examples=examples, created_from='ambiguity_report' if body.ambiguity_report_id else 'rule')
    audit(session, member, 'guideline_request.created', found.id, rule_id=body.rule_id, source_id=source.id, examples=examples)
    session.commit()
    return request_out(session, member, found)


@router.get('/guideline-requests', response_model=list[RequestSummaryOut])
def list_requests(brand_id: str | None = None, member=Depends(manager), session: Session = Depends(db)):
    conditions = [GuidelineRequest.org_id == member.org_id]
    if brand_id:
        conditions.append(GuidelineRequest.brand_id == brand_id)
    rows = list(session.scalars(select(GuidelineRequest).where(*conditions).order_by(GuidelineRequest.created_at.desc()).limit(100)))
    counts = dict(session.execute(select(RequestExample.request_id, func.count()).where(
        RequestExample.request_id.in_([r.id for r in rows])).group_by(RequestExample.request_id)).all()) if rows else {}
    return [RequestSummaryOut(id=r.id, brand_id=r.brand_id, source_key=r.source_key, rule_id=r.rule_id, title=r.title,
        status=r.status, created_by=r.created_by, assignee_id=r.assignee_id, created_at=r.created_at,
        updated_at=r.updated_at, example_count=counts.get(r.id, 0)) for r in rows]


@router.get('/guideline-requests/{request_id}', response_model=RequestOut)
def get_request(request_id: str, member=Depends(identity), session: Session = Depends(db)):
    if member.role not in ('manager', 'admin'):
        raise Problem(403, 'forbidden', 'A manager or admin is required.')
    return request_out(session, member, request_for(session, member, request_id))


@router.patch('/guideline-requests/{request_id}', response_model=RequestOut)
def update_request(request_id: str, body: RequestPatch, member=Depends(manager), session: Session = Depends(db)):
    found = request_for(session, member, request_id, lock=True)
    expect_version(found, body.expected_version)
    if found.status in CLOSED:
        raise Problem(409, 'request_closed', 'This request is closed.')
    if body.labels:
        examples = {e.id: e for e in session.scalars(select(RequestExample).where(RequestExample.request_id == found.id))}
        for label in body.labels:
            if label.example_id not in examples:
                raise Problem(422, 'invalid_example', 'Label examples of this request only.')
            examples[label.example_id].expected, examples[label.example_id].labelled_by = label.expected, member.id
    if body.assignee_id is not None:
        assignee = session.scalar(select(Membership).where(Membership.org_id == member.org_id,
            Membership.id == body.assignee_id, Membership.role.in_(('manager', 'admin'))))
        if assignee is None or assignee.id == found.created_by:
            raise Problem(422, 'invalid_reviewer', 'Ask another manager or an admin to review.')
        found.assignee_id = assignee.id
    if body.status == 'in_review':
        if not found.draft_source_id:
            raise Problem(409, 'draft_required', 'Draft the clearer rule before asking for review.')
        found.status = 'in_review'
    elif body.status == 'withdrawn':
        found.status = 'withdrawn'
    found.version += 1
    found.updated_at = utcnow()
    audit(session, member, 'guideline_request.updated', found.id, labels=len(body.labels), assignee_id=body.assignee_id,
          status=body.status)
    session.commit()
    return request_out(session, member, found)


@router.put('/guideline-requests/{request_id}/draft', response_model=RequestOut)
def save_draft(request_id: str, body: DraftInput, member=Depends(manager), session: Session = Depends(db)):
    found = request_for(session, member, request_id, lock=True)
    expect_version(found, body.expected_version)
    if found.status in CLOSED:
        raise Problem(409, 'request_closed', 'This request is closed.')
    brand_for(session, member, found.brand_id, lock=True)
    base = session.get(SourceVersion, found.base_source_id)
    try:
        checked = SourceInput(source_key=found.source_key, title=body.title, text=body.text, rules=body.rules,
                              valid_from=base.valid_from, valid_until=base.valid_until)
    except ValueError:
        raise Problem(422, 'invalid_fields', 'Every rule needs evidence quoted exactly from the guideline text.')
    previous = session.scalar(select(SourceVersion).where(SourceVersion.org_id == member.org_id,
        SourceVersion.brand_id == found.brand_id, SourceVersion.source_key == found.source_key
    ).order_by(SourceVersion.version.desc()).limit(1))
    at = utcnow()
    # Source versions are immutable; each edit is a new draft version and the old draft is retired.
    draft = SourceVersion(org_id=member.org_id, brand_id=found.brand_id, source_key=found.source_key,
        version=previous.version + 1, owner_id=member.id, title=checked.title, text=checked.text,
        text_hash=digest(checked.text), rules=[r.model_dump(exclude_none=True) for r in checked.rules],
        valid_from=checked.valid_from, valid_until=checked.valid_until, state='draft', created_at=at)
    session.add(draft); session.flush()
    if found.draft_source_id:
        old = session.get(SourceVersion, found.draft_source_id)
        if old.state == 'draft':
            old.state = 'retired'
    found.draft_source_id, found.draft_hash = draft.id, draft_hash(draft)
    # Editing the draft invalidates any approval and comparison bound to the previous hash.
    if found.status in ('approved', 'changes_requested', 'in_review'):
        found.status = 'open'
    found.version += 1
    found.updated_at = at
    audit(session, member, 'guideline_request.drafted', found.id, draft_source_id=draft.id, draft_hash=found.draft_hash)
    session.commit()
    return request_out(session, member, found)


@router.post('/guideline-requests/{request_id}/example-set', response_model=ExampleSetOut)
def save_examples(request_id: str, member=Depends(manager), session: Session = Depends(db)):
    """One click: labelled examples of this request join the brand's saved example set."""
    found = request_for(session, member, request_id, lock=True)
    target = default_set(session, member, found.brand_id, create=True)
    existing = {(c.origin_revision_id, json.dumps(c.expectations, sort_keys=True)) for c in session.scalars(
        select(ExampleCase).where(ExampleCase.set_id == target.id))}
    added = 0
    for example in session.scalars(select(RequestExample).where(RequestExample.request_id == found.id,
            RequestExample.expected != 'unsure')):
        if not example.text or not found.rule_id:
            continue
        expectations = [dict(source_key=found.source_key, rule_id=found.rule_id, expected=example.expected)]
        if (example.revision_id, json.dumps(expectations, sort_keys=True)) in existing:
            continue
        session.add(ExampleCase(org_id=member.org_id, set_id=target.id, label=f'{example.kind.title()}: {example.excerpt[:120] or "example"}',
            text=example.text, context=example.context, expectations=expectations, origin_revision_id=example.revision_id,
            external_ok=example.external_ok, author_id=member.id, created_at=utcnow()))
        added += 1
    audit(session, member, 'example_set.cases_added', target.id, request_id=found.id, added=added)
    session.commit()
    return example_set_out(session, target)


def example_set_out(session, target):
    cases = list(session.scalars(select(ExampleCase).where(ExampleCase.set_id == target.id).order_by(ExampleCase.created_at, ExampleCase.id)))
    return ExampleSetOut(id=target.id, brand_id=target.brand_id, name=target.name,
        cases=[dict(id=c.id, label=c.label, text=c.text, expectations=c.expectations, origin_revision_id=c.origin_revision_id,
                    external_ok=c.external_ok) for c in cases])


@router.get('/brands/{brand_id}/example-sets', response_model=list[ExampleSetOut])
def list_example_sets(brand_id: str, member=Depends(manager), session: Session = Depends(db)):
    brand_for(session, member, brand_id)
    return [example_set_out(session, s) for s in session.scalars(select(ExampleSet).where(
        ExampleSet.org_id == member.org_id, ExampleSet.brand_id == brand_id).order_by(ExampleSet.created_at))]


@router.post('/brands/{brand_id}/example-sets/default', response_model=ExampleSetOut)
def ensure_example_set(brand_id: str, member=Depends(manager), session: Session = Depends(db)):
    brand_for(session, member, brand_id)
    target = default_set(session, member, brand_id, create=True)
    session.commit()
    return example_set_out(session, target)


@router.post('/example-sets/{set_id}/cases', status_code=201, response_model=ExampleSetOut)
def add_case(set_id: str, body: CaseInput, member=Depends(manager), session: Session = Depends(db)):
    target = session.scalar(select(ExampleSet).where(ExampleSet.org_id == member.org_id, ExampleSet.id == set_id).with_for_update())
    if target is None:
        raise Problem(404, 'not_found', 'Example set not found.')
    if (body.text is None) == (body.revision_id is None):
        raise Problem(422, 'invalid_fields', 'Write the example text or choose a campaign revision.')
    external_ok, context, text = True, dict(channel=body.channel, audience=body.audience, purpose=body.purpose), body.text
    if body.revision_id:
        revision, item = revision_for(session, member, body.revision_id)
        if item.brand_id != target.brand_id:
            raise Problem(422, 'invalid_context', 'The campaign belongs to another brand.')
        text, context = revision.text, dict(channel=revision.channel, audience=revision.audience, purpose=revision.purpose)
        # Copied campaign text may reach AI later only if its creator consented for that revision.
        external_ok = bool(session.scalar(select(func.count()).select_from(ReviewRun).where(ReviewRun.revision_id == revision.id,
            ReviewRun.processing_snapshot['consent'].as_boolean() == True)))
    session.add(ExampleCase(org_id=member.org_id, set_id=target.id, label=body.label.strip(), text=text, context=context,
        expectations=[e.model_dump() for e in body.expectations], origin_revision_id=body.revision_id,
        external_ok=external_ok, author_id=member.id, created_at=utcnow()))
    audit(session, member, 'example_set.case_added', target.id, revision_id=body.revision_id)
    session.commit()
    return example_set_out(session, target)


@router.post('/guideline-requests/{request_id}/comparisons', status_code=201, response_model=ComparisonOut)
def run_comparison(request_id: str, member=Depends(manager), session: Session = Depends(db)):
    """Evaluate every saved case under the live and the proposed rules with the local engine."""
    found = request_for(session, member, request_id, lock=True)
    if found.status in CLOSED:
        raise Problem(409, 'request_closed', 'This request is closed.')
    draft = session.get(SourceVersion, found.draft_source_id) if found.draft_source_id else None
    if draft is None or draft.state != 'draft':
        raise Problem(409, 'draft_required', 'Draft the clearer rule before running a comparison.')
    target = default_set(session, member, found.brand_id)
    cases = list(session.scalars(select(ExampleCase).where(ExampleCase.set_id == target.id).order_by(
        ExampleCase.created_at, ExampleCase.id))) if target else []
    if not cases:
        raise Problem(409, 'empty_example_set', 'Save at least one example to the brand example set first.')
    live = [SourceOut.model_validate(s).model_dump(mode='json') for s in eligible_sources(session, member, found.brand_id, utcnow())]
    proposed = [s for s in live if s['source_key'] != found.source_key] + [SourceOut.model_validate(draft).model_dump(mode='json')]
    inputs = [dict(text=c.text, context=c.context) for c in cases]
    live_results, proposed_results = evaluate_many(inputs, live), evaluate_many(inputs, proposed)
    live_keys = {s['id']: s['source_key'] for s in live}
    proposed_keys = {s['id']: s['source_key'] for s in proposed}
    at = utcnow()
    run = ComparisonRun(org_id=member.org_id, request_id=found.id, baseline_source_ids=sorted(live_keys),
        proposed_source_id=draft.id, proposed_hash=found.draft_hash, example_set_id=target.id, status='complete',
        summary={}, created_by=member.id, created_at=at)
    session.add(run); session.flush()
    rows, counts = [], defaultdict(int)
    for case, before, after in zip(cases, live_results, proposed_results):
        before['summaries'] = [finding_summary(f, live_keys) for f in before['findings']]
        after['summaries'] = [finding_summary(f, proposed_keys) for f in after['findings']]
        verdict, live_wrong, proposed_wrong = case_verdict(case, before, after)
        counts[verdict] += 1
        for side, result in (('live', before), ('proposed', after)):
            session.add(ComparisonResult(org_id=member.org_id, run_id=run.id, case_id=case.id, side=side, attempt=1,
                findings=result['summaries'], checks=result['checks']))
        rows.append(dict(case_id=case.id, label=case.label, text=case.text[:500], expectations=case.expectations,
            live=before['summaries'], proposed=after['summaries'], verdict=verdict))
    counts = {k: counts.get(k, 0) for k in ('fixed', 'regressed', 'unchanged', 'unstable', 'changed', 'not_run')}
    run.summary = dict(counts=counts, verdict=verdict_text(counts), cases=rows,
        live_metrics=precision_recall(rows, 'live'), proposed_metrics=precision_recall(rows, 'proposed'),
        ai=dict(status='not_run', reason='AI comparison is not enabled; local checks only, so results are repeatable.'))
    audit(session, member, 'guideline_request.compared', found.id, comparison_run_id=run.id, counts=counts)
    found.updated_at = at
    session.commit()
    return comparison_out(session, run, found)


@router.get('/comparisons/{comparison_id}', response_model=ComparisonOut)
def get_comparison(comparison_id: str, member=Depends(manager), session: Session = Depends(db)):
    run = session.scalar(select(ComparisonRun).where(ComparisonRun.org_id == member.org_id, ComparisonRun.id == comparison_id))
    if run is None:
        raise Problem(404, 'not_found', 'Comparison not found.')
    return comparison_out(session, run)


@router.post('/guideline-requests/{request_id}/reviews', status_code=201, response_model=RequestOut)
def review_request(request_id: str, body: ReviewInput, member=Depends(identity), session: Session = Depends(db)):
    """Four eyes: another manager or an admin approves the exact draft and comparison."""
    if member.role not in ('manager', 'admin'):
        raise Problem(403, 'forbidden', 'A manager or admin is required.')
    found = request_for(session, member, request_id, lock=True)
    if found.status in CLOSED:
        raise Problem(409, 'request_closed', 'This request is closed.')
    draft = session.get(SourceVersion, found.draft_source_id) if found.draft_source_id else None
    if draft is None:
        raise Problem(409, 'draft_required', 'There is no draft to review yet.')
    if member.id in (found.created_by, draft.owner_id):
        raise Problem(403, 'separate_reviewer_required', 'The person who drafted this rule cannot approve it.')
    comparison = latest_comparison(session, found)
    if body.decision == 'approved' and (comparison is None or body.comparison_run_id != comparison.id):
        raise Problem(409, 'comparison_required', 'Approve against the latest comparison of the current draft.')
    session.add(RequestReview(org_id=member.org_id, request_id=found.id, reviewer_id=member.id, decision=body.decision,
        rationale=body.rationale, draft_hash=found.draft_hash, comparison_run_id=comparison.id if comparison else None,
        created_at=utcnow()))
    found.status = {'approved': 'approved', 'changes_requested': 'changes_requested', 'rejected': 'withdrawn'}[body.decision]
    found.version += 1
    found.updated_at = utcnow()
    audit(session, member, 'guideline_request.' + body.decision, found.id, draft_hash=found.draft_hash,
          comparison_run_id=comparison.id if comparison else None, rationale=body.rationale)
    session.commit()
    return request_out(session, member, found)
