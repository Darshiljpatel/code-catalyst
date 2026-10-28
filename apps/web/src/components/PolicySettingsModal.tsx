import { useDialogFocus } from '../hooks/useDialogFocus';
import React from 'react';
import { getProcessingPolicy, updateProcessingPolicy, ApiResponseError } from '../api/client';
import type { PolicyOut } from '../api/types';
import { Alert, Spinner } from './Primitives';
import { RetentionSettings } from './RetentionSettings';
import { ProviderStatusCard } from './ProviderStatusCard';

interface PolicySettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPolicyUpdated?: (policy: PolicyOut) => void;
}

export function PolicySettingsModal({
  isOpen,
  onClose,
  onPolicyUpdated,
}: PolicySettingsModalProps) {
  const dialogRef = useDialogFocus(isOpen);
  const [policy, setPolicy] = React.useState<PolicyOut | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [enabled, setEnabled] = React.useState(false);
  const [notice, setNotice] = React.useState('');
  const [rationale, setRationale] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);

  React.useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setError(null);
    setSuccess(false);
    getProcessingPolicy()
      .then(p => {
        setPolicy(p);
        setEnabled(p.enabled);
        setNotice(p.notice);
      })
      .catch(err => {
        setError(err instanceof Error ? err.message : 'Failed to load policy');
      })
      .finally(() => setLoading(false));
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!policy) return;
    if (!rationale.trim()) {
      setError('An audit rationale is required to change processing policy.');
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      const updated = await updateProcessingPolicy({
        enabled,
        expected_version: policy.version,
        notice,
        rationale,
      });
      setPolicy(updated);
      setSuccess(true);
      if (onPolicyUpdated) onPolicyUpdated(updated);
      setTimeout(() => {
        onClose();
      }, 1200);
    } catch (err) {
      if (err instanceof ApiResponseError) {
        setError(err.body.message || 'Policy update failed');
      } else {
        setError('Connection error updating policy');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="policy-modal-title">
      <div className="modal-card animate-scale-in">
        <div className="modal-header">
          <h2 id="policy-modal-title" style={{ fontSize: '1.25rem', margin: 0 }}>
            Workspace Processing Policy
          </h2>
          <button className="btn btn--ghost btn--sm" onClick={onClose} aria-label="Close dialog">
            ✕
          </button>
        </div>

        {loading ? (
          <div style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
            <Spinner size="md" label="Loading processing policy…" />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="modal-body">
            <ProviderStatusCard />
            {error && <Alert kind="error">{error}</Alert>}
            {success && <Alert kind="success">Processing policy updated successfully.</Alert>}

            <div className="info-box" style={{ marginBottom: 'var(--space-4)' }}>
              <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
                Provider Boundary: {policy?.provider || 'nebius'} ({policy?.boundary || 'external'})
              </div>
              <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                Configured Model: {policy?.model || 'Qwen/Qwen3-235B-A22B-Instruct-2507'}
                <br />
                Policy Version: {policy?.version}
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: 'var(--space-4)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  id="chk-policy-enabled"
                  checked={enabled}
                  onChange={e => setEnabled(e.target.checked)}
                  style={{ width: '18px', height: '18px', accentColor: 'var(--accent)' }}
                />
                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                  Enable external semantic processing via hosted provider
                </span>
              </label>
              <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: '4px', marginLeft: '28px' }}>
                When disabled, only the built-in local checks (terminology, facts, visual, accessibility) run.
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: 'var(--space-4)' }}>
              <label htmlFor="txt-policy-notice" className="form-label">
                Creator Disclosure Notice
              </label>
              <textarea
                id="txt-policy-notice"
                className="input"
                rows={3}
                value={notice}
                onChange={e => setNotice(e.target.value)}
                required
              />
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                This notice is displayed to creators before they consent to external analysis.
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: 'var(--space-6)' }}>
              <label htmlFor="txt-policy-rationale" className="form-label">
                Administrative Audit Rationale <span style={{ color: 'var(--color-blocker)' }}>*</span>
              </label>
              <input
                id="txt-policy-rationale"
                type="text"
                className="input"
                placeholder="e.g. Approved data protection terms with Token Factory"
                value={rationale}
                onChange={e => setRationale(e.target.value)}
                required
              />
            </div>

            <div className="modal-actions">
              <button type="button" className="btn btn--ghost" onClick={onClose}>
                Cancel
              </button>
              <button
                type="submit"
                id="btn-save-policy"
                className="btn btn--primary"
                disabled={saving}
              >
                {saving ? 'Saving…' : 'Save Policy Changes'}
              </button>
            </div>
          </form>
        )}
        {!loading && <div className="modal-body" style={{ paddingTop: 0 }}><RetentionSettings /></div>}
      </div>
    </div>
  );
}
