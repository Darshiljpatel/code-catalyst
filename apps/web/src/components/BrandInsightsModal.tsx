import { useDialogFocus } from '../hooks/useDialogFocus';
import React from 'react';
import type { InsightsOut } from '../api/types';
import { getBrandInsights } from '../api/client';
import { Spinner, Alert } from './Primitives';

interface BrandInsightsModalProps {
  brandId: string;
  brandName: string;
  onClose: () => void;
}

export function BrandInsightsModal({ brandId, brandName, onClose }: BrandInsightsModalProps) {
  const dialogRef = useDialogFocus();
  const [insights, setInsights] = React.useState<InsightsOut | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  React.useEffect(() => {
    setLoading(true);
    getBrandInsights(brandId)
      .then(setInsights)
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load brand insights'))
      .finally(() => setLoading(false));
  }, [brandId]);

  return (
    <div className="modal-backdrop" onClick={onClose} ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="insights-modal-title">
      <div className="modal-content" style={{ maxWidth: '800px', width: '92%' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
          <div>
            <h2 id="insights-modal-title" style={{ margin: 0, fontSize: '1.25rem' }}>
              📊 Governance & Compliance Insights
            </h2>
            <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
              Brand: <strong>{brandName}</strong> (<code>{brandId}</code>)
            </div>
          </div>
          <button className="btn btn--ghost btn--sm" onClick={onClose} aria-label="Close modal">✕</button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 'var(--space-10)' }}>
            <Spinner size="lg" label="Computing real-data insights…" />
          </div>
        ) : error ? (
          <Alert kind="error">{error}</Alert>
        ) : insights ? (
          <div>
            {/* KPI Cards Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 'var(--space-3)', marginBottom: 'var(--space-5)' }}>
              <div className="card" style={{ padding: 'var(--space-3)', textAlign: 'center', background: 'var(--glass-bg)' }}>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {insights.reviewed_items_denominator}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Reviewed Items (Denominator)</div>
              </div>

              <div className="card" style={{ padding: 'var(--space-3)', textAlign: 'center', background: 'var(--glass-bg)' }}>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--color-error)' }}>
                  {insights.confirmed_total}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Confirmed Violations</div>
              </div>

              <div className="card" style={{ padding: 'var(--space-3)', textAlign: 'center', background: 'var(--glass-bg)' }}>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--color-success)' }}>
                  {insights.dismissed_total}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Dismissed Violations</div>
              </div>

              <div className="card" style={{ padding: 'var(--space-3)', textAlign: 'center', background: 'var(--glass-bg)' }}>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--color-warning)' }}>
                  {insights.exception_total}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Exceptions Granted</div>
              </div>

              <div className="card" style={{ padding: 'var(--space-3)', textAlign: 'center', background: 'var(--glass-bg)' }}>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--accent)' }}>
                  {insights.ambiguous_total}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Ambiguity Reports</div>
              </div>
            </div>

            {/* Methodology Disclosures */}
            <div style={{ background: 'var(--accent-muted)', padding: 'var(--space-3)', borderRadius: 'var(--radius-sm)', marginBottom: 'var(--space-5)', fontSize: '0.75rem', lineHeight: 1.5 }}>
              <div><strong>Denominator Definition:</strong> {insights.denominator_definition}</div>
              <div style={{ marginTop: '2px' }}><strong>Ambiguity Definition:</strong> {insights.ambiguity_definition}</div>
            </div>

            {/* Per-Rule Breakdown Table */}
            <div style={{ marginBottom: 'var(--space-5)' }}>
              <h3 style={{ fontSize: '0.9375rem', marginBottom: 'var(--space-2)' }}>Rule Dispositions & Violation Frequency</h3>
              <div style={{ overflowX: 'auto', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-base)', borderBottom: '1px solid var(--border-subtle)', textAlign: 'left' }}>
                      <th style={{ padding: '8px 12px' }}>Source Key</th>
                      <th style={{ padding: '8px 12px' }}>Rule ID</th>
                      <th style={{ padding: '8px 12px' }}>Category</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right' }}>Confirmed</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right' }}>Dismissed</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right' }}>Exceptions</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right' }}>Rate / Item</th>
                    </tr>
                  </thead>
                  <tbody>
                    {insights.rules.length === 0 ? (
                      <tr>
                        <td colSpan={7} style={{ textAlign: 'center', padding: '16px', color: 'var(--text-secondary)' }}>
                          No recorded rule evaluations yet.
                        </td>
                      </tr>
                    ) : (
                      insights.rules.map(r => (
                        <tr key={r.rule_id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                          <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)' }}>{r.source_key}</td>
                          <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)' }}>{r.rule_id}</td>
                          <td style={{ padding: '8px 12px' }}>
                            <span className="badge badge--neutral">{r.category}</span>
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--color-error)' }}>{r.confirmed_items}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--color-success)' }}>{r.dismissed_items}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--color-warning)' }}>{r.exception_items}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600 }}>
                            {r.confirmed_per_reviewed_item !== null
                              ? `${Math.round(r.confirmed_per_reviewed_item * 100)}%`
                              : '—'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn--primary" onClick={onClose}>
                Close
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
