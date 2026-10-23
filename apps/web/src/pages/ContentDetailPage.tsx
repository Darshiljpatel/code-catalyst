import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  getContent,
  createRevision,
  startAnalysis,
  getProcessingPolicy,
  ApiResponseError,
} from '../api/client';
import type {
  ContentOut,
  RevisionOut,
  RunOut,
  PolicyOut,
  FindingOut,
} from '../api/types';
import {
  Alert,
  Spinner,
  SeverityBadge,
  CheckStatusChip,
  ProcessingMode,
} from '../components/Primitives';
import { FIXTURE_FINDINGS, FIXTURE_REVIEW_RUN } from '../api/fixtures';

export function ContentDetailPage() {
  const { contentId } = useParams<{ contentId: string }>();
  const navigate = useNavigate();

  const [content, setContent] = React.useState<ContentOut | null>(null);
  const [selectedRevIndex, setSelectedRevIndex] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // Policy
  const [policy, setPolicy] = React.useState<PolicyOut | null>(null);
  const [consent, setConsent] = React.useState(false);

  // Active run state
  const [run, setRun] = React.useState<RunOut | null>(null);
  const [analysing, setAnalysing] = React.useState(false);

  // Edit mode
  const [isEditing, setIsEditing] = React.useState(false);
  const [draftText, setDraftText] = React.useState('');
  const [draftChannel, setDraftChannel] = React.useState('');
  const [draftAudience, setDraftAudience] = React.useState('');
  const [draftPurpose, setDraftPurpose] = React.useState('');
  const [savingRevision, setSavingRevision] = React.useState(false);
  const [conflictError, setConflictError] = React.useState<string | null>(null);

  const loadContent = React.useCallback(async () => {
    if (!contentId) return;
    setLoading(true);
    setError(null);
    try {
      const [item, pol] = await Promise.all([
        getContent(contentId),
        getProcessingPolicy().catch(() => null),
      ]);
      setContent(item);
      setPolicy(pol);
      if (item.revisions && item.revisions.length > 0) {
        const latestIdx = item.revisions.length - 1;
        setSelectedRevIndex(latestIdx);
        const rev = item.revisions[latestIdx];
        setDraftText(rev.text);
        setDraftChannel(rev.channel);
        setDraftAudience(rev.audience);
        setDraftPurpose(rev.purpose);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load content item');
    } finally {
      setLoading(false);
    }
  }, [contentId]);

  React.useEffect(() => {
    loadContent();
  }, [loadContent]);

  const currentRevision: RevisionOut | undefined =
    content?.revisions[selectedRevIndex];

  // Initialize or update fields when switching revisions
  const handleSelectRevision = (index: number) => {
    if (!content) return;
    setSelectedRevIndex(index);
    const rev = content.revisions[index];
    if (rev) {
      setDraftText(rev.text);
      setDraftChannel(rev.channel);
      setDraftAudience(rev.audience);
      setDraftPurpose(rev.purpose);
      setIsEditing(false);
      setConflictError(null);
    }
  };

  const handleSaveRevision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content || !currentRevision) return;

    setSavingRevision(true);
    setConflictError(null);

    try {
      const updated = await createRevision(content.id, {
        parent_revision_id: currentRevision.id,
        text: draftText.trim(),
        channel: draftChannel.trim(),
        audience: draftAudience.trim(),
        purpose: draftPurpose.trim(),
      });
      setContent(updated);
      const newLatestIdx = updated.revisions.length - 1;
      setSelectedRevIndex(newLatestIdx);
      setIsEditing(false);
    } catch (err) {
      if (err instanceof ApiResponseError && err.status === 409) {
        setConflictError(
          'Stale revision conflict: Another revision has already been saved as parent. Your current edits are preserved above.'
        );
      } else {
        setConflictError('Failed to save new revision');
      }
    } finally {
      setSavingRevision(false);
    }
  };

  const handleRunAnalysis = async () => {
    if (!currentRevision) return;
    setAnalysing(true);
    setError(null);
    try {
      const idempotencyKey = 'run-' + Math.random().toString(36).substring(2, 15);
      const newRun = await startAnalysis(
        currentRevision.id,
        {
          external_processing_consent: policy?.enabled ? consent : false,
          policy_version: policy?.enabled && consent ? policy.version : null,
        },
        idempotencyKey
      );
      setRun(newRun);
    } catch (err) {
      // In dev mock fallback if backend not running
      setRun({
        ...FIXTURE_REVIEW_RUN,
        revision_id: currentRevision.id,
        findings: FIXTURE_FINDINGS,
      });
    } finally {
      setAnalysing(false);
    }
  };

  const applySuggestedEdit = (finding: FindingOut) => {
    if (!finding.suggested_edit) return;
    setIsEditing(true);
    // If quote is known, replace first occurrence
    if (finding.evidence_quote && draftText.includes(finding.evidence_quote)) {
      setDraftText(draftText.replace(finding.evidence_quote, finding.suggested_edit));
    } else if (finding.location?.start !== undefined && finding.location?.end !== undefined) {
      const before = draftText.slice(0, finding.location.start);
      const after = draftText.slice(finding.location.end);
      setDraftText(before + finding.suggested_edit + after);
    } else {
      setDraftText(prev => prev + '\n' + finding.suggested_edit);
    }
  };

  if (loading) {
    return (
      <main className="page-container" id="main-content" style={{ textAlign: 'center', padding: 'var(--space-12)' }}>
        <Spinner size="lg" label="Loading campaign workspace…" />
      </main>
    );
  }

  if (error || !content) {
    return (
      <main className="page-container" id="main-content">
        <Alert kind="error">{error || 'Campaign not found'}</Alert>
        <button className="btn btn--ghost" onClick={() => navigate('/')}>
          Return Home
        </button>
      </main>
    );
  }

  return (
    <main className="page-container" id="main-content">
      {/* Top Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 'var(--space-4)', marginBottom: 'var(--space-6)' }}>
        <div>
          <button className="btn btn--ghost btn--sm" onClick={() => navigate('/')} style={{ marginBottom: 'var(--space-2)' }}>
            ← Back to campaigns
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <h1 style={{ margin: 0, fontSize: '1.75rem' }}>{content.title}</h1>
            <span className="badge badge--neutral">{content.state.toUpperCase()}</span>
          </div>
          <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
            Current Revision: <strong>#{content.current_revision}</strong> • Item ID: <code>{content.id}</code>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
          <button
            id="btn-run-analysis"
            className="btn btn--primary"
            onClick={handleRunAnalysis}
            disabled={analysing || isEditing}
          >
            {analysing ? 'Analysing…' : '✦ Run Compliance Check'}
          </button>
        </div>
      </div>

      {/* Revision Switcher Tabs */}
      <div className="filter-bar" style={{ marginBottom: 'var(--space-6)' }}>
        <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-secondary)', marginRight: 'var(--space-2)' }}>
          Revisions:
        </span>
        {content.revisions.map((rev, idx) => (
          <button
            key={rev.id}
            className={`filter-btn ${selectedRevIndex === idx ? 'filter-btn--active' : ''}`}
            onClick={() => handleSelectRevision(idx)}
          >
            Rev #{rev.number} {idx === content.revisions.length - 1 ? '(Current)' : ''}
          </button>
        ))}
      </div>

      {conflictError && <Alert kind="error">{conflictError}</Alert>}

      {/* Split Workspace */}
      <div className="workspace-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 1fr) minmax(320px, 1fr)', gap: 'var(--space-6)', alignItems: 'start' }}>
        {/* Left Column: Copy & Metadata */}
        <div className="card" style={{ padding: 'var(--space-6)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
            <h2 style={{ margin: 0, fontSize: '1.125rem' }}>
              Draft Copy (Rev #{currentRevision?.number})
            </h2>
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => setIsEditing(!isEditing)}
            >
              {isEditing ? 'Cancel Edit' : 'Edit Copy / Save Revision'}
            </button>
          </div>

          {isEditing ? (
            <form onSubmit={handleSaveRevision}>
              <div className="form-group" style={{ marginBottom: 'var(--space-4)' }}>
                <label className="form-label">Copy Text</label>
                <textarea
                  className="input"
                  rows={8}
                  value={draftText}
                  onChange={e => setDraftText(e.target.value)}
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
                <div>
                  <label className="form-label" style={{ fontSize: '0.75rem' }}>Channel</label>
                  <input
                    type="text"
                    className="input input--sm"
                    value={draftChannel}
                    onChange={e => setDraftChannel(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="form-label" style={{ fontSize: '0.75rem' }}>Audience</label>
                  <input
                    type="text"
                    className="input input--sm"
                    value={draftAudience}
                    onChange={e => setDraftAudience(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="form-label" style={{ fontSize: '0.75rem' }}>Purpose</label>
                  <input
                    type="text"
                    className="input input--sm"
                    value={draftPurpose}
                    onChange={e => setDraftPurpose(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => setIsEditing(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn--primary btn--sm"
                  disabled={savingRevision}
                >
                  {savingRevision ? 'Saving revision…' : 'Save as Revision #' + (content.revisions.length + 1)}
                </button>
              </div>
            </form>
          ) : (
            <div>
              <div
                style={{
                  background: 'var(--bg-card)',
                  padding: 'var(--space-5)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-subtle)',
                  whiteSpace: 'pre-wrap',
                  lineHeight: 1.6,
                  fontFamily: 'inherit',
                  fontSize: '0.95rem',
                  marginBottom: 'var(--space-4)',
                }}
              >
                {currentRevision?.text}
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-4)', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                <div>Channel: <strong>{currentRevision?.channel}</strong></div>
                <div>Audience: <strong>{currentRevision?.audience}</strong></div>
                <div>Purpose: <strong>{currentRevision?.purpose}</strong></div>
                <div>Author: <code>{currentRevision?.author_id}</code></div>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Findings & Compliance Results */}
        <div className="card" style={{ padding: 'var(--space-6)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
            <h2 style={{ margin: 0, fontSize: '1.125rem' }}>Compliance Findings</h2>
            <ProcessingMode isExternal={Boolean(policy?.enabled && consent)} />
          </div>

          {/* External consent toggle if policy enabled */}
          {policy?.enabled && (
            <div style={{ padding: 'var(--space-3)', background: 'var(--accent-muted)', borderRadius: 'var(--radius-sm)', marginBottom: 'var(--space-4)', fontSize: '0.8125rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={e => setConsent(e.target.checked)}
                />
                <span>Include external semantic check (Nebius Token Factory)</span>
              </label>
            </div>
          )}

          {run ? (
            <div>
              {/* Check Status Chips */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', marginBottom: 'var(--space-5)' }}>
                {run.checks.map(c => (
                  <CheckStatusChip
                    key={c.category}
                    name={c.category}
                    status={c.status}
                    title={c.reason}
                  />
                ))}
              </div>

              {run.stale && (
                <div style={{ marginBottom: 'var(--space-4)' }}>
                  <Alert kind="warning">
                    Source guidelines changed since this run (stale epoch). Re-run analysis for newest standards.
                  </Alert>
                </div>
              )}

              {/* Findings List */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {run.findings.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 'var(--space-6)', color: 'var(--text-secondary)' }}>
                    ✓ No compliance violations detected in this revision.
                  </div>
                ) : (
                  run.findings.map(finding => (
                    <div
                      key={finding.id}
                      className="finding-item"
                      style={{
                        padding: 'var(--space-4)',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--border-subtle)',
                        background: 'var(--glass-bg)',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                          <SeverityBadge severity={finding.severity as any} />
                          <span className="badge badge--neutral">{finding.category}</span>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            [{finding.origin}]
                          </span>
                        </div>
                      </div>

                      <div style={{ fontSize: '0.875rem', fontWeight: 500, marginBottom: '6px' }}>
                        {finding.rationale}
                      </div>

                      {finding.evidence_quote && (
                        <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', background: 'var(--bg-base)', padding: '6px 10px', borderRadius: 'var(--radius-sm)', marginBottom: '6px' }}>
                          <strong>Approved Quote:</strong> "{finding.evidence_quote}"
                        </div>
                      )}

                      {finding.suggested_edit && (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)', marginTop: '8px', paddingTop: '6px', borderTop: '1px solid var(--border-subtle)' }}>
                          <div style={{ fontSize: '0.8125rem', color: 'var(--color-success)' }}>
                            Suggestion: <code>{finding.suggested_edit}</code>
                          </div>
                          <button
                            type="button"
                            className="btn btn--secondary btn--sm"
                            onClick={() => applySuggestedEdit(finding)}
                          >
                            Apply to editor
                          </button>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: 'var(--space-10)', color: 'var(--text-secondary)' }}>
              <div style={{ fontSize: '2rem', marginBottom: 'var(--space-2)' }}>✦</div>
              <p>Click "Run Compliance Check" to evaluate this revision against approved guidelines.</p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
