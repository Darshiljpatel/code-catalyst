import { useDialogFocus } from '../hooks/useDialogFocus';
import type { RevisionOut } from '../api/types';
import { DiffViewer } from './DiffViewer';

interface ConflictResolutionModalProps {
  serverRevision: RevisionOut;
  localDraftText: string;
  onOverwrite: () => void;
  onDiscard: () => void;
  onClose: () => void;
}

export function ConflictResolutionModal({
  serverRevision,
  localDraftText,
  onOverwrite,
  onDiscard,
  onClose,
}: ConflictResolutionModalProps) {
  const dialogRef = useDialogFocus();
  return (
    <div className="modal-backdrop" ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="conflict-title">
      <div className="modal-card modal-card--lg animate-scale-in">
        <div className="modal-header">
          <div>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-blocker)', textTransform: 'uppercase' }}>
              Concurrency Conflict Detected (HTTP 409)
            </span>
            <h2 id="conflict-title" style={{ margin: '4px 0 0', fontSize: '1.25rem' }}>
              Stale Revision Conflict
            </h2>
          </div>
          <button className="btn btn--ghost btn--sm" onClick={onClose} aria-label="Close dialog">
            ✕
          </button>
        </div>

        <div className="modal-body">
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', margin: '0 0 var(--space-4)' }}>
            Another revision (<strong>Rev #{serverRevision.number}</strong> by <code>{serverRevision.author_id}</code>) was saved on the server while you were editing. Your current edits have been preserved below.
          </p>

          <DiffViewer
            originalText={serverRevision.text}
            modifiedText={localDraftText}
            originalLabel={`Server Latest (Rev #${serverRevision.number})`}
            modifiedLabel="Your In-Flight Edits"
          />
        </div>

        <div className="modal-actions" style={{ justifyContent: 'space-between' }}>
          <button className="btn btn--ghost btn--sm" onClick={onDiscard}>
            Discard my edits & load Rev #{serverRevision.number}
          </button>

          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button className="btn btn--secondary" onClick={onClose}>
              Keep editing locally
            </button>
            <button className="btn btn--primary" onClick={onOverwrite}>
              Save as Rev #{serverRevision.number + 1} (Re-base)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
