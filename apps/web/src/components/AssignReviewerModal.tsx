import React from 'react';
import { assignReviewer, getReviewers, ApiResponseError } from '../api/client';
import type { ReviewerOut } from '../api/types';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { Alert, Spinner } from './Primitives';

export function AssignReviewerModal({ itemId, currentReviewerId, creatorId, version, onClose, onRefresh, onAssigned }: {
  itemId: string; currentReviewerId: string | null; creatorId: string; version: number;
  onClose: () => void; onRefresh: () => void;
  onAssigned: (email: string) => void;
}) {
  const ref = useDialogFocus();
  const [reviewers, setReviewers] = React.useState<ReviewerOut[]>([]);
  const [selected, setSelected] = React.useState(currentReviewerId || '');
  const [rationale, setRationale] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const [conflict, setConflict] = React.useState(false);
  const [retry, setRetry] = React.useState(0);
  React.useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(''); setReviewers([]);
    getReviewers().then(all => {
      if (cancelled) return;
      const list = all.filter(reviewer => reviewer.id !== creatorId);
      setReviewers(list);
      setSelected(previous => list.some(reviewer => reviewer.id === previous) ? previous : '');
    }).catch(() => { if (!cancelled) setError('Authorized reviewers could not be loaded. Retry the reviewer list.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [creatorId, retry]);
  React.useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && !saving) onClose(); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose, saving]);
  const valid = !loading && !conflict && reviewers.some(reviewer => reviewer.id === selected) && selected !== currentReviewerId && rationale.trim().length >= 20;
  return <div ref={ref} tabIndex={-1} className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="assignment-title">
    <div className="modal-card">
      <div className="modal-header"><h2 id="assignment-title">{currentReviewerId ? 'Change assigned reviewer' : 'Assign a reviewer'}</h2><button type="button" className="btn btn--ghost btn--sm" onClick={onClose} disabled={saving} aria-label="Close reviewer assignment">✕</button></div>
      <form className="modal-body" onSubmit={async e => {
        e.preventDefault(); if (saving || !valid) return;
        setSaving(true); setError('');
        try {
          const updated = await assignReviewer(itemId, selected, version, rationale.trim());
          onAssigned(reviewers.find(reviewer => reviewer.id === updated.reviewer_id)?.email || 'Authorized reviewer');
        }
        catch (err) {
          setConflict(err instanceof ApiResponseError && err.status === 409);
          setError(err instanceof Error ? err.message : 'Reviewer assignment failed. Your rationale is preserved.');
        } finally { setSaving(false); }
      }}>
        <p>Choose a separate authorized reviewer. Changing the assignment requires an audit rationale. A new reviewer must record their own manual checks.</p>
        {error && <Alert kind="error">{error}</Alert>}
        {conflict && <button type="button" className="btn btn--secondary" onClick={onRefresh}>Reload review</button>}
        {loading ? <Spinner label="Loading authorized reviewers…" /> : !error && reviewers.length === 0 ? <p>No separate authorized reviewers are available. Ask the workspace administrator to provision one.</p> : null}
        {!loading && !conflict && <button type="button" className="btn btn--ghost btn--sm" onClick={() => setRetry(n => n + 1)} disabled={saving}>Refresh reviewer list</button>}
        <fieldset disabled={saving || loading || conflict} className="source-dialog-fields">
          <label className="label" htmlFor="assignment-reviewer">Authorized reviewer</label>
          <select id="assignment-reviewer" className="input" value={selected} onChange={e => setSelected(e.target.value)}>
            <option value="">Select a reviewer</option>
            {reviewers.map(reviewer => <option key={reviewer.id} value={reviewer.id}>{reviewer.email}{reviewer.id === currentReviewerId ? ' (currently assigned)' : ''}</option>)}
          </select>
          <label className="label" htmlFor="assignment-rationale">Assignment rationale (at least 20 characters)</label>
          <textarea id="assignment-rationale" className="input" rows={3} maxLength={4000} value={rationale} onChange={e => setRationale(e.target.value)} />
          <p>{rationale.trim().length} / 20 characters minimum</p>
          <div className="modal-actions"><button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button><button type="submit" className="btn btn--primary" disabled={saving || !valid}>{saving ? 'Saving assignment…' : 'Save reviewer assignment'}</button></div>
        </fieldset>
      </form>
    </div>
  </div>;
}
