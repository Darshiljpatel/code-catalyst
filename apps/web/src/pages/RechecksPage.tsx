/**
 * RechecksPage — the re-review inbox for guideline changes (Improvement 1).
 *
 *   /rechecks            — every guideline change with its completion progress
 *   /rechecks/:changeId  — old and new rules side by side, affected campaigns by
 *                          impact level, bulk reviewer assignment and re-queueing
 */
import React from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ApiResponseError,
  assignRecheckReviewer,
  getBrands,
  getGuidelineChange,
  getGuidelineChanges,
  getReviewers,
  requeueRechecks,
} from '../api/client';
import type {
  Brand,
  GuidelineChange,
  GuidelineChangeSummary,
  ImpactLevel,
  RecheckAssignment,
  RecheckStatus,
  ReviewerOut,
  RuleDiff,
  RuleDiffEntry,
} from '../api/types';
import { Alert, EmptyState, Spinner } from '../components/Primitives';
import { DiffViewer } from '../components/DiffViewer';
import { ImpactBadge, LEVEL_LABEL } from '../components/ImpactBadge';

const STATUS_LABEL: Record<RecheckStatus, string> = {
  open: 'Waiting to recheck',
  recheck_queued: 'Rechecking',
  awaiting_creator: 'Creator must revise',
  awaiting_reviewer: 'Reviewer to re-approve',
  resolved: 'Done',
  superseded: 'Replaced by a newer change',
};

function Progress({ resolved, total }: { resolved: number; total: number }) {
  const percent = total === 0 ? 100 : Math.round((resolved / total) * 100);
  return (
    <div className="recheck-progress">
      <div
        className="recheck-progress__bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={`${resolved} of ${total} rechecks done`}
      >
        <span style={{ width: `${percent}%` }} />
      </div>
      <span className="recheck-progress__label">{resolved} of {total} done · {percent}%</span>
    </div>
  );
}

function errorText(err: unknown, fallback: string) {
  return err instanceof ApiResponseError ? err.body.message : fallback;
}

export function RechecksPage() {
  const { changeId } = useParams();
  return changeId ? <ChangeDetail changeId={changeId} /> : <ChangeList />;
}

