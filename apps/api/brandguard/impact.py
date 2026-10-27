"""Guideline change impact (Improvement 1): rule diff, affected campaigns and rechecks.

Every run records the exact source versions it used (run_sources), so finding the
campaigns that relied on a retired guideline version is a join, not a search. Impact
levels only sort the work: every listed campaign is rechecked and nothing is dropped.
"""
import re
from collections import defaultdict
from datetime import datetime, timezone
from sqlalchemy import select, func
from .evaluation import evaluate_many, compare
from .models import (ContentItem, ContentRevision, ReviewRun, RunSource, Finding, Decision, Job,
                     GuidelineChange, RecheckAssignment, ProcessingPolicy, AuditEvent)
from .schemas import SourceOut

RULE_FIELDS = ('category', 'kind', 'key', 'value', 'evidence_quote', 'allowed_variants', 'forbidden_variants')
LEVEL_ORDER = {'confirmed': 0, 'likely': 1, 'possible': 2}
OPEN_STATUSES = ('open', 'recheck_queued', 'awaiting_creator', 'awaiting_reviewer')
ON_HOLD_STATES = ('approved', 'in_review')
# Larger brands still list every candidate; only the local re-evaluation is skipped.
LOCAL_RECHECK_LIMIT = 500


def utcnow():
    return datetime.now(timezone.utc)


def source_dict(source):
    return SourceOut.model_validate(source).model_dump(mode='json')


def rule_diff(old_source, new_source, other_retired=()):
    """Compare rules by id across every rule field; rules of other retired sources are removed."""
    old = {r['id']: r for r in (old_source.rules if old_source else [])}
    new = {r['id']: r for r in new_source.rules}
    added = [dict(rule_id=i, after=new[i]) for i in new if i not in old]
    removed = [dict(rule_id=i, before=old[i], source_id=old_source.id) for i in old if i not in new]
    modified, unchanged = [], 0
    for rule_id in [i for i in new if i in old]:
        fields = [f for f in RULE_FIELDS if (old[rule_id].get(f) or None) != (new[rule_id].get(f) or None)]
        if fields:
            modified.append(dict(rule_id=rule_id, before=old[rule_id], after=new[rule_id], fields=fields))
        else:
            unchanged += 1
    for source in other_retired:
        removed.extend(dict(rule_id=r['id'], before=r, source_id=source.id) for r in source.rules)
    return dict(added=added, removed=removed, modified=modified, unchanged=unchanged,
                from_source=dict(id=old_source.id, version=old_source.version, title=old_source.title,
                                 text=old_source.text) if old_source else None,
                to_source=dict(id=new_source.id, version=new_source.version, title=new_source.title,
                               text=new_source.text),
                retired_sources=[dict(id=s.id, source_key=s.source_key, version=s.version, title=s.title)
                                 for s in other_retired])


def changed_rules(diff):
    """(source_id, rule_id) pairs whose old meaning no longer holds, plus all touched rules."""
    retired = {(e['source_id'], e['rule_id']) for e in diff['removed']}
    if diff['from_source']:
        retired |= {(diff['from_source']['id'], e['rule_id']) for e in diff['modified']}
    touched = [e['before'] for e in diff['removed']] + [e['before'] for e in diff['modified']]
    touched += [e['after'] for e in diff['modified']] + [e['after'] for e in diff['added']]
    return retired, touched


def subject_terms(rules):
    """Key words and old/new values a campaign would mention if a rule concerns it."""
    terms = set()
    for rule in rules:
        for part in re.split(r'[_\W]+', rule.get('key', '')):
            if len(part) >= 4:
                terms.add(part.casefold())
        value = rule.get('value', '')
        if len(value) <= 60:
            terms.add(value.casefold())
            terms.update(n for n in re.findall(r'\d+(?:\.\d+)?', value))
        for variant in (rule.get('allowed_variants') or []) + (rule.get('forbidden_variants') or []):
            terms.add(variant.casefold())
    return {t for t in terms if t.strip()}


