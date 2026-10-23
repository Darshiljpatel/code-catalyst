import React from 'react';
import type { FindingOut } from '../api/types';

interface EditSuggestionModalProps {
  finding: FindingOut;
  onApply: (replacementText: string) => void;
  onClose: () => void;
}

export function EditSuggestionModal({
  finding,
  onApply,
  onClose,
}: EditSuggestionModalProps) {
  const [editedSuggestion, setEditedSuggestion] = React.useState(
    finding.suggested_edit || ''
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editedSuggestion.trim()) return;
    onApply(editedSuggestion.trim());
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="suggestion-modal-title">
      <div className="modal-card animate-scale-in">
        <div className="modal-header">
          <h2 id="suggestion-modal-title" style={{ margin: 0, fontSize: '1.2rem' }}>
            Review Proposed Edit
          </h2>
          <button className="btn btn--ghost btn--sm" onClick={onClose} aria-label="Close dialog">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body">
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>
              COMPLIANCE RATIONALE
            </span>
            <p style={{ margin: '4px 0 0', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
              {finding.rationale}
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
            <div>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-blocker)' }}>
                CURRENT NON-COMPLIANT TEXT
              </span>
              <div
                style={{
                  padding: 'var(--space-3)',
                  background: 'hsla(0, 84%, 60%, 0.1)',
                  border: '1px solid hsla(0, 84%, 60%, 0.3)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.875rem',
                  marginTop: '4px',
                  color: 'var(--text-primary)',
                }}
              >
                "{finding.evidence_quote || 'Selected text segment'}"
              </div>
            </div>

            <div>
              <label htmlFor="txt-edit-suggestion" style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-success)', display: 'block', marginBottom: '4px' }}>
                PROPOSED REPLACEMENT (EDITABLE)
              </label>
              <textarea
                id="txt-edit-suggestion"
                className="input"
                rows={3}
                value={editedSuggestion}
                onChange={e => setEditedSuggestion(e.target.value)}
                required
              />
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                You may customize the wording before inserting into your draft.
              </div>
            </div>
          </div>

          <div className="modal-actions">
            <button type="button" className="btn btn--ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={!editedSuggestion.trim()}
            >
              Apply to Editor & Review
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
