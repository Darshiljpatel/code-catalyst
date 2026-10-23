import React from 'react';
import type { FindingOut, ResolutionAction } from '../api/types';
import { postResolution } from '../api/client';
import { Alert } from './Primitives';

interface ResolutionModalProps {
  finding: FindingOut;
  expectedItemVersion: number;
  onSuccess: () => void;
  onClose: () => void;
}

export function ResolutionModal({
  finding,
  expectedItemVersion,
  onSuccess,
  onClose,
}: ResolutionModalProps) {
  const [action, setAction] = React.useState<ResolutionAction>('confirm');
  const [rationale, setRationale] = React.useState('');
  const [exceptionTicket, setExceptionTicket] = React.useState('');
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
    if (rationale.trim().length < 10) {
      setError('Resolution rationale must be at least 10 characters long.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const fullRationale = action === 'grant_exception' && exceptionTicket.trim()
        ? `[Ticket: ${exceptionTicket.trim()}] ${rationale.trim()}`
        : rationale.trim();

      await postResolution(finding.id, {
        action,
        rationale: fullRationale,
        expected_item_version: expectedItemVersion,
        source_version_ids: finding.source_version_id ? [finding.source_version_id] : [],
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record resolution.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="resolution-modal-title">
      <div className="modal-content" style={{ maxWidth: '520px', width: '90%' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
          <h2 id="resolution-modal-title" style={{ margin: 0, fontSize: '1.25rem' }}>
            Resolve Finding Disposition
          </h2>
          <button className="btn btn--ghost btn--sm" onClick={onClose} aria-label="Close modal">✕</button>
        </div>

        {error && <Alert kind="error">{error}</Alert>}

        <div style={{ background: 'var(--glass-bg)', padding: 'var(--space-3)', borderRadius: 'var(--radius-sm)', marginBottom: 'var(--space-4)', fontSize: '0.8125rem' }}>
          <div>Category: <strong>{finding.category}</strong> • Severity: <strong>{finding.severity.toUpperCase()}</strong></div>
          <div style={{ marginTop: '4px', fontWeight: 500 }}>"{finding.rationale}"</div>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group" style={{ marginBottom: 'var(--space-4)' }}>
            <label className="form-label" htmlFor="resolution-action">
              Disposition Action
            </label>
            <select
              id="resolution-action"
              className="input"
              value={action}
              onChange={e => setAction(e.target.value as ResolutionAction)}
            >
              <option value="confirm">Confirm Violation (Enforce guideline)</option>
              <option value="dismiss">Dismiss Violation (False positive / approved nuance)</option>
              <option value="grant_exception">Grant Temporary Exception (Requires business rationale)</option>
              <option value="request_exception">Request Exception from Manager</option>
            </select>
          </div>

          {action === 'grant_exception' && (
            <div className="form-group" style={{ marginBottom: 'var(--space-4)' }}>
              <label className="form-label" htmlFor="exception-ticket">
                Exception Ticket / Approval Reference
              </label>
              <input
                id="exception-ticket"
                type="text"
                className="input"
                placeholder="e.g., JIRA-LEG-8492"
                value={exceptionTicket}
                onChange={e => setExceptionTicket(e.target.value)}
              />
            </div>
          )}

          <div className="form-group" style={{ marginBottom: 'var(--space-4)' }}>
            <label className="form-label" htmlFor="resolution-rationale">
              Audit Rationale (min 10 characters) <span style={{ color: 'var(--color-error)' }}>*</span>
            </label>
            <textarea
              id="resolution-rationale"
              className="input"
              rows={3}
              value={rationale}
              onChange={e => setRationale(e.target.value)}
              placeholder="Explain the reason for this human disposition record…"
              required
            />
            <div style={{ fontSize: '0.75rem', color: rationale.trim().length >= 10 ? 'var(--color-success)' : 'var(--text-muted)', marginTop: '4px' }}>
              {rationale.trim().length} / 10 characters minimum
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
            <button type="button" className="btn btn--ghost" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={submitting || rationale.trim().length < 10}
            >
              {submitting ? 'Recording…' : 'Record Disposition'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
