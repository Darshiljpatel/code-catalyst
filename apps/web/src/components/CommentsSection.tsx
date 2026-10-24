import React from 'react';
import { getComments, postComment, ApiResponseError } from '../api/client';
import type { CommentOut } from '../api/types';
import { Alert, Spinner } from './Primitives';

interface CommentsSectionProps {
  revisionId: string;
  activeFindingId?: string | null;
  findings?: { id: string; rationale: string }[];
}

export function CommentsSection({
  revisionId,
  activeFindingId,
  findings,
}: CommentsSectionProps) {
  // Draft notes and request state must never migrate to another revision.
  return <RevisionDiscussion key={revisionId} revisionId={revisionId} activeFindingId={activeFindingId} findings={findings} />;
}

function RevisionDiscussion({
  revisionId,
  activeFindingId: focusedFindingId,
  findings = [],
}: CommentsSectionProps) {
  const [selectedFindingId, setSelectedFindingId] = React.useState<string | null>(null);
  const candidateFindingId = selectedFindingId ?? focusedFindingId;
  // A rerun replaces finding IDs while keeping this revision and its note draft.
  const activeFindingId = findings.some(finding => finding.id === candidateFindingId)
    ? candidateFindingId : null;
  const [comments, setComments] = React.useState<CommentOut[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [newCommentText, setNewCommentText] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [filterByFinding, setFilterByFinding] = React.useState(false);
  const [attachToFinding, setAttachToFinding] = React.useState(false);
  const [refresh, setRefresh] = React.useState(0);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState('');
  const alive = React.useRef(true);

  React.useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    getComments(revisionId)
      .then(data => { if (!cancelled) setComments(data); })
      .catch(() => { if (!cancelled) setLoadError('Discussion could not be loaded.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [revisionId, refresh]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCommentText.trim() || submitting || loading || loadError) return;

    setSubmitting(true);
    setError(null);
    setNotice('');
    try {
      const created = await postComment(revisionId, {
        text: newCommentText.trim(),
        finding_id: attachToFinding && activeFindingId ? activeFindingId : null,
      });
      if (!alive.current) return;
      setComments(prev => [...prev, created]);
      setNewCommentText('');
      setNotice(created.finding_id ? 'Note posted to the selected finding.' : 'Note posted to this revision.');
    } catch (err) {
      if (!alive.current) return;
      if (err instanceof ApiResponseError) {
        setError(err.body.message || 'Failed to post comment');
      } else {
        setError('Connection error posting comment');
      }
    } finally {
      if (alive.current) setSubmitting(false);
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
        <button className="btn btn--ghost btn--sm" onClick={() => setRefresh(n => n + 1)} disabled={loading || submitting}>Refresh discussion</button>

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
      {loadError && <Alert kind="error">{loadError} <button className="btn btn--ghost btn--sm" onClick={() => setRefresh(n => n + 1)}>Retry discussion</button></Alert>}
      {notice && <p role="status">{notice}</p>}
      {findings.length > 0 && <div className="field">
        <label htmlFor={`discussion-finding-${revisionId}`}>Finding for discussion</label>
        <select id={`discussion-finding-${revisionId}`} className="input" value={activeFindingId || ''} onChange={e => { setSelectedFindingId(e.target.value); setFilterByFinding(false); setAttachToFinding(false); }} disabled={submitting}>
          <option value="">All revision notes</option>
          {findings.map(f => <option value={f.id} key={f.id}>{f.rationale.slice(0, 100)}</option>)}
        </select>
      </div>}

      {loadError ? null : loading ? (
        <div style={{ textAlign: 'center', padding: 'var(--space-4)' }}>
          <Spinner size="sm" label="Loading discussion…" />
        </div>
      ) : visibleComments.length === 0 ? (
        <div style={{ padding: 'var(--space-4)', color: 'var(--text-muted)', fontSize: '0.875rem', fontStyle: 'italic', textAlign: 'center' }}>
          {filterByFinding && activeFindingId ? 'No notes for the selected finding. Clear the filter to see all revision notes.' : 'No comments recorded for this revision yet. Creators and reviewers can collaborate below.'}
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
                <time dateTime={comment.created_at} style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {new Date(comment.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                </time>
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
          maxLength={4000}
          disabled={submitting}
          placeholder={
            attachToFinding && activeFindingId
              ? `Add a comment attached to finding #${activeFindingId.slice(0, 8)}…`
              : 'Add a collaboration note or question for the reviewer…'
          }
          value={newCommentText}
          onChange={e => setNewCommentText(e.target.value)}
          required
        />
        {activeFindingId && <label style={{ fontSize: '0.8125rem' }}>
          <input type="checkbox" checked={attachToFinding} onChange={e => setAttachToFinding(e.target.checked)} disabled={submitting} /> Attach this note to finding #{activeFindingId.slice(0, 8)}
        </label>}
        <small>{newCommentText.length} / 4000 characters · {attachToFinding && activeFindingId ? 'Finding note' : 'Revision note'}</small>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="submit"
            className="btn btn--secondary btn--sm"
            disabled={submitting || loading || Boolean(loadError) || !newCommentText.trim()}
          >
            {submitting ? 'Posting…' : 'Post Comment'}
          </button>
        </div>
      </form>
    </section>
  );
}