def mentions(text, terms):
    folded = text.casefold()
    hits = []
    for term in sorted(terms):
        if term.isdigit() or re.fullmatch(r'\d+(?:\.\d+)?', term):
            if re.search(rf'(?<![\d.]){re.escape(term)}(?![\d])', folded):
                hits.append(term)
        elif re.search(rf'(?<!\w){re.escape(term)}(?!\w)', folded):
            hits.append(term)
    return hits


def latest_runs(session, org_id, brand_id):
    """Each analysed item's latest run on its current revision (one query per table)."""
    items = list(session.scalars(select(ContentItem).where(ContentItem.org_id == org_id, ContentItem.brand_id == brand_id)))
    if not items:
        return []
    revisions = {(r.item_id, r.number): r for r in session.scalars(select(ContentRevision).where(
        ContentRevision.org_id == org_id, ContentRevision.item_id.in_([i.id for i in items])))}
    current = {i.id: revisions.get((i.id, i.current_revision)) for i in items}
    runs = {}
    for run in session.scalars(select(ReviewRun).where(ReviewRun.org_id == org_id,
            ReviewRun.revision_id.in_([r.id for r in current.values() if r])).order_by(
            ReviewRun.created_at, ReviewRun.id)):
        # A pending recheck from an earlier change is replaced; impact is judged on the run before it.
        if run.trigger == 'guideline_change' and run.status in ('queued', 'running'):
            continue
        runs[run.revision_id] = run
    rows = []
    for item in items:
        revision = current[item.id]
        run = runs.get(revision.id) if revision else None
        if run is not None:
            rows.append((item, revision, run))
    return rows


def compute_impact(session, org_id, brand, source, retired_sources, new_sources):
    """Dry-run impact of activating `source`. Used by the preview and by activation itself,
    so the preview count always equals the inbox count."""
    same_key = next((s for s in retired_sources if s.source_key == source.source_key), None)
    others = [s for s in retired_sources if s is not same_key]
    diff = rule_diff(same_key, source, others)
    retired_ids = {s.id for s in retired_sources}
    retired_pairs, touched = changed_rules(diff)
    categories = {r['category'] for r in source.rules}
    terms = subject_terms(touched)
    rows = latest_runs(session, org_id, brand.id)
    used = defaultdict(set)
    if rows:
        for run_id, source_id in session.execute(select(RunSource.run_id, RunSource.source_id).where(
                RunSource.org_id == org_id, RunSource.run_id.in_([r.id for _, _, r in rows]))):
            used[run_id].add(source_id)
    pending = set(session.scalars(select(RecheckAssignment.item_id).where(RecheckAssignment.org_id == org_id,
        RecheckAssignment.status.in_(OPEN_STATUSES)))) if rows else set()
    candidates, not_affected = [], 0
    for item, revision, run in rows:
        if run.status in ('queued', 'running'):
            # The in-flight run snapshot is already stale and will finish as such.
            not_affected += 1
            continue
        relied = used[run.id] & retired_ids
        checked = categories & {c['category'] for c in run.checks if c['status'] != 'not_applicable'}
        # Campaigns still waiting on an earlier change move to this newer one.
        if relied or item.id in pending or (not retired_ids and checked):
            candidates.append((item, revision, run))
        else:
            not_affected += 1
    cited = defaultdict(list)
    if candidates and retired_pairs:
        for finding in session.scalars(select(Finding).where(Finding.org_id == org_id,
                Finding.run_id.in_([r.id for _, _, r in candidates]), Finding.source_version_id.in_(retired_ids))):
            if (finding.source_version_id, finding.rule_id) in retired_pairs:
                cited[finding.run_id].append(finding.rule_id)
    deltas = {}
    if 0 < len(candidates) <= LOCAL_RECHECK_LIMIT:
        groups = defaultdict(list)
        for entry in candidates:
            groups[tuple(sorted(s['id'] for s in entry[2].source_snapshot))].append(entry)
        for group in groups.values():
            cases = [dict(text=rev.text, context=dict(channel=rev.channel, audience=rev.audience, purpose=rev.purpose))
                     for _, rev, _ in group]
            old_sources = group[0][2].source_snapshot
            before, after = evaluate_many(cases, old_sources), evaluate_many(cases, new_sources)
            for (item, _, _), b, a in zip(group, before, after):
                deltas[item.id] = compare(b, a, old_sources, new_sources)
    entries = []
    for item, revision, run in candidates:
        reasons = []
        if cited[run.id]:
            reasons.append(dict(code='finding_cites_changed_rule',
                detail='The last review flagged rule ' + ', '.join(sorted(set(cited[run.id]))) + ', which changed.'))
        delta = deltas.get(item.id)
        if delta and delta['changed']:
            reasons.append(dict(code='local_findings_change',
                detail=f"Local checks give {len(delta['added'])} new and {len(delta['removed'])} cleared findings under the new rules."))
        level = 'confirmed' if reasons else None
        hits = mentions(revision.text, terms)
        if hits:
            reasons.append(dict(code='mentions_rule_subject', detail='The copy mentions ' + ', '.join(f'"{h}"' for h in hits[:5]) + '.'))
            level = level or 'likely'
        if level is None:
            reasons.append(dict(code='category_checked', detail='The last review checked this guideline\'s categories.'))
            level = 'possible'
        entries.append(dict(item_id=item.id, title=item.title, state=item.state, creator_id=item.creator_id,
            reviewer_id=item.reviewer_id, revision_id=revision.id, prior_run_id=run.id, impact_level=level,
            reasons=reasons, local_delta=delta))
    entries.sort(key=lambda e: (LEVEL_ORDER[e['impact_level']], e['title'].casefold(), e['item_id']))
    counts = dict(confirmed=0, likely=0, possible=0)
    for entry in entries:
        counts[entry['impact_level']] += 1
    counts.update(total=len(entries), not_affected=not_affected,
                  on_hold=sum(1 for e in entries if e['state'] in ON_HOLD_STATES),
                  brand_campaigns=session.scalar(select(func.count()).select_from(ContentItem).where(
                      ContentItem.org_id == org_id, ContentItem.brand_id == brand.id)))
    return dict(diff=diff, counts=counts, entries=entries)


