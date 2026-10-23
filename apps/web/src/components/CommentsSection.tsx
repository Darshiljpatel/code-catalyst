import React from 'react';
import { getComments, postComment, ApiResponseError } from '../api/client';
import type { CommentOut } from '../api/types';
import { Alert, Spinner } from './Primitives';

interface CommentsSectionProps {
  revisionId: string;
  activeFindingId?: string | null;
}

export function CommentsSection({
  revisionId,
  activeFindingId,
}: CommentsSectionProps) {
  const [comments, setComments] = React.useState<CommentOut[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [newCommentText, setNewCommentText] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [filterByFinding, setFilterByFinding] = React.useState(false);

  const loadComments = React.useCallback(async () => {
    if (!revisionId) return;
    setLoading(true);
    try {
      const data = await getComments(revisionId);
      setComments(data);
    } catch {
      setError('Comments could not be loaded. Retry before reviewing the discussion.');
    } finally {
      setLoading(false);
    }
  }, [revisionId]);

  React.useEffect(() => {
    loadComments();
  }, [loadComments]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCommentText.trim()) return;

    setSubmitting(true);
    setError(null);
    try {
      const created = await postComment(revisionId, {
        text: newCommentText.trim(),
        finding_id: filterByFinding && activeFindingId ? activeFindingId : null,
      });
      setComments(prev => [...prev, created]);
      setNewCommentText('');
    } catch (err) {
      if (err instanceof ApiResponseError) {
        setError(err.body.message || 'Failed to post comment');
      } else {
        setError('Connection error posting comment');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const visibleComments = React.useMemo(() => {
    if (!filterByFinding || !activeFindingId) return comments;
    return comments.filter(c => c.finding_id === activeFindingId);
  }, [comments, filterByFinding, activeFindingId]);

  return (
    <section className="comments-section card" style={{ padding: 'var(--space-5)', marginTop: 'var(--space-6)' }} aria-labelledby="comments-heading">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
        <h3 id="comments-heading" style={{ margin: 0, fontSize: '1.0625rem' }}>
          Discussion & notes ({comments.length})
        </h3>

        {activeFindingId && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: '0.8125rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={filterByFinding}
              onChange={e => setFilterByFinding(e.target.checked)}
            />
            <span>Show only comments for selected finding</span>
          </label>
        )}
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 'var(--space-4)' }}>
          <Spinner size="sm" label="Loading discussion…" />
        </div>
      ) : visibleComments.length === 0 ? (
        <div style={{ padding: 'var(--space-4)', color: 'var(--text-muted)', fontSize: '0.875rem', fontStyle: 'italic', textAlign: 'center' }}>
          No comments recorded for this revision yet. Creators and reviewers can collaborate below.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
          {visibleComments.map(comment => (
            <div
              key={comment.id}
              style={{
                padding: 'var(--space-3) var(--space-4)',
                background: 'var(--bg-base)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  {comment.author_id}
                </span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {new Date(comment.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <div style={{ fontSize: '0.875rem', lineHeight: 1.5, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>
                {comment.text}
              </div>
              {comment.finding_id && (
                <div style={{ marginTop: '4px', fontSize: '0.6875rem', color: 'var(--accent)' }}>
                  ↳ Attached to finding #{comment.finding_id.slice(0, 8)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* New Comment Input */}
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <textarea
          aria-label="Add a discussion note"
          className="input"
          rows={2}
          placeholder={
            filterByFinding && activeFindingId
              ? `Add a comment attached to finding #${activeFindingId.slice(0, 8)}…`
              : 'Add a collaboration note or question for the reviewer…'
          }
          value={newCommentText}
          onChange={e => setNewCommentText(e.target.value)}
          required
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="submit"
            className="btn btn--secondary btn--sm"
            disabled={submitting || !newCommentText.trim()}
          >
            {submitting ? 'Posting…' : 'Post Comment'}
          </button>
        </div>
      </form>
    </section>
  );
}
