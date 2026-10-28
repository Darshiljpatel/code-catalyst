/**
 * RequestPage — one guideline improvement request (Improvement 3).
 *
 *   /requests/:requestId
 *
 * Examples and labels → clearer draft rule (shown as a diff) → comparison of live and
 * proposed rules on saved examples → review by another manager or admin → gated activation,
 * which hands over to the re-review inbox.
 */
import React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ApiResponseError,
  activateSource,
  addExampleCase,
  ensureExampleSet,
  getBrand,
  getExampleSets,
  getGuidelineRequest,
  reviewGuidelineRequest,
  runComparison,
  saveRequestDraft,
  saveRequestExamples,
  updateGuidelineRequest,
} from '../api/client';
import type { Brand, ComparisonCase, ExampleExpectation, ExampleSet, GuidelineRequest, RuleInput } from '../api/types';
import { useAuth } from '../context/AuthContext';
import { Alert, Spinner } from '../components/Primitives';
import { RuleDiffCard } from './RechecksPage';

const VERDICT_LABEL: Record<ComparisonCase['verdict'], string> = {
  fixed: 'Fixed', regressed: 'Regressed', unchanged: 'Unchanged', unstable: 'Unstable', changed: 'Changed (unlabelled)', not_run: 'Not run',
};

const ACTION_LABEL: Record<string, string> = {
  request_dismissal: 'asked to dismiss', request_exception: 'asked for an exception', dismiss: 'dismissed',
  grant_exception: 'granted an exception', ambiguity_report: 'reported the rule as unclear',
};

function message(err: unknown, fallback: string) {
  return err instanceof ApiResponseError ? err.body.message : fallback;
}

function splitList(value: string) {
  const items = value.split(',').map(v => v.trim()).filter(Boolean);
  return items.length ? items : null;
}

