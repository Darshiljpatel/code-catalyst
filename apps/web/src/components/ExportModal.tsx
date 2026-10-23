import { useDialogFocus } from '../hooks/useDialogFocus';
import React from 'react';
import type { ExportOut } from '../api/types';
import { exportRevision } from '../api/client';
import { Spinner, Alert } from './Primitives';

interface ExportModalProps {
  revisionId: string;
  onClose: () => void;
}

export function ExportModal({ revisionId, onClose }: ExportModalProps) {
  const dialogRef = useDialogFocus();
  const [exportData, setExportData] = React.useState<ExportOut | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  React.useEffect(() => {
    setLoading(true);
    exportRevision(revisionId)
      .then(setExportData)
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to retrieve export record'))
      .finally(() => setLoading(false));
  }, [revisionId]);

  const handleCopyText = () => {
    if (!exportData) return;
    navigator.clipboard.writeText(exportData.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadJson = () => {
    if (!exportData) return;
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `brandguard-export-${exportData.content_id}-rev-${exportData.revision_id.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="modal-backdrop" onClick={onClose} ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="export-modal-title">
      <div className="modal-content" style={{ maxWidth: '680px', width: '90%' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
          <h2 id="export-modal-title" style={{ margin: 0, fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <span>✓</span> Approved Revision Export
          </h2>
          <button className="btn btn--ghost btn--sm" onClick={onClose} aria-label="Close export modal">✕</button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 'var(--space-10)' }}>
            <Spinner size="lg" label="Loading approved export…" />
          </div>
        ) : error ? (
          <Alert kind="error">{error}</Alert>
        ) : exportData ? (
          <div>
            {/* Hash & Verification Stamp */}
            <div style={{ background: 'var(--accent-muted)', padding: 'var(--space-4)', borderRadius: 'var(--radius-sm)', marginBottom: 'var(--space-4)', borderLeft: '4px solid var(--color-success)' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                Approved text checksum
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', wordBreak: 'break-all', color: 'var(--text-primary)' }}>
                SHA-256: <strong>{exportData.text_hash}</strong>
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-4)', fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '6px', flexWrap: 'wrap' }}>
                <div>Decision: <strong style={{ color: 'var(--color-success)' }}>{exportData.decision.kind.toUpperCase()}</strong></div>
                <div>Approver: <code>{exportData.decision.reviewer_id}</code></div>
                <div>Source Epoch: <strong>#{exportData.decision.source_epoch}</strong></div>
                <div>Date: {new Date(exportData.exported_at).toLocaleString()}</div>
              </div>
            </div>

            {/* Approved Copy Block */}
            <div style={{ marginBottom: 'var(--space-4)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
                <label className="form-label" style={{ margin: 0 }}>Approved Publication Copy</label>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={handleCopyText}
                >
                  {copied ? '✓ Copied to clipboard!' : 'Copy approved text'}
                </button>
              </div>
              <div
                style={{
                  background: 'var(--bg-base)',
                  padding: 'var(--space-4)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-subtle)',
                  fontFamily: 'inherit',
                  fontSize: '0.9375rem',
                  lineHeight: 1.6,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {exportData.text}
              </div>
            </div>

            {/* Context metadata */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-3)', fontSize: '0.8125rem', marginBottom: 'var(--space-5)', background: 'var(--glass-bg)', padding: 'var(--space-3)', borderRadius: 'var(--radius-sm)' }}>
              <div>Channel: <strong>{exportData.channel}</strong></div>
              <div>Audience: <strong>{exportData.audience}</strong></div>
              <div>Purpose: <strong>{exportData.purpose}</strong></div>
            </div>

            {/* Decision Rationale */}
            <div style={{ marginBottom: 'var(--space-5)', fontSize: '0.8125rem' }}>
              <strong>Approver Rationale:</strong>
              <div style={{ fontStyle: 'italic', marginTop: '4px', color: 'var(--text-secondary)' }}>
                "{exportData.decision.rationale}"
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
              <button type="button" className="btn btn--ghost" onClick={onClose}>
                Close
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={handleDownloadJson}
              >
                ⬇ Download Audit Record (.json)
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
