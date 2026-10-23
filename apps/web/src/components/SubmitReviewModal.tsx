import { useDialogFocus } from '../hooks/useDialogFocus';
import React from 'react';
import type { ReviewerOut } from '../api/types';
import { getReviewers, submitRevision } from '../api/client';
import { Spinner, Alert } from './Primitives';

interface SubmitReviewModalProps {
  revisionId: string;
  expectedItemVersion: number;
  expectedRunId: string;
  expectedSourceEpoch: number;
  currentReviewerId: string | null;
  onSuccess: () => void;
  onClose: () => void;
}

export function SubmitReviewModal({
  revisionId,
  expectedItemVersion,
  expectedRunId,
  expectedSourceEpoch,
  currentReviewerId,
  onSuccess,
  onClose,
}: SubmitReviewModalProps) {
  const dialogRef = useDialogFocus();
  const [reviewers, setReviewers] = React.useState<ReviewerOut[]>([]);
  const [selectedReviewer, setSelectedReviewer] = React.useState<string>(currentReviewerId || '');
  const [loadingReviewers, setLoadingReviewers] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  React.useEffect(() => {
    getReviewers()
      .then(list => {
        setReviewers(list);
        setSelectedReviewer(current => current || list[0]?.id || '');
      })
      .catch(() => {
        setReviewers([]);
        setSelectedReviewer('');
        setError('Authorized reviewers could not be loaded. Close and retry.');
      })
      .finally(() => setLoadingReviewers(false));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedReviewer) {
      setError('Please select an authorized reviewer');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await submitRevision(revisionId, {
        expected_item_version: expectedItemVersion,
        expected_run_id: expectedRunId,
        expected_source_epoch: expectedSourceEpoch,
        reviewer_id: selectedReviewer,
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submission failed. Please check run status.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose} ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="submit-modal-title">
      <div className="modal-content" style={{ maxWidth: '520px', width: '90%' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
          <h2 id="submit-modal-title" style={{ margin: 0, fontSize: '1.25rem' }}>
            Submit Revision for Review
          </h2>
          <button className="btn btn--ghost btn--sm" onClick={onClose} aria-label="Close modal">✕</button>
        </div>

        {error && <Alert kind="error">{error}</Alert>}

        <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: 'var(--space-4)' }}>
          This will move the campaign to <strong>IN_REVIEW</strong> state and notify the assigned human reviewer.
        </p>

        <form onSubmit={handleSubmit}>
          <div className="form-group" style={{ marginBottom: 'var(--space-4)' }}>
            <label className="form-label" htmlFor="select-reviewer">
              Assign Reviewer
            </label>
            {loadingReviewers ? (
              <Spinner size="sm" label="Loading authorized reviewers…" />
            ) : (
              <select
                id="select-reviewer"
                className="input"
                value={selectedReviewer}
                onChange={e => setSelectedReviewer(e.target.value)}
                required
              >
                {reviewers.map(r => (
                  <option key={r.id} value={r.id}>
                    {r.email} ({r.id})
                  </option>
                ))}
              </select>
            )}
          </div>

          <div style={{ background: 'var(--glass-bg)', padding: 'var(--space-3)', borderRadius: 'var(--radius-sm)', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 'var(--space-5)' }}>
            <div>Workflow Version: <strong>#{expectedItemVersion}</strong></div>
            <div>Source Epoch: <strong>#{expectedSourceEpoch}</strong></div>
            <div>Target Run: <code>{expectedRunId}</code></div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
            <button type="button" className="btn btn--ghost" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={submitting || !selectedReviewer}
            >
              {submitting ? 'Submitting…' : 'Confirm Submission →'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