def recheck_processing(session, org_id, prior_run, budget, at):
    """Consent carries forward only for the same revision text, the same policy version and
    prior consent; otherwise the recheck is local-only and AI categories go to manual review."""
    prior = prior_run.processing_snapshot or {}
    policy = session.get(ProcessingPolicy, org_id)
    if not (prior.get('enabled') and prior.get('consent') and policy and policy.enabled
            and policy.version == prior.get('policy_version') and policy.model == prior.get('model')):
        return dict(enabled=False, provider='nebius', consent=False, reason='recheck_local_only')
    start_of_day = at.replace(hour=0, minute=0, second=0, microsecond=0)
    reserved = session.scalar(select(func.count()).select_from(ReviewRun).where(
        ReviewRun.org_id == org_id, ReviewRun.created_at >= start_of_day,
        ReviewRun.processing_snapshot['enabled'].as_boolean() == True))
    from .models import Organisation
    from .review import run_budget
    if reserved >= run_budget(session.get(Organisation, org_id), budget):
        return dict(enabled=False, provider='nebius', consent=False, reason='external_budget_exceeded')
    return dict(enabled=True, provider='nebius', model=policy.model, policy_version=policy.version,
                notice=policy.notice, consent=True, carried_from_run_id=prior_run.id)


def queue_recheck(session, member, assignment, item, revision, prior_run, sources, epoch, budget, at):
    from .review import CATEGORIES
    attempt = session.scalar(select(func.count()).select_from(ReviewRun).where(ReviewRun.org_id == member.org_id,
        ReviewRun.revision_id == revision.id, ReviewRun.trigger == 'guideline_change')) + 1
    run = ReviewRun(org_id=member.org_id, revision_id=revision.id, idempotency_key=f'recheck:{assignment.id}:{attempt}',
        source_epoch=epoch, source_snapshot=sources,
        checks=[dict(category=c, status='unavailable', reason='Recheck queued after a guideline change.') for c in CATEGORIES],
        status='queued', created_at=at, processing_snapshot=recheck_processing(session, member.org_id, prior_run, budget, at),
        trigger='guideline_change', initiated_by=member.id)
    session.add(run); session.flush()
    for source in sources:
        session.add(RunSource(org_id=member.org_id, run_id=run.id, source_id=source['id']))
    session.add(Job(org_id=member.org_id, run_id=run.id, status='queued', attempts=0, available_at=at, created_at=at))
    assignment.recheck_run_id, assignment.status = run.id, 'recheck_queued'
    assignment.version += 1
    assignment.updated_at = at
    return run


