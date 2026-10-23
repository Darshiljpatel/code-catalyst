import { useDialogFocus } from '../hooks/useDialogFocus';
import React from 'react';
import { createAmbiguityReport } from '../api/client';
import { Alert } from './Primitives';

interface AmbiguityReportModalProps {
  sourceId: string;
  sourceTitle?: string;
  ruleId?: string | null;
  revisionId?: string | null;
  onSuccess: () => void;
  onClose: () => void;
}

export function AmbiguityReportModal({
  sourceId,
  sourceTitle,
  ruleId,
  revisionId,
  onSuccess,
  onClose,
}: AmbiguityReportModalProps) {
  const dialogRef = useDialogFocus();
  const [rationale, setRationale] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (rationale.trim().length < 20) {
      setError('Ambiguity rationale must be at least 20 characters long.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await createAmbiguityReport(sourceId, {
        rationale: rationale.trim(),
        rule_id: ruleId || null,
        revision_id: revisionId || null,
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit ambiguity report.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose} ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="ambiguity-modal-title">
      <div className="modal-content" style={{ maxWidth: '520px', width: '90%' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
          <h2 id="ambiguity-modal-title" style={{ margin: 0, fontSize: '1.25rem' }}>
            🚩 Report Ambiguous Guideline
          </h2>
          <button className="btn btn--ghost btn--sm" onClick={onClose} aria-label="Close modal">✕</button>
        </div>

        {error && <Alert kind="error">{error}</Alert>}

        <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: 'var(--space-4)' }}>
          Report unclear, contradictory, or ungrounded rules to the brand management team for guideline revision.
        </p>

        <div style={{ background: 'var(--glass-bg)', padding: 'var(--space-3)', borderRadius: 'var(--radius-sm)', marginBottom: 'var(--space-4)', fontSize: '0.8125rem' }}>
          <div>Source: <strong>{sourceTitle || sourceId}</strong></div>
          {ruleId && <div>Target Rule ID: <code>{ruleId}</code></div>}
          {revisionId && <div>Associated Revision: <code>{revisionId}</code></div>}
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group" style={{ marginBottom: 'var(--space-4)' }}>
            <label className="form-label" htmlFor="ambiguity-rationale">
              Explanation of Ambiguity (min 20 characters) <span style={{ color: 'var(--color-error)' }}>*</span>
            </label>
            <textarea
              id="ambiguity-rationale"
              className="input"
              rows={4}
              value={rationale}
              onChange={e => setRationale(e.target.value)}
              placeholder="Describe where the guideline contradicts itself or lacks clarity in practice…"
              required
            />
            <div style={{ fontSize: '0.75rem', color: rationale.trim().length >= 20 ? 'var(--color-success)' : 'var(--text-muted)', marginTop: '4px' }}>
              {rationale.trim().length} / 20 characters minimum
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
            <button type="button" className="btn btn--ghost" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={submitting || rationale.trim().length < 20}
            >
              {submitting ? 'Submitting…' : 'File Ambiguity Report'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
