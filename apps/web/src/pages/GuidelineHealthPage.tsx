/**
 * GuidelineHealthPage — per-rule dispute signals and improvement requests (Improvement 3).
 *
 *   /brands/:brandId/health
 */
import React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiResponseError, createGuidelineRequest, getBrand, getGuidelineHealth } from '../api/client';
import type { Brand, GuidelineHealth, RuleHealth } from '../api/types';
import { Alert, EmptyState, Spinner } from '../components/Primitives';
import { categoryLabel } from '../components/categoryLabel';

function DisputeBar({ rate }: { rate: number | null }) {
  if (rate === null) return <span className="health-bar__none">No flags yet</span>;
  const percent = Math.round(rate * 100);
  return (
    <span className="health-bar" title={`${percent}% of flagged campaigns disputed`}>
      <span className="health-bar__track" aria-hidden="true"><span style={{ width: `${percent}%` }} /></span>
      <span className="health-bar__label">{percent}%</span>
    </span>
  );
}

export function GuidelineHealthPage() {
  const { brandId = '' } = useParams();
  const navigate = useNavigate();
  const [brand, setBrand] = React.useState<Brand | null>(null);
  const [health, setHealth] = React.useState<GuidelineHealth | null>(null);
  const [error, setError] = React.useState('');
  const [creating, setCreating] = React.useState<string | null>(null);

  React.useEffect(() => {
    Promise.all([getBrand(brandId), getGuidelineHealth(brandId)])
      .then(([b, h]) => { setBrand(b); setHealth(h); })
      .catch(err => setError(err instanceof ApiResponseError ? err.body.message : 'Unable to load guideline health.'));
  }, [brandId]);

  const createRequest = async (rule: RuleHealth) => {
    setCreating(rule.rule_id);
    setError('');
    try {
      const created = await createGuidelineRequest({
        brand_id: brandId,
        source_id: rule.source_id,
        rule_id: rule.rule_id,
        title: `Clarify ${rule.rule_id}: ${rule.value}`.slice(0, 200),
        problem: [
          rule.disputed_items > 0 && `${rule.disputed_items} campaign${rule.disputed_items === 1 ? '' : 's'} disputed this rule in the last ${health?.window_days ?? 30} days.`,
          rule.ambiguity_reports > 0 && `${rule.ambiguity_reports} ambiguity report${rule.ambiguity_reports === 1 ? '' : 's'} say${rule.ambiguity_reports === 1 ? 's' : ''} it is unclear.`,
        ].filter(Boolean).join(' ') || 'This rule needs clearer wording.',
      });
      navigate(`/requests/${created.id}`);
    } catch (err) {
      setError(err instanceof ApiResponseError ? err.body.message : 'Could not create the request.');
      setCreating(null);
    }
  };

  if (error && !health) return <main className="page-container" id="main-content"><Alert kind="error">{error}</Alert></main>;
  if (!health) return <main className="page-container" id="main-content"><Spinner label="Loading guideline health…" /></main>;

  return (
    <main className="page-container rechecks-page" id="main-content">
      <Link to={`/brands/${brandId}`} className="text-link">← {brand?.name || 'Brand'}</Link>
      <p className="eyebrow" style={{ marginTop: 'var(--space-4)' }}>KEEP GUIDELINES CLEAR</p>
      <h1>Guideline health</h1>
      <p className="rechecks-page__lede">
        How often each active rule is confirmed or disputed. A rule disputed in {health.unclear_threshold} or more campaigns within
        {' '}{health.window_days} days, or reported as unclear by anyone, is marked likely unclear. {health.dispute_definition}
      </p>
      {error && <Alert kind="error">{error}</Alert>}

      {health.open_requests.length > 0 && (
        <section className="card" aria-labelledby="open-requests-title">
          <h2 id="open-requests-title">Open improvement requests</h2>
          <ul className="recheck-reasons">
            {health.open_requests.map(r => (
              <li key={r.id}><Link to={`/requests/${r.id}`}>{r.title}</Link> <span className="badge badge--neutral">{r.status.replace(/_/g, ' ')}</span></li>
            ))}
          </ul>
        </section>
      )}

      <section className="card" aria-labelledby="rules-title">
        <h2 id="rules-title">Rules</h2>
        {health.rules.length === 0 ? (
          <EmptyState icon="◇" title="No active rules" description="Publish a guideline for this brand first." />
        ) : (
          <div className="table-scroll">
            <table className="recheck-table">
              <thead>
                <tr>
                  <th scope="col">Rule</th>
                  <th scope="col">Category</th>
                  <th scope="col">Flagged</th>
                  <th scope="col">Confirmed</th>
                  <th scope="col">Disputed</th>
                  <th scope="col">Dispute rate</th>
                  <th scope="col">Ambiguity reports</th>
                  <th scope="col"><span className="visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {health.rules.map(rule => (
                  <tr key={`${rule.source_id}-${rule.rule_id}`}>
                    <td>
                      <code>{rule.rule_id}</code> {rule.value}
                      <div className="recheck-table__sub">{rule.source_title}</div>
                      {rule.likely_unclear && <span className="impact-badge impact-badge--likely"><span aria-hidden="true">⚠</span> Likely unclear</span>}
                    </td>
                    <td>{categoryLabel(rule.category)}</td>
                    <td>{rule.flagged_items}</td>
                    <td>{rule.confirmed_items}</td>
                    <td>{rule.disputed_items}</td>
                    <td><DisputeBar rate={rule.dispute_rate} /></td>
                    <td>{rule.ambiguity_reports}</td>
                    <td>
                      {rule.open_request_id ? (
                        <Link className="btn btn--ghost btn--sm" to={`/requests/${rule.open_request_id}`}>Open request</Link>
                      ) : (
                        <button className={`btn btn--sm ${rule.likely_unclear ? 'btn--primary' : 'btn--ghost'}`}
                          disabled={creating !== null} onClick={() => createRequest(rule)}
                          aria-label={`Create improvement request for rule ${rule.rule_id}`}>
                          {creating === rule.rule_id ? 'Creating…' : 'Create improvement request'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