def close_if_done(session, change_id, at):
    change = session.get(GuidelineChange, change_id)
    remaining = session.scalar(select(func.count()).select_from(RecheckAssignment).where(
        RecheckAssignment.change_id == change_id, RecheckAssignment.status.in_(OPEN_STATUSES)))
    if change.status == 'open' and remaining == 0:
        change.status, change.closed_at = 'closed', at
    return change


def record_change(session, member, brand, source, retired_sources, impact, budget, at):
    """Write the change, one assignment per affected campaign, state changes and rechecks.
    Runs inside activate_source's transaction, after the brand row is locked."""
    change = GuidelineChange(org_id=member.org_id, brand_id=brand.id, source_key=source.source_key,
        from_source_id=impact['diff']['from_source']['id'] if impact['diff']['from_source'] else None,
        to_source_id=source.id, retired_source_ids=sorted(s.id for s in retired_sources), diff=impact['diff'],
        impact_counts=impact['counts'], status='open', created_by=member.id, created_at=at)
    session.add(change); session.flush()
    new_sources = impact['new_sources']
    items = {i.id: i for i in session.scalars(select(ContentItem).where(ContentItem.org_id == member.org_id,
        ContentItem.id.in_([e['item_id'] for e in impact['entries']])).with_for_update())} if impact['entries'] else {}
    touched_changes = set()
    for entry in impact['entries']:
        item = items[entry['item_id']]
        prior_decision = session.scalar(select(Decision.id).where(Decision.org_id == member.org_id,
            Decision.run_id == entry['prior_run_id'], Decision.kind == 'approved'))
        state_before = item.state
        for older in session.scalars(select(RecheckAssignment).where(RecheckAssignment.org_id == member.org_id,
                RecheckAssignment.item_id == item.id, RecheckAssignment.status.in_(OPEN_STATUSES))):
            older.status, older.superseded_by, older.updated_at = 'superseded', change.id, at
            older.version += 1
            touched_changes.add(older.change_id)
            # Keep what was originally at stake, so a second quick change still returns
            # a once-approved campaign to its reviewer.
            state_before = older.state_before
            prior_decision = prior_decision or older.prior_decision_id
        assignment = RecheckAssignment(org_id=member.org_id, change_id=change.id, item_id=item.id,
            revision_id=entry['revision_id'], prior_run_id=entry['prior_run_id'], prior_decision_id=prior_decision,
            state_before=state_before, impact_level=entry['impact_level'], reasons=entry['reasons'],
            reviewer_id=item.reviewer_id, status='open', version=1, created_at=at, updated_at=at,
            findings_delta=entry['local_delta'])
        session.add(assignment); session.flush()
        item.state = 'recheck_required'
        item.workflow_version += 1
        if new_sources:
            revision = session.get(ContentRevision, entry['revision_id'])
            queue_recheck(session, member, assignment, item, revision, session.get(ReviewRun, entry['prior_run_id']),
                          new_sources, brand.source_epoch, budget, at)
    for change_id in touched_changes:
        close_if_done(session, change_id, at)
    session.add(AuditEvent(org_id=member.org_id, actor_id=member.id, action='guideline.changed', object_id=change.id,
        details=dict(source_id=source.id, from_source_id=change.from_source_id, impact_counts=impact['counts'],
                     superseded_changes=sorted(touched_changes)), created_at=at))
    if not impact['entries']:
        change.status, change.closed_at = 'closed', at
    return change


