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
  return <RevisionExport key={revisionId} revisionId={revisionId} onClose={onClose} />;
}

function RevisionExport({ revisionId, onClose }: ExportModalProps) {
  const dialogRef = useDialogFocus();
  const [exportData, setExportData] = React.useState<ExportOut | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [copying, setCopying] = React.useState(false);
  const [actionError, setActionError] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const [refresh, setRefresh] = React.useState(0);
  const alive = React.useRef(true);
  React.useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setExportData(null);
    setError(null);
    exportRevision(revisionId)
      .then(data => { if (!cancelled) setExportData(data); })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to retrieve export record'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [revisionId, refresh]);

  const handleCopyText = async () => {
    if (!exportData || copying) return;
    setCopying(true); setCopied(false); setActionError(''); setNotice('');
    try {
      await navigator.clipboard.writeText(exportData.text);
      if (alive.current) { setCopied(true); setNotice('Approved text copied to clipboard.'); }
    } catch {
      if (alive.current) setActionError('Clipboard access was denied. Select the approved text to copy it manually, or download the text file.');
    } finally {
      if (alive.current) setCopying(false);
    }
  };

  const handleDownload = (format: 'json' | 'txt') => {
    if (!exportData) return;
    setActionError(''); setNotice('');
    try {
      const blob = new Blob([format === 'json' ? JSON.stringify(exportData, null, 2) : exportData.text], { type: format === 'json' ? 'application/json' : 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `brandguard-export-${exportData.content_id}-rev-${exportData.revision_id.slice(0, 8)}.${format}`;
      document.body.appendChild(a);
      a.click(); a.remove();
      // Give the browser time to consume the URL before releasing it.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(format === 'json' ? 'Audit record download requested.' : 'Approved text download requested. The audit record contains its approval evidence.');
    } catch {
      setActionError('The download could not start. Try again or copy the approved text.');
    }
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
          <Alert kind="error">{error} <button className="btn btn--secondary btn--sm" onClick={() => setRefresh(n => n + 1)}>Retry export</button></Alert>
        ) : exportData ? (
          <div>
            {actionError && <Alert kind="error">{actionError}</Alert>}
            {notice && <p role="status">{notice}</p>}
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
                <div>Guideline version: <strong>#{exportData.decision.source_epoch}</strong></div>
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
                  disabled={copying}
                >
                  {copying ? 'Copying…' : copied ? '✓ Copied to clipboard!' : 'Copy approved text'}
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
                onClick={() => handleDownload('json')}
              >
                ⬇ Download Audit Record (.json)
              </button>
              <button type="button" className="btn btn--secondary" onClick={() => handleDownload('txt')}>Download approved text (.txt)</button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