function DraftEditor({ request, onSaved, onError }: {
  request: GuidelineRequest; onSaved: (next: GuidelineRequest) => void; onError: (text: string) => void;
}) {
  const start = request.draft_source || request.base_source;
  const [title, setTitle] = React.useState(start.title);
  const [text, setText] = React.useState(start.text);
  const [rules, setRules] = React.useState<RuleInput[]>(start.rules.map(r => ({ ...r })));
  const [saving, setSaving] = React.useState(false);

  const update = (index: number, patch: Partial<RuleInput>) =>
    setRules(prev => prev.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const cleaned = rules.map(rule => {
        const next: RuleInput = { ...rule };
        if (!next.allowed_variants?.length) delete next.allowed_variants;
        if (!next.forbidden_variants?.length) delete next.forbidden_variants;
        return next;
      });
      onSaved(await saveRequestDraft(request.id, { expected_version: request.version, title, text, rules: cleaned }));
    } catch (err) {
      onError(message(err, 'Could not save the draft.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="request-draft">
      <div className="form-group">
        <label htmlFor="draft-title" className="form-label">Guideline title</label>
        <input id="draft-title" className="input" value={title} maxLength={200} onChange={e => setTitle(e.target.value)} required />
      </div>
      <div className="form-group">
        <label htmlFor="draft-text" className="form-label">Guideline text</label>
        <textarea id="draft-text" className="input" rows={3} value={text} onChange={e => setText(e.target.value)} required />
      </div>
      {rules.map((rule, index) => (
        <fieldset key={rule.id} className={`request-draft__rule${rule.id === request.rule_id ? ' request-draft__rule--focus' : ''}`}>
          <legend><code>{rule.id}</code> {rule.category.replace(/_/g, ' ')}{rule.id === request.rule_id ? ' · rule under discussion' : ''}</legend>
          <label className="form-label" htmlFor={`rule-${index}-value`}>Rule</label>
          <input id={`rule-${index}-value`} className="input" value={rule.value} onChange={e => update(index, { value: e.target.value })} required />
          <label className="form-label" htmlFor={`rule-${index}-quote`}>Evidence quoted from the guideline text</label>
          <input id={`rule-${index}-quote`} className="input" value={rule.evidence_quote} onChange={e => update(index, { evidence_quote: e.target.value })} required />
          {rule.kind === 'terminology' && (
            <div className="request-draft__variants">
              <div>
                <label className="form-label" htmlFor={`rule-${index}-allowed`}>Also allowed (exact spellings, comma separated)</label>
                <input id={`rule-${index}-allowed`} className="input" placeholder="e.g. LUMADESK"
                  defaultValue={(rule.allowed_variants || []).join(', ')}
                  onChange={e => update(index, { allowed_variants: splitList(e.target.value) })} />
              </div>
              <div>
                <label className="form-label" htmlFor={`rule-${index}-forbidden`}>Always flag (comma separated)</label>
                <input id={`rule-${index}-forbidden`} className="input" placeholder="e.g. Luma Desk"
                  defaultValue={(rule.forbidden_variants || []).join(', ')}
                  onChange={e => update(index, { forbidden_variants: splitList(e.target.value) })} />
              </div>
            </div>
          )}
        </fieldset>
      ))}
      <button type="submit" className="btn btn--primary" disabled={saving}>{saving ? 'Saving…' : request.draft_source ? 'Save new draft' : 'Save draft'}</button>
    </form>
  );
}

function findingsCell(findings: ComparisonCase['live'], ruleId: string | null) {
  const relevant = ruleId ? findings.filter(f => f.rule_id === ruleId) : findings;
  if (relevant.length === 0) return <span className="recheck-table__sub">Not flagged</span>;
  return relevant.map(f => <div key={`${f.rule_id}-${f.start}`}>Flags “{f.quote}”</div>);
}

export function RequestPage() {
  const { requestId = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [request, setRequest] = React.useState<GuidelineRequest | null>(null);
  const [brand, setBrand] = React.useState<Brand | null>(null);
  const [exampleSet, setExampleSet] = React.useState<ExampleSet | null>(null);
  const [labels, setLabels] = React.useState<Record<string, ExampleExpectation>>({});
  const [busy, setBusy] = React.useState('');
  const [error, setError] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const [rationale, setRationale] = React.useState('');
  const [acknowledgement, setAcknowledgement] = React.useState('');
  const [caseLabel, setCaseLabel] = React.useState('');
  const [caseText, setCaseText] = React.useState('');
  const [caseExpected, setCaseExpected] = React.useState<'flag' | 'no_flag'>('flag');

  const apply = React.useCallback((next: GuidelineRequest) => {
    setRequest(next);
    setLabels(Object.fromEntries(next.examples.map(e => [e.id, e.expected])));
  }, []);

  const load = React.useCallback(async () => {
    const next = await getGuidelineRequest(requestId);
    apply(next);
    const [b, sets] = await Promise.all([getBrand(next.brand_id), getExampleSets(next.brand_id)]);
    setBrand(b);
    setExampleSet(sets[0] || null);
  }, [requestId, apply]);

  React.useEffect(() => { load().catch(err => setError(message(err, 'Unable to load this request.'))); }, [load]);

  const act = async (label: string, work: () => Promise<void>) => {
    setBusy(label); setError(''); setNotice('');
    try { await work(); } catch (err) { setError(message(err, 'That did not work. Reload and try again.')); } finally { setBusy(''); }
  };

  if (error && !request) return <main className="page-container" id="main-content"><Alert kind="error">{error}</Alert></main>;
  if (!request) return <main className="page-container" id="main-content"><Spinner label="Loading improvement request…" /></main>;

  const closed = request.status === 'activated' || request.status === 'withdrawn';
  const comparison = request.comparisons[0];
  const isDrafter = user?.membership_id === request.created_by || user?.membership_id === request.draft_source?.owner_id;
  const canReview = !isDrafter && (user?.role === 'manager' || user?.role === 'admin') && request.draft_source && !closed;
  const labelsDirty = request.examples.some(e => labels[e.id] !== e.expected);

  return (
    <main className="page-container rechecks-page" id="main-content">
      <Link to={`/brands/${request.brand_id}/health`} className="text-link">← Guideline health</Link>
      <p className="eyebrow" style={{ marginTop: 'var(--space-4)' }}>GUIDELINE IMPROVEMENT REQUEST</p>
      <h1>{request.title}</h1>
      <p className="rechecks-page__lede">
        <span className="badge badge--neutral">{request.status.replace(/_/g, ' ')}</span> {request.problem}
        {' '}Live guideline: {request.base_source.title} v{request.base_source.version}{request.rule_id ? `, rule ${request.rule_id}` : ''}.
      </p>
      {error && <Alert kind="error">{error}</Alert>}
      {notice && <div role="status" className="alert alert--success">{notice}</div>}
      {request.gates.base_changed && !closed && (
        <Alert kind="warning">The live guideline changed while this request was open. Save the draft again from the latest version before activating.</Alert>
      )}

      <section className="card" aria-labelledby="examples-title">
        <h2 id="examples-title">1 · Examples</h2>
        {request.examples.length === 0 ? <p>No disputed campaigns were linked. Add hand-written examples to the saved set below.</p> : (
          <div className="table-scroll">
            <table className="recheck-table">
              <thead><tr><th scope="col">Excerpt</th><th scope="col">Who disputed it and why</th><th scope="col">Should the rule flag it?</th></tr></thead>
              <tbody>
                {request.examples.map(example => (
                  <tr key={example.id}>
                    <td>{example.redacted_at ? <em>Campaign text removed by the retention policy</em> : <>“{example.excerpt || '—'}”{example.item_id && <div><Link to={`/content/${example.item_id}`} className="recheck-table__sub">Open campaign</Link></div>}</>}</td>
                    <td>{ACTION_LABEL[example.dispute.action || ''] || example.dispute.action}: {example.dispute.rationale}</td>
                    <td>
                      <select aria-label={`Label for “${example.excerpt}”`} className="input input--sm" disabled={closed}
                        value={labels[example.id]} onChange={e => setLabels(prev => ({ ...prev, [example.id]: e.target.value as ExampleExpectation }))}>
                        <option value="flag">Should flag</option>
                        <option value="no_flag">Should not flag</option>
                        <option value="unsure">Unsure</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="recheck-bulk">
          {request.examples.length > 0 && (
            <button className="btn btn--secondary btn--sm" disabled={!labelsDirty || !!busy || closed}
              onClick={() => act('labels', async () => {
                apply(await updateGuidelineRequest(request.id, { expected_version: request.version,
                  labels: request.examples.map(e => ({ example_id: e.id, expected: labels[e.id] })) }));
                setNotice('Labels saved.');
              })}>Save labels</button>
          )}
          <button className="btn btn--ghost btn--sm" disabled={labelsDirty || !!busy || closed || !request.examples.some(e => e.expected !== 'unsure')}
            onClick={() => act('save-set', async () => {
              const saved = await saveRequestExamples(request.id);
              setExampleSet(saved);
              setNotice(`Saved examples now hold ${saved.cases.length} case${saved.cases.length === 1 ? '' : 's'}.`);
            })}>Add labelled examples to saved set</button>
        </div>
        <h3>Saved examples for this brand ({exampleSet?.cases.length ?? 0})</h3>
        <form className="request-case-form" onSubmit={e => {
          e.preventDefault();
          if (!request.rule_id) return;
          void act('case', async () => {
            const target = exampleSet || await ensureExampleSet(request.brand_id);
            const saved = await addExampleCase(target.id, { label: caseLabel, text: caseText,
              expectations: [{ source_key: request.source_key, rule_id: request.rule_id!, expected: caseExpected }] });
            setExampleSet(saved);
            setCaseLabel(''); setCaseText('');
            setNotice('Example added.');
          });
        }}>
          <input aria-label="New example name" className="input input--sm" placeholder="Example name" value={caseLabel} maxLength={200} onChange={e => setCaseLabel(e.target.value)} required disabled={closed || !request.rule_id} />
          <input aria-label="New example copy" className="input input--sm" placeholder="Campaign copy" value={caseText} maxLength={20000} onChange={e => setCaseText(e.target.value)} required disabled={closed || !request.rule_id} />
          <select aria-label="New example expectation" className="input input--sm" value={caseExpected} onChange={e => setCaseExpected(e.target.value as 'flag' | 'no_flag')} disabled={closed || !request.rule_id}>
            <option value="flag">Should flag</option>
            <option value="no_flag">Should not flag</option>
          </select>
          <button type="submit" className="btn btn--ghost btn--sm" disabled={!!busy || closed || !request.rule_id}>Add example</button>
        </form>
      </section>

      <section className="card" aria-labelledby="draft-title-heading">
        <h2 id="draft-title-heading">2 · Clearer rule</h2>
        {!closed && <DraftEditor key={request.draft_hash || 'base'} request={request} onSaved={next => { apply(next); setNotice('Draft saved. Run the comparison again.'); }} onError={setError} />}
        {request.diff && <RuleDiffCard diff={request.diff} />}
      </section>

      <section className="card" aria-labelledby="comparison-title">
        <h2 id="comparison-title">3 · Comparison on saved examples</h2>
        <button className="btn btn--primary btn--sm" disabled={!request.draft_source || !!busy || closed}
          onClick={() => act('compare', async () => { await runComparison(request.id); await load(); })}>
          {busy === 'compare' ? 'Running…' : 'Run comparison'}
        </button>
        {comparison && (
          <>
            <p className="impact-preview__headline" style={{ marginTop: 'var(--space-3)' }}>
              {comparison.summary.verdict} {!comparison.current && <span className="badge badge--warning">Out of date: the draft changed</span>}
            </p>
            <p className="recheck-table__sub">
              Live rules: precision {comparison.summary.live_metrics.precision ?? '—'}, recall {comparison.summary.live_metrics.recall ?? '—'} ·
              Proposed rules: precision {comparison.summary.proposed_metrics.precision ?? '—'}, recall {comparison.summary.proposed_metrics.recall ?? '—'}.
              {' '}{comparison.summary.ai.reason}
            </p>
            <div className="table-scroll">
              <table className="recheck-table">
                <thead><tr><th scope="col">Case</th><th scope="col">Expected</th><th scope="col">Live rule</th><th scope="col">Proposed rule</th><th scope="col">Verdict</th></tr></thead>
                <tbody>
                  {comparison.summary.cases.map(c => (
                    <tr key={c.case_id}>
                      <td>{c.label}<div className="recheck-table__sub">“{c.text.slice(0, 120)}”</div></td>
                      <td>{c.expectations.map(e => e.expected === 'flag' ? 'Flag' : 'No flag').join(', ') || 'Unlabelled'}</td>
                      <td>{findingsCell(c.live, request.rule_id)}</td>
                      <td>{findingsCell(c.proposed, request.rule_id)}</td>
                      <td><span className={`badge ${c.verdict === 'fixed' ? 'badge--success' : c.verdict === 'regressed' ? 'badge--blocker' : 'badge--neutral'}`}>{VERDICT_LABEL[c.verdict]}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="card" aria-labelledby="review-title">
        <h2 id="review-title">4 · Review by another manager or admin</h2>
        {request.reviews.length > 0 && (
          <ul className="recheck-reasons">
            {request.reviews.map(r => (
              <li key={r.id}>{r.decision.replace(/_/g, ' ')}: {r.rationale} {!r.current && <span className="badge badge--neutral">earlier draft</span>}</li>
            ))}
          </ul>
        )}
        {isDrafter && !closed && <p>You drafted this rule, so a different manager or an admin must approve it. In a demo workspace, switch to the brand lead.</p>}
        {canReview && (
          <div className="request-review">
            <label htmlFor="review-rationale" className="form-label">Your rationale</label>
            <textarea id="review-rationale" className="input" rows={2} value={rationale} onChange={e => setRationale(e.target.value)} />
            <div className="recheck-bulk">
              <button className="btn btn--primary btn--sm" disabled={rationale.trim().length < 20 || !request.gates.comparison_current || !!busy}
                onClick={() => act('approve', async () => { apply(await reviewGuidelineRequest(request.id, { decision: 'approved', rationale, comparison_run_id: request.gates.comparison_run_id })); setRationale(''); setNotice('Approved.'); })}>
                Approve this draft
              </button>
              <button className="btn btn--ghost btn--sm" disabled={rationale.trim().length < 20 || !!busy}
                onClick={() => act('changes', async () => { apply(await reviewGuidelineRequest(request.id, { decision: 'changes_requested', rationale })); setRationale(''); })}>
                Request changes
              </button>
            </div>
            {!request.gates.comparison_current && <p className="recheck-table__sub">Approval needs a comparison of the current draft.</p>}
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="activate-title">
        <h2 id="activate-title">5 · Activate</h2>
        {request.status === 'activated' ? (
          <p>Activated. {request.change_id && <Link to={`/rechecks/${request.change_id}`}>See the campaigns being rechecked →</Link>}</p>
        ) : (
          <>
            <ul className="request-gates">
              <li aria-label={request.gates.comparison_current ? 'done' : 'not done'}>{request.gates.comparison_current ? '✓' : '○'} Comparison run on this exact draft</li>
              <li aria-label={request.gates.approval_current ? 'done' : 'not done'}>{request.gates.approval_current ? '✓' : '○'} Approved by another manager or admin</li>
              {request.gates.regressions > 0 && <li>⚠ {request.gates.regressions} regression{request.gates.regressions === 1 ? '' : 's'} must be acknowledged</li>}
            </ul>
            {request.gates.regressions > 0 && (
              <>
                <label htmlFor="regression-ack" className="form-label">Why accept the regression?</label>
                <textarea id="regression-ack" className="input" rows={2} value={acknowledgement} onChange={e => setAcknowledgement(e.target.value)} />
              </>
            )}
            <button className="btn btn--primary" disabled={!request.gates.can_activate || !brand || !!busy || (request.gates.regressions > 0 && acknowledgement.trim().length < 10)}
              onClick={() => act('activate', async () => {
                const result = await activateSource(request.draft_source_id!, { expected_epoch: brand!.source_epoch, verified: true, retire_source_ids: [],
                  rationale: `Peer-reviewed improvement request: ${request.title}`.slice(0, 2000),
                  ...(request.gates.regressions > 0 ? { regression_acknowledgement: acknowledgement.trim() } : {}) });
                navigate(`/rechecks/${result.change_id}`);
              })}>
              Publish clearer guideline
            </button>
          </>
        )}
      </section>

      <section className="card" aria-labelledby="activity-title">
        <h2 id="activity-title">Activity</h2>
        <ol className="recheck-reasons">
          {request.activity.map((a, i) => <li key={i}>{new Date(a.created_at).toLocaleString()} · {a.action.replace('guideline_request.', '').replace(/_/g, ' ')}</li>)}
        </ol>
      </section>
    </main>
  );
}
