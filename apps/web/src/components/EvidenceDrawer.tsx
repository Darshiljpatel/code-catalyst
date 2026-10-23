import type { FindingOut, SourceOut } from '../api/types';
import { SeverityBadge } from './Primitives';

interface EvidenceDrawerProps {
  finding: FindingOut | null;
  sources: SourceOut[];
  onClose: () => void;
  onJumpToText?: () => void;
}

export function EvidenceDrawer({
  finding,
  sources,
  onClose,
  onJumpToText,
}: EvidenceDrawerProps) {
  if (!finding) return null;

  // Find corresponding source
  const source = sources.find(
    s => s.id === finding.source_version_id || s.rules.some(r => r.id === finding.rule_id)
  );

  const matchedRule = source?.rules.find(r => r.id === finding.rule_id);

  const evidenceStatusLabels: Record<string, { label: string; cls: string }> = {
    contradicted: { label: 'Contradicted by approved fact', cls: 'blocker' },
    unsupported: { label: 'Unverified / Unsupported claim', cls: 'blocker' },
    supported_violation: { label: 'Approved guideline violation', cls: 'warning' },
    manual: { label: 'Manual review required', cls: 'warning' },
    advisory: { label: 'Advisory style recommendation', cls: 'advisory' },
    conflicting: { label: 'Conflicting source guidelines', cls: 'blocker' },
  };

  const statusInfo = evidenceStatusLabels[finding.evidence_status] || {
    label: finding.evidence_status,
    cls: 'neutral',
  };

  return (
    <div className="drawer-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="evidence-title">
      <aside className="drawer-content animate-slide-in-right" onClick={e => e.stopPropagation()}>
        <div className="drawer-header">
          <div>
            <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.05em' }}>
              Evidence & Grounding Drawer
            </span>
            <h2 id="evidence-title" style={{ margin: '4px 0 0', fontSize: '1.2rem' }}>
              Finding #{finding.id.slice(0, 8)}
            </h2>
          </div>
          <button className="btn btn--ghost btn--sm" onClick={onClose} aria-label="Close evidence drawer">
            ✕
          </button>
        </div>

        <div className="drawer-body">
          {/* Status & Severity */}
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
            <SeverityBadge severity={finding.severity as any} />
            <span className={`badge badge--${statusInfo.cls}`}>
              {statusInfo.label}
            </span>
            <span className="badge badge--neutral">
              {finding.category}
            </span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Origin: <strong>{finding.origin}</strong>
            </span>
          </div>

          {/* Rationale */}
          <div className="info-box" style={{ marginBottom: 'var(--space-5)' }}>
            <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '4px', color: 'var(--text-primary)' }}>
              Compliance Rationale:
            </div>
            <div style={{ fontSize: '0.875rem', lineHeight: 1.5, color: 'var(--text-secondary)' }}>
              {finding.rationale}
            </div>
          </div>

          {/* Approved Source Evidence */}
          <div style={{ marginBottom: 'var(--space-5)' }}>
            <h3 style={{ fontSize: '0.9375rem', margin: '0 0 var(--space-2)', color: 'var(--text-primary)' }}>
              Approved Guideline Source
            </h3>

            {source ? (
              <div className="card" style={{ padding: 'var(--space-4)', background: 'var(--bg-base)' }}>
                <div style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: '4px' }}>
                  {source.title}
                </div>
                <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: 'var(--space-3)' }}>
                  Source Key: <code>{source.source_key}</code> • Version: v{source.version} • Status: <span className="badge badge--success" style={{ fontSize: '0.6875rem' }}>ACTIVE</span>
                </div>

                <div style={{ marginBottom: 'var(--space-3)' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    Authoritative Evidence Quote:
                  </div>
                  <div style={{ padding: 'var(--space-3)', background: 'var(--glass-bg)', borderLeft: '3px solid var(--accent)', fontStyle: 'italic', fontSize: '0.875rem', color: 'var(--text-primary)' }}>
                    "{finding.evidence_quote || matchedRule?.evidence_quote || 'Refer to full source text'}"
                  </div>
                </div>

                {matchedRule && (
                  <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                    Rule: <code>{matchedRule.id}</code> ({matchedRule.kind}) → Fact: <strong>{matchedRule.key}</strong> = <em>"{matchedRule.value}"</em>
                  </div>
                )}
              </div>
            ) : (
              <div className="card" style={{ padding: 'var(--space-4)', background: 'var(--bg-base)' }}>
                <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                  {finding.evidence_quote ? (
                    <div>
                      <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                        Cited Evidence:
                      </div>
                      <div style={{ padding: 'var(--space-3)', background: 'var(--glass-bg)', borderLeft: '3px solid var(--color-blocker)', fontStyle: 'italic', fontSize: '0.875rem' }}>
                        "{finding.evidence_quote}"
                      </div>
                    </div>
                  ) : (
                    <div style={{ color: 'var(--color-blocker)', fontStyle: 'italic' }}>
                      No approved source found substantiating this claim. Grounding check marked this claim unverified.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Location in Draft Copy */}
          <div style={{ marginBottom: 'var(--space-5)' }}>
            <h3 style={{ fontSize: '0.9375rem', margin: '0 0 var(--space-2)', color: 'var(--text-primary)' }}>
              Location in Draft Copy
            </h3>
            <div className="card" style={{ padding: 'var(--space-3)', background: 'var(--bg-base)', fontSize: '0.8125rem' }}>
              <div>Block: <code>{finding.location?.block_id || 'text'}</code></div>
              {finding.location?.start !== undefined && (
                <div>Offsets: Unicode code-points [{finding.location.start} : {finding.location.end}]</div>
              )}
              {onJumpToText && (
                <button
                  className="btn btn--secondary btn--sm"
                  onClick={onJumpToText}
                  style={{ marginTop: 'var(--space-2)' }}
                >
                  Highlight in Document Preview
                </button>
              )}
            </div>
          </div>

          {/* Suggested Edit if available */}
          {finding.suggested_edit && (
            <div style={{ marginBottom: 'var(--space-4)' }}>
              <h3 style={{ fontSize: '0.9375rem', margin: '0 0 var(--space-2)', color: 'var(--color-success)' }}>
                Proposed Compliant Correction
              </h3>
              <div style={{ padding: 'var(--space-3)', background: 'hsla(142, 70%, 45%, 0.1)', border: '1px solid hsla(142, 70%, 45%, 0.3)', borderRadius: 'var(--radius-md)' }}>
                <code style={{ fontSize: '0.875rem', color: 'var(--color-success)', whiteSpace: 'pre-wrap' }}>
                  {finding.suggested_edit}
                </code>
              </div>
            </div>
          )}
        </div>

        <div className="drawer-footer">
          <button className="btn btn--ghost" onClick={onClose}>
            Close Drawer
          </button>
        </div>
      </aside>
    </div>
  );
}