def finding_signature(finding, source_keys):
    location = finding['location'] if 'location' in finding else finding
    return (source_keys.get(finding['source_version_id'], finding['source_version_id']), finding['rule_id'],
            finding['category'], location['start'], location['end'], finding['severity'])


def recheck_delta(prior_findings, prior_run, new_findings, new_run):
    """Findings delta between the approved run and its recheck, including AI findings."""
    old_keys = {s['id']: s['source_key'] for s in prior_run.source_snapshot}
    new_keys = {s['id']: s['source_key'] for s in new_run.source_snapshot}
    old = {finding_signature(dict(source_version_id=f.source_version_id, rule_id=f.rule_id, category=f.category,
            severity=f.severity, location=f.location), old_keys): f for f in prior_findings}
    new = {finding_signature(f, new_keys): f for f in new_findings}
    added = [dict(rule_id=k[1], category=k[2], severity=k[5], start=k[3], end=k[4]) for k in sorted(set(new) - set(old), key=lambda k: (k[3], k[1]))]
    removed = [dict(rule_id=k[1], category=k[2], severity=k[5], start=k[3], end=k[4]) for k in sorted(set(old) - set(new), key=lambda k: (k[3], k[1]))]
    return dict(added=added, removed=removed, unchanged=len(set(old) & set(new)),
                new_blockers=sum(1 for f in added if f['severity'] == 'blocker'))


def finish_recheck(db, run, item, findings, complete, at):
    """Route a finished guideline-change recheck. Called from orchestration.finish_claim.
    New blockers go to the creator; otherwise campaigns that were approved or in review go
    straight back to their reviewer, because the text did not change."""
    assignment = db.scalar(select(RecheckAssignment).where(RecheckAssignment.recheck_run_id == run.id).with_for_update())
    if assignment is None or assignment.status != 'recheck_queued':
        return None
    prior_run = db.get(ReviewRun, assignment.prior_run_id)
    prior = list(db.scalars(select(Finding).where(Finding.run_id == prior_run.id)))
    delta = recheck_delta(prior, prior_run, [dict(f, location=dict(start=f['start'], end=f['end'])) for f in findings], run)
    delta['complete'] = complete
    assignment.findings_delta = delta
    assignment.updated_at = at
    assignment.version += 1
    if delta['new_blockers']:
        item.state, assignment.status = 'needs_changes', 'awaiting_creator'
    elif assignment.state_before in ON_HOLD_STATES and item.reviewer_id:
        item.state, assignment.status = 'in_review', 'awaiting_reviewer'
    else:
        # No approval was at stake: the refreshed analysis returns to the normal workflow.
        assignment.status, assignment.resolved_at = 'resolved', at
        close_if_done(db, assignment.change_id, at)
        return None
    return assignment


def open_assignments(session, item):
    return list(session.scalars(select(RecheckAssignment).where(RecheckAssignment.org_id == item.org_id,
        RecheckAssignment.item_id == item.id, RecheckAssignment.status.in_(OPEN_STATUSES)).with_for_update()))


def recheck_records(session, item):
    """`recheck_of` entries for an approval's evidence record: change and both guideline versions."""
    records = []
    for assignment in open_assignments(session, item):
        change = session.get(GuidelineChange, assignment.change_id)
        records.append(dict(change_id=change.id, prior_decision_id=assignment.prior_decision_id,
                            from_source_id=change.from_source_id, to_source_id=change.to_source_id))
    return records


def resolve_on_decision(session, item, decision, at):
    """Approval of the item resolves its open assignments; a request for changes hands it to the creator."""
    for assignment in open_assignments(session, item):
        assignment.updated_at = at
        assignment.version += 1
        if decision.kind == 'approved':
            assignment.status, assignment.resolved_decision_id, assignment.resolved_at = 'resolved', decision.id, at
            session.flush()
            close_if_done(session, assignment.change_id, at)
        else:
            assignment.status = 'awaiting_creator'
