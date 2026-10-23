import { useDialogFocus } from '../hooks/useDialogFocus';
import React from 'react';
import type { RevisionOut } from '../api/types';
import { DiffViewer } from './DiffViewer';
import { Alert } from './Primitives';

interface ConflictResolutionModalProps {
  serverRevision: RevisionOut;
  localDraftText: string;
  onOverwrite: () => void;
  onDiscard: () => void;
  onClose: () => void;
  saving?: boolean;
  error?: string | null;
}

export function ConflictResolutionModal({
  serverRevision,
  localDraftText,
  onOverwrite,
  onDiscard,
  onClose,
  saving = false,
  error,
}: ConflictResolutionModalProps) {
  const dialogRef = useDialogFocus();
  React.useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && !saving) onClose(); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose, saving]);
  return (
    <div className="modal-backdrop" ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="conflict-title">
      <div className="modal-card modal-card--lg animate-scale-in">
        <div className="modal-header">
          <div>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-blocker)', textTransform: 'uppercase' }}>
              Your edits are preserved
            </span>
            <h2 id="conflict-title" style={{ margin: '4px 0 0', fontSize: '1.25rem' }}>
              A newer revision was saved
            </h2>
          </div>
          <button className="btn btn--ghost btn--sm" onClick={onClose} aria-label="Close dialog" disabled={saving}>
            ✕
          </button>
        </div>

        <div className="modal-body">
          {error && <Alert kind="error">{error}</Alert>}
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', margin: '0 0 var(--space-4)' }}>
            Another revision (<strong>Rev #{serverRevision.number}</strong> by <code>{serverRevision.author_id}</code>) was saved on the server while you were editing. Your current edits have been preserved below.
          </p>
          <p>Compare the versions before saving. Your full working draft will become the next revision; existing versions stay in history.</p>

          <DiffViewer
            originalText={serverRevision.text}
            modifiedText={localDraftText}
            originalLabel={`Server Latest (Rev #${serverRevision.number})`}
            modifiedLabel="Your working draft"
          />
        </div>

        <div className="modal-actions" style={{ justifyContent: 'space-between' }}>
          <button className="btn btn--ghost btn--sm" onClick={onDiscard} disabled={saving}>
            Discard my edits & load Rev #{serverRevision.number}
          </button>

          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button className="btn btn--secondary" onClick={onClose} disabled={saving}>
              Keep editing locally
            </button>
            <button className="btn btn--primary" onClick={onOverwrite} disabled={saving}>
              {saving ? 'Saving your draft…' : `Save my draft as Rev #${serverRevision.number + 1}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
