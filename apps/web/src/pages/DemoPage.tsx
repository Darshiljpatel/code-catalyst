/**
 * DemoPage — fictional LumaDesk example (IMPLEMENTATION_PLAN.md §6)
 *
 * Uses fixture data to show the full workflow UI before real S2–S4 APIs land.
 * Labelled clearly as SYNTHETIC / FICTIONAL throughout.
 * This page uses the canonical fixtures from fixtures.ts — same data
 * that will drive real integration tests (T11, T26).
 *
 * D2–D4 route this page to real data once APIs are available.
 */
import React from 'react';
import { SeverityBadge, Alert, CheckStatusChip } from '../components/Primitives';
import {
  FIXTURE_LUMADESK_DRAFT_TEXT,
  FIXTURE_FINDINGS,
  FIXTURE_REVIEW_RUN,
  FIXTURE_BRAND,
} from '../api/fixtures';

export function DemoPage() {
  const [openFinding, setOpenFinding] = React.useState<string | null>(null);

  return (
    <main className="page-container" id="main-content">
      {/* Fictional label */}
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <Alert kind="warning">
          <strong>Fictional scenario.</strong> All data below is synthetic and
          labelled for demonstration only. No real brand, product or campaign is
          represented.
        </Alert>
      </div>

      <div style={{ marginBottom: 'var(--space-8)' }}>
        <h1 style={{ marginBottom: 'var(--space-2)' }}>LumaDesk campaign review</h1>
        <p style={{ color: 'var(--text-secondary)' }}>
          Brand: <strong>{FIXTURE_BRAND.name}</strong> (fictional) ·
          Source epoch: {FIXTURE_BRAND.source_epoch}
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-6)' }}>
        {/* Draft panel */}
        <section aria-labelledby="draft-heading">
          <h2 id="draft-heading" style={{ marginBottom: 'var(--space-4)' }}>Draft content</h2>
          <div
            className="card"
            style={{
              padding: 'var(--space-6)',
              fontFamily: 'serif',
              lineHeight: 1.8,
              fontSize: '1.0625rem',
            }}
            aria-label="Draft text for review"
          >
            {FIXTURE_LUMADESK_DRAFT_TEXT}
          </div>

          {/* Check statuses */}
          <div style={{ marginTop: 'var(--space-5)' }}>
            <h3 style={{ marginBottom: 'var(--space-3)', fontSize: '0.9375rem' }}>
              Analysis checks
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {FIXTURE_REVIEW_RUN.checks.map(checkItem => (
                <div
                  key={checkItem.category}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--space-3) var(--space-4)', background: 'var(--bg-raised)', borderRadius: 'var(--radius-md)' }}
                >
                  <span style={{ textTransform: 'capitalize', fontSize: '0.9rem' }}>{checkItem.category.replace('_', ' ')}</span>
                  <CheckStatusChip status={checkItem.status} title={checkItem.reason} />
                </div>
              ))}
            </div>
            {FIXTURE_REVIEW_RUN.checks.some(c => c.category === 'messaging' && c.status === 'unavailable') && (
              <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: 'var(--space-3)' }}>
                Semantic messaging checks are unavailable — no external provider is configured.
                These findings require explicit manual completion by a reviewer.
              </p>
            )}
          </div>
        </section>

        {/* Findings panel */}
        <section aria-labelledby="findings-heading">
          <h2 id="findings-heading" style={{ marginBottom: 'var(--space-4)' }}>
            Findings ({FIXTURE_FINDINGS.length})
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {FIXTURE_FINDINGS.map(finding => (
              <div
                key={finding.id}
                className="card--raised"
                style={{ padding: 'var(--space-4)', cursor: 'pointer', border: `1px solid ${openFinding === finding.id ? 'var(--accent)' : 'var(--border-default)'}`, transition: 'border-color 200ms' }}
              >
                <button
                  id={`btn-finding-${finding.id}`}
                  style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', color: 'inherit', padding: 0 }}
                  onClick={() => setOpenFinding(openFinding === finding.id ? null : finding.id)}
                  aria-expanded={openFinding === finding.id}
                  aria-controls={`finding-detail-${finding.id}`}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
                    <SeverityBadge severity={finding.severity} />
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'capitalize' }}>
                      {finding.category} · {finding.origin}
                    </span>
                  </div>
                  <p style={{ fontSize: '0.9rem' }}>{finding.rationale}</p>
                </button>

                {/* Evidence drawer */}
                {openFinding === finding.id && (
                  <div id={`finding-detail-${finding.id}`} style={{ marginTop: 'var(--space-4)', paddingTop: 'var(--space-4)', borderTop: '1px solid var(--border-subtle)' }}>
                    {finding.evidence_quote && (
                      <div style={{ marginBottom: 'var(--space-3)' }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Source quote</span>
                        <blockquote style={{ marginTop: 'var(--space-1)', padding: 'var(--space-3)', background: 'var(--bg-base)', borderLeft: '3px solid var(--accent)', borderRadius: '0 var(--radius-sm) var(--radius-sm) 0', fontSize: '0.875rem', fontStyle: 'italic' }}>
                          {finding.evidence_quote}
                        </blockquote>
                      </div>
                    )}
                    {finding.suggested_edit && (
                      <div>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Suggested edit</span>
                        <div style={{ marginTop: 'var(--space-1)', padding: 'var(--space-3)', background: 'var(--color-success-muted)', borderRadius: 'var(--radius-sm)', fontSize: '0.875rem', color: 'var(--color-success)' }}>
                          "{finding.suggested_edit}"
                        </div>
                      </div>
                    )}
                    {!finding.suggested_edit && (
                      <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                        No suggested edit. This finding requires manual review.
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Approval blocker explanation */}
          <div style={{ marginTop: 'var(--space-6)', padding: 'var(--space-4)', background: 'var(--color-blocker-muted)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-blocker)' }}>
            <p style={{ fontSize: '0.875rem', color: 'var(--color-blocker)', fontWeight: 500 }}>
              ⛔ Approval blocked — {FIXTURE_FINDINGS.filter(f => f.severity === 'blocker').length} unresolved blocker findings.
            </p>
            <p style={{ fontSize: '0.8125rem', marginTop: 'var(--space-2)', color: 'var(--text-secondary)' }}>
              Resolve each blocker or obtain an authorised revision-specific exception
              before submitting for review.
            </p>
          </div>
        </section>
      </div>

      {/* Responsive stack on narrow screens */}
      <style>{`
        @media (max-width: 720px) {
          .demo-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </main>
  );
}
