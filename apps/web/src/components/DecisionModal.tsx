import { useDialogFocus } from '../hooks/useDialogFocus';
import React from 'react';
import type { DecisionKind } from '../api/types';
import { createDecision } from '../api/client';
import { Alert } from './Primitives';

interface DecisionModalProps {
  revisionId: string;
  expectedItemVersion: number;
  expectedRunId: string;
  expectedSourceEpoch: number;
  kind: DecisionKind;
  onSuccess: () => void;
  onClose: () => void;
}

export function DecisionModal({
  revisionId,
  expectedItemVersion,
  expectedRunId,
  expectedSourceEpoch,
  kind,
  onSuccess,
  onClose,
}: DecisionModalProps) {
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

  const isApproval = kind === 'approved';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (rationale.trim().length < 20) {
      setError('Audit rationale must be at least 20 characters long.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await createDecision(revisionId, {
        kind,
        rationale: rationale.trim(),
        expected_item_version: expectedItemVersion,
        expected_run_id: expectedRunId,
        expected_source_epoch: expectedSourceEpoch,
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Decision recording failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose} ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="decision-modal-title">
      <div className="modal-content" style={{ maxWidth: '540px', width: '90%' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
          <h2 id="decision-modal-title" style={{ margin: 0, fontSize: '1.25rem', color: isApproval ? 'var(--color-success)' : 'var(--color-warning)' }}>
            {isApproval ? '✓ Approve Exact Revision' : '⟲ Request Revisions / Changes'}
          </h2>
          <button className="btn btn--ghost btn--sm" onClick={onClose} aria-label="Close modal">✕</button>
        </div>

        {error && <Alert kind="error">{error}</Alert>}

        <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: 'var(--space-4)' }}>
          {isApproval
            ? 'Approving records an immutable cryptographic audit decision for this exact revision and enables final publication export.'
            : 'Requesting changes transitions the campaign to CHANGES_REQUESTED and returns it to the creator for editing.'}
        </p>

        <form onSubmit={handleSubmit}>
          <div className="form-group" style={{ marginBottom: 'var(--space-4)' }}>
            <label className="form-label" htmlFor="decision-rationale">
              Audit Rationale (min 20 characters) <span style={{ color: 'var(--color-error)' }}>*</span>
            </label>
            <textarea
              id="decision-rationale"
              className="input"
              rows={4}
              value={rationale}
              onChange={e => setRationale(e.target.value)}
              placeholder={isApproval
                ? 'e.g., All terminology and fact claims match active brand guidelines; alt-text manually verified.'
                : 'e.g., Unsubstantiated claims remain in paragraph 2; please re-align with 14-day trial guidelines.'}
              required
            />
            <div style={{ fontSize: '0.75rem', color: rationale.trim().length >= 20 ? 'var(--color-success)' : 'var(--text-muted)', marginTop: '4px' }}>
              {rationale.trim().length} / 20 characters minimum
            </div>
          </div>

          <div style={{ background: 'var(--glass-bg)', padding: 'var(--space-3)', borderRadius: 'var(--radius-sm)', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 'var(--space-5)' }}>
            <div>Target Revision: <code>{revisionId}</code></div>
            <div>Workflow Version: <strong>#{expectedItemVersion}</strong></div>
            <div>Guideline version: <strong>#{expectedSourceEpoch}</strong></div>
            <div>Target Run: <code>{expectedRunId}</code></div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
            <button type="button" className="btn btn--ghost" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button
              type="submit"
              className={`btn ${isApproval ? 'btn--primary' : 'btn--secondary'}`}
              disabled={submitting || rationale.trim().length < 20}
            >
              {submitting ? 'Recording decision…' : isApproval ? '✓ Confirm Approval' : '⟲ Submit Changes Request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