function ChangeList() {
  const [changes, setChanges] = React.useState<GuidelineChangeSummary[] | null>(null);
  const [brands, setBrands] = React.useState<Record<string, string>>({});
  const [filter, setFilter] = React.useState<'open' | 'closed' | 'all'>('open');
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    let cancelled = false;
    setChanges(null);
    setError('');
    Promise.all([getGuidelineChanges(filter === 'all' ? {} : { status: filter }), getBrands()])
      .then(([list, brandList]) => {
        if (cancelled) return;
        // A change that affected nothing closes immediately; it has nothing to recheck.
        setChanges(list.filter(change => change.total > 0));
        setBrands(Object.fromEntries((brandList as Brand[]).map(b => [b.id, b.name])));
      })
      .catch(err => { if (!cancelled) setError(errorText(err, 'Unable to load the re-review inbox.')); });
    return () => { cancelled = true; };
  }, [filter]);

  return (
    <main className="page-container rechecks-page" id="main-content">
      <p className="eyebrow">AFTER A GUIDELINE CHANGES</p>
      <h1>Re-review inbox</h1>
      <p className="rechecks-page__lede">
        When a guideline is updated, BrandGuard lists every campaign whose last review used the old version,
        rechecks it against the new rules and tracks re-approval here.
      </p>
      <div className="filter-bar" style={{ marginBottom: 'var(--space-4)' }}>
        {(['open', 'closed', 'all'] as const).map(value => (
          <button key={value} className={`filter-btn ${filter === value ? 'filter-btn--active' : ''}`}
            aria-pressed={filter === value} onClick={() => setFilter(value)}>
            {value === 'open' ? 'Open' : value === 'closed' ? 'Completed' : 'All'}
          </button>
        ))}
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {!error && changes === null && <Spinner label="Loading guideline changes…" />}
      {changes && changes.length === 0 && (
        <EmptyState icon="✓" title={filter === 'open' ? 'Nothing to recheck' : 'No guideline changes yet'}
          description="Publishing a guideline update from a brand page lists the campaigns that relied on it here." />
      )}
      {changes && changes.length > 0 && (
        <ul className="recheck-change-list">
          {changes.map(change => (
            <li key={change.id} className="card recheck-change-card">
              <div className="recheck-change-card__head">
                <div>
                  <Link to={`/rechecks/${change.id}`} className="recheck-change-card__title">
                    {change.title}{change.from_version ? ` · v${change.from_version} → v${change.to_version}` : ` · new v${change.to_version}`}
                  </Link>
                  <div className="recheck-change-card__meta">
                    {brands[change.brand_id] || 'Brand'} · published {new Date(change.created_at).toLocaleString()}
                  </div>
                </div>
                <span className={`badge ${change.status === 'closed' ? 'badge--success' : 'badge--warning'}`}>
                  {change.status === 'closed' ? 'Complete' : 'Open'}
                </span>
              </div>
              <div className="recheck-change-card__counts">
                <ImpactBadge level="confirmed" /> {change.impact_counts.confirmed}
                <ImpactBadge level="likely" /> {change.impact_counts.likely}
                <ImpactBadge level="possible" /> {change.impact_counts.possible}
                <span className="recheck-change-card__avoided">{change.impact_counts.not_affected} not affected</span>
              </div>
              <Progress resolved={change.resolved} total={change.total} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function RuleFields({ rule, changed }: { rule?: RuleDiffEntry['before']; changed?: string[] }) {
  if (!rule) return <span className="rule-diff__empty">—</span>;
  const field = (name: string, label: string, value: string | undefined) => value ? (
    <div className={changed?.includes(name) ? 'rule-diff__field rule-diff__field--changed' : 'rule-diff__field'}>
      <span className="rule-diff__label">{label}</span> {value}
    </div>
  ) : null;
  return (
    <div>
      {field('value', 'Rule', rule.value)}
      {field('evidence_quote', 'Guideline text', `“${rule.evidence_quote}”`)}
      {field('key', 'Subject', rule.key.replace(/_/g, ' '))}
      {field('allowed_variants', 'Also allowed', (rule as { allowed_variants?: string[] }).allowed_variants?.join(', '))}
      {field('forbidden_variants', 'Never write', (rule as { forbidden_variants?: string[] }).forbidden_variants?.join(', '))}
    </div>
  );
}

export function RuleDiffCard({ diff }: { diff: RuleDiff }) {
  const rows: { kind: string; entry: RuleDiffEntry }[] = [
    ...diff.modified.map(entry => ({ kind: 'Changed', entry })),
    ...diff.added.map(entry => ({ kind: 'Added', entry })),
    ...diff.removed.map(entry => ({ kind: 'Removed', entry })),
  ];
  return (
    <section className="card rule-diff" aria-labelledby="rule-diff-title">
      <h2 id="rule-diff-title">What changed</h2>
      <p className="rule-diff__summary">
        {diff.modified.length} changed, {diff.added.length} added, {diff.removed.length} removed, {diff.unchanged} unchanged
        {diff.retired_sources.length > 0 && ` · also retires ${diff.retired_sources.map(s => s.title).join(', ')}`}
      </p>
      {rows.length === 0 ? <p>No rule changed; only the guideline text was edited.</p> : (
        <table className="rule-diff__table">
          <thead><tr><th scope="col">Rule</th><th scope="col">Before</th><th scope="col">After</th></tr></thead>
          <tbody>
            {rows.map(({ kind, entry }) => (
              <tr key={`${kind}-${entry.source_id || ''}-${entry.rule_id}`}>
                <th scope="row"><code>{entry.rule_id}</code><div className="rule-diff__kind">{kind}</div></th>
                <td><RuleFields rule={entry.before} changed={entry.fields} /></td>
                <td><RuleFields rule={entry.after} changed={entry.fields} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {diff.from_source && diff.from_source.text !== diff.to_source.text && (
        <details className="rule-diff__text">
          <summary>Compare the full guideline text</summary>
          <DiffViewer originalText={diff.from_source.text} modifiedText={diff.to_source.text}
            originalLabel={`Version ${diff.from_source.version}`} modifiedLabel={`Version ${diff.to_source.version}`} />
        </details>
      )}
    </section>
  );
}

function deltaText(assignment: RecheckAssignment) {
  const delta = assignment.findings_delta;
  if (!delta) return '—';
  if (assignment.status === 'recheck_queued' || assignment.status === 'open') {
    return delta.changed ? `Local checks: ${delta.added.length} new, ${delta.removed.length} cleared` : 'Local checks unchanged';
  }
  const parts = [`${delta.added.length} new`, `${delta.removed.length} cleared`, `${delta.unchanged} unchanged`];
  if (delta.new_blockers) parts.unshift(`${delta.new_blockers} new blocking`);
  return parts.join(' · ');
}

function ChangeDetail({ changeId }: { changeId: string }) {
  const [change, setChange] = React.useState<GuidelineChange | null>(null);
  const [reviewers, setReviewers] = React.useState<ReviewerOut[]>([]);
  const [level, setLevel] = React.useState<ImpactLevel | 'all'>('all');
  const [selected, setSelected] = React.useState<string[]>([]);
  const [reviewerId, setReviewerId] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [notice, setNotice] = React.useState('');

  const load = React.useCallback(() => getGuidelineChange(changeId)
    .then(next => { setChange(next); setError(''); })
    .catch(err => setError(errorText(err, 'Unable to load this guideline change.'))), [changeId]);

  React.useEffect(() => {
    load();
    getReviewers().then(list => setReviewers(Array.isArray(list) ? list : [])).catch(() => setReviewers([]));
  }, [load]);

  // Rechecks finish in the background; refresh while any is still running.
  React.useEffect(() => {
    if (!change?.assignments.some(a => a.status === 'recheck_queued')) return;
    const timer = window.setTimeout(load, 3000);
    return () => window.clearTimeout(timer);
  }, [change, load]);

  if (error && !change) return <main className="page-container" id="main-content"><Alert kind="error">{error}</Alert></main>;
  if (!change) return <main className="page-container" id="main-content"><Spinner label="Loading guideline change…" /></main>;

  const openRows = change.assignments.filter(a => a.status !== 'resolved' && a.status !== 'superseded');
  const visible = change.assignments.filter(a => level === 'all' || a.impact_level === level);
  const selectable = visible.filter(a => openRows.includes(a));
  const allSelected = selectable.length > 0 && selectable.every(a => selected.includes(a.id));
  const reviewerEmail = (id: string | null) => reviewers.find(r => r.id === id)?.email || (id ? 'Assigned' : 'Unassigned');

  const toggle = (id: string) => setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const assign = async () => {
    if (!reviewerId || selected.length === 0) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const rows = change.assignments.filter(a => selected.includes(a.id));
      await assignRecheckReviewer(rows, reviewerId);
      setNotice(`Assigned ${rows.length} recheck${rows.length === 1 ? '' : 's'} to ${reviewerEmail(reviewerId)}.`);
      setSelected([]);
      await load();
    } catch (err) {
      setError(errorText(err, 'Assignment failed. Reload and try again.'));
      await load();
    } finally {
      setBusy(false);
    }
  };

  const requeue = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await requeueRechecks(change.id);
      setNotice(result.queued.length ? `Queued ${result.queued.length} recheck${result.queued.length === 1 ? '' : 's'} again.` : 'Every recheck is already queued or finished.');
      await load();
    } catch (err) {
      setError(errorText(err, 'Could not queue rechecks.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page-container rechecks-page" id="main-content">
      <Link to="/rechecks" className="text-link">← Re-review inbox</Link>
      <p className="eyebrow" style={{ marginTop: 'var(--space-4)' }}>GUIDELINE UPDATE</p>
      <h1>{change.title}{change.from_version ? `: v${change.from_version} → v${change.to_version}` : `: new v${change.to_version}`}</h1>
      <p className="rechecks-page__lede">
        Published {new Date(change.created_at).toLocaleString()}. {change.total} campaign{change.total === 1 ? '' : 's'} relied on the
        previous version; {change.impact_counts.not_affected} did not rely on it and are untouched.
      </p>
      <Progress resolved={change.resolved} total={change.total} />
      {error && <Alert kind="error">{error}</Alert>}
      {notice && <div role="status" className="alert alert--success">{notice}</div>}

      <RuleDiffCard diff={change.diff} />

      <section className="card recheck-table-card" aria-labelledby="affected-title">
        <div className="recheck-table-card__head">
          <h2 id="affected-title">Affected campaigns</h2>
          <div className="filter-bar">
            {(['all', 'confirmed', 'likely', 'possible'] as const).map(value => (
              <button key={value} className={`filter-btn ${level === value ? 'filter-btn--active' : ''}`}
                aria-pressed={level === value} onClick={() => { setLevel(value); setSelected([]); }}>
                {value === 'all' ? `All (${change.assignments.length})` : `${LEVEL_LABEL[value]} (${change.assignments.filter(a => a.impact_level === value).length})`}
              </button>
            ))}
          </div>
        </div>
        <div className="recheck-bulk" aria-label="Bulk actions">
          <label htmlFor="sel-recheck-reviewer">Assign selected to</label>
          <select id="sel-recheck-reviewer" className="input input--sm" value={reviewerId} onChange={e => setReviewerId(e.target.value)}>
            <option value="">Choose a reviewer…</option>
            {reviewers.map(r => <option key={r.id} value={r.id}>{r.email}</option>)}
          </select>
          <button className="btn btn--primary btn--sm" onClick={assign} disabled={busy || !reviewerId || selected.length === 0}>
            Assign {selected.length || ''} selected
          </button>
          <button className="btn btn--ghost btn--sm" onClick={requeue} disabled={busy || openRows.length === 0}>
            Re-queue failed rechecks
          </button>
        </div>
        <div className="table-scroll">
          <table className="recheck-table">
            <thead>
              <tr>
                <th scope="col">
                  <input type="checkbox" aria-label="Select all open rechecks shown" checked={allSelected}
                    disabled={selectable.length === 0}
                    onChange={() => setSelected(allSelected ? [] : selectable.map(a => a.id))} />
                </th>
                <th scope="col">Campaign</th>
                <th scope="col">Impact</th>
                <th scope="col">Why</th>
                <th scope="col">Findings after recheck</th>
                <th scope="col">Reviewer</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(a => {
                const open = openRows.includes(a);
                return (
                  <tr key={a.id} className={open ? '' : 'recheck-table__done'}>
                    <td>
                      <input type="checkbox" aria-label={`Select ${a.title}`} checked={selected.includes(a.id)}
                        disabled={!open} onChange={() => toggle(a.id)} />
                    </td>
                    <td>
                      <Link to={`/content/${a.item_id}`}>{a.title}</Link>
                      <div className="recheck-table__sub">was {a.state_before.replace(/_/g, ' ')}</div>
                    </td>
                    <td><ImpactBadge level={a.impact_level} /></td>
                    <td><ul className="recheck-reasons">{a.reasons.map(r => <li key={r.code}>{r.detail}</li>)}</ul></td>
                    <td>{deltaText(a)}</td>
                    <td>{reviewerEmail(a.reviewer_id)}</td>
                    <td>
                      <span className={`badge ${a.status === 'resolved' ? 'badge--success' : a.status === 'awaiting_creator' ? 'badge--blocker' : 'badge--warning'}`}>
                        {STATUS_LABEL[a.status]}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
