import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  getContent,
  getRun,
  createRevision,
  startAnalysis,
  getProcessingPolicy,
  getSources,
  ApiResponseError,
} from '../api/client';
import type {
  ContentOut,
  RevisionOut,
  RunOut,
  PolicyOut,
  FindingOut,
  SourceOut,
} from '../api/types';
import {
  Alert,
  Spinner,
  SeverityBadge,
  CheckStatusChip,
  ProcessingMode,
} from '../components/Primitives';
import { EvidenceDrawer } from '../components/EvidenceDrawer';
import { DiffViewer } from '../components/DiffViewer';
import { ConflictResolutionModal } from '../components/ConflictResolutionModal';
import { CommentsSection } from '../components/CommentsSection';
import { EditSuggestionModal } from '../components/EditSuggestionModal';
import { SubmitReviewModal } from '../components/SubmitReviewModal';
import { DecisionModal } from '../components/DecisionModal';
import { ExportModal } from '../components/ExportModal';
import { ResolutionModal } from '../components/ResolutionModal';
import { useAuth } from '../context/AuthContext';
import { FIXTURE_FINDINGS, FIXTURE_REVIEW_RUN, FIXTURE_SOURCES } from '../api/fixtures';

export function ContentDetailPage() {
  const { contentId } = useParams<{ contentId: string }>();
  const navigate = useNavigate();

  const [content, setContent] = React.useState<ContentOut | null>(null);
  const [sources, setSources] = React.useState<SourceOut[]>([]);
  const [selectedRevIndex, setSelectedRevIndex] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // Policy
  const [policy, setPolicy] = React.useState<PolicyOut | null>(null);
  const [consent, setConsent] = React.useState(false);

  // Active run state
  const [run, setRun] = React.useState<RunOut | null>(null);
  const [analysing, setAnalysing] = React.useState(false);

  // Selected finding for evidence drawer / highlighting
  const [activeFinding, setActiveFinding] = React.useState<FindingOut | null>(null);
  const [editingSuggestionFinding, setEditingSuggestionFinding] = React.useState<FindingOut | null>(null);

  // Diff comparison mode between revisions
  const [showDiff, setShowDiff] = React.useState(false);
  const [diffCompareIndex, setDiffCompareIndex] = React.useState(0);

  // Edit mode
  const [isEditing, setIsEditing] = React.useState(false);
  const [draftText, setDraftText] = React.useState('');
  const [draftChannel, setDraftChannel] = React.useState('');
  const [draftAudience, setDraftAudience] = React.useState('');
  const [draftPurpose, setDraftPurpose] = React.useState('');
  const [savingRevision, setSavingRevision] = React.useState(false);

  // 409 Conflict state
  const [conflictServerRevision, setConflictServerRevision] = React.useState<RevisionOut | null>(null);

  // Auth context for role-aware workflow actions
  const { user } = useAuth();

  // D4 Workflow & Decision Modals state
  const [showSubmitModal, setShowSubmitModal] = React.useState(false);
  const [showDecisionModal, setShowDecisionModal] = React.useState(false);
  const [decisionKind, setDecisionKind] = React.useState<'approved' | 'changes_requested'>('approved');
  const [showExportModal, setShowExportModal] = React.useState(false);
  const [resolvingFinding, setResolvingFinding] = React.useState<FindingOut | null>(null);

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
      setRun(item.latest_run_id ? await getRun(item.latest_run_id) : null);

      // Fetch sources for evidence drawer
      if (item.brand_id) {
        getSources(item.brand_id)
          .then(setSources)
          .catch(() => setSources(FIXTURE_SOURCES));
      }
      if (item.revisions && item.revisions.length > 0) {
        const latestIdx = item.revisions.length - 1;
        setSelectedRevIndex(latestIdx);
        const rev = item.revisions[latestIdx];
        setDraftText(rev.text);
        setDraftChannel(rev.channel);
        setDraftAudience(rev.audience);
        setDraftPurpose(rev.purpose);
        if (latestIdx > 0) {
          setDiffCompareIndex(latestIdx - 1);
        }
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
    setRun(null);
    const rev = content.revisions[index];
    if (rev) {
      setDraftText(rev.text);
      setDraftChannel(rev.channel);
      setDraftAudience(rev.audience);
      setDraftPurpose(rev.purpose);
      setIsEditing(false);
      setConflictServerRevision(null);
      if (index > 0) setDiffCompareIndex(index - 1);
    }
  };

  const handleSaveRevision = async (e?: React.FormEvent, customParentId?: string) => {
    if (e) e.preventDefault();
    if (!content || !currentRevision) return;

    setSavingRevision(true);
    setConflictServerRevision(null);

    const parentId = customParentId || currentRevision.id;

    try {
      const updated = await createRevision(content.id, {
        parent_revision_id: parentId,
        text: draftText.trim(),
        channel: draftChannel.trim(),
        audience: draftAudience.trim(),
        purpose: draftPurpose.trim(),
      });
      setContent(updated);
      const newLatestIdx = updated.revisions.length - 1;
      setSelectedRevIndex(newLatestIdx);
      setRun(null);
      setIsEditing(false);
      setConflictServerRevision(null);
    } catch (err) {
      if (err instanceof ApiResponseError && err.status === 409) {
        // Fetch fresh server state to display conflict diff
        try {
          const fresh = await getContent(content.id);
          setContent(fresh);
          const latestServerRev = fresh.revisions[fresh.revisions.length - 1];
          setConflictServerRevision(latestServerRev);
        } catch {
          setConflictServerRevision(currentRevision);
        }
      } else {
        setError('Failed to save new revision');
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
      if (import.meta.env.VITE_USE_MOCK_API === 'true') {
        setRun({
          ...FIXTURE_REVIEW_RUN,
          revision_id: currentRevision.id,
          findings: FIXTURE_FINDINGS,
        });
      } else {
        setError(err instanceof ApiResponseError ? err.body.message : 'Analysis request failed. Your draft is saved; retry when the service is available.');
      }
    } finally {
      setAnalysing(false);
    }
  };

  React.useEffect(() => {
    if (!run || !['queued', 'running'].includes(run.status)) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    setAnalysing(true);
    const poll = async () => {
      try {
        const updated = await getRun(run.id);
        if (cancelled) return;
        setRun(updated);
        if (['queued', 'running'].includes(updated.status)) {
          if (++attempts < 40) timer = setTimeout(poll, 1500);
          else {
            setAnalysing(false);
            setError('Analysis is still pending. The worker may be unavailable; reload to check its status.');
          }
        } else {
          setAnalysing(false);
          if (contentId) { const updatedContent = await getContent(contentId); if (!cancelled) setContent(updatedContent); }
        }
      } catch (err) {
        if (!cancelled) {
          setAnalysing(false);
          setError(err instanceof ApiResponseError ? err.body.message : 'Could not retrieve analysis results. No successful review is assumed.');
        }
      }
    };
    timer = setTimeout(poll, 500);
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [run?.id, run?.status, contentId]);

  const applySuggestedEdit = (finding: FindingOut) => {
    if (!finding.suggested_edit || !currentRevision) return;
    const start = finding.location?.start;
    const end = finding.location?.end;
    const points = Array.from(draftText);
    if (draftText !== currentRevision.text || typeof start !== 'number' || typeof end !== 'number' ||
        start < 0 || end <= start || end > points.length) {
      setError('Reload the analysed revision before applying this suggestion. Your edits are preserved.');
      return;
    }
    setIsEditing(true);
    setDraftText(points.slice(0, start).join('') + finding.suggested_edit + points.slice(end).join(''));
  };

  const handleApplySuggestion = (replacementText: string) => {
    if (!editingSuggestionFinding) return;
    const finding = editingSuggestionFinding;
    setIsEditing(true);

    // Apply replacement to draft text
    if (finding.evidence_quote && draftText.includes(finding.evidence_quote)) {
      setDraftText(draftText.replace(finding.evidence_quote, replacementText));
    } else if (finding.location?.start !== undefined && finding.location?.end !== undefined) {
      const before = draftText.slice(0, finding.location.start);
      const after = draftText.slice(finding.location.end);
      setDraftText(before + replacementText + after);
    } else {
      setDraftText(prev => prev + '\n' + replacementText);
    }
    setEditingSuggestionFinding(null);
  };

  // Document preview rendering with interactive highlight marks
  const renderAnnotatedDocument = () => {
    if (!currentRevision) return null;
    const textToRender = draftText;
    const findingsList = run?.findings || [];

    if (findingsList.length === 0) {
      return (
        <div className="document-preview-text">
          {textToRender}
        </div>
      );
    }

    // Build segments based on findings with quote or offsets
    return (
      <div className="document-preview-text" id="document-preview-container">
        {textToRender}
        {findingsList.map(f => {
          const isSelected = activeFinding?.id === f.id;
          return (
            <div
              key={f.id}
              className={`annotation-marker annotation-marker--${f.severity} ${isSelected ? 'annotation-marker--selected' : ''}`}
              onClick={() => setActiveFinding(f)}
              title={`${f.severity.toUpperCase()}: ${f.rationale}`}
            >
              <span className="annotation-marker__badge">{f.category}</span>
              <span className="annotation-marker__quote">"{f.evidence_quote || f.rationale}"</span>
            </div>
          );
        })}
      </div>
    );
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

        <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
          {content.revisions.length > 1 && (
            <button
              className={`btn ${showDiff ? 'btn--secondary' : 'btn--ghost'}`}
              onClick={() => setShowDiff(!showDiff)}
            >
              {showDiff ? 'Close Diff View' : '⇄ Compare Revisions'}
            </button>
          )}

          <button
            id="btn-run-analysis"
            className="btn btn--secondary"
            onClick={handleRunAnalysis}
            disabled={analysing || isEditing}
          >
            {analysing ? 'Analysing…' : '✦ Run Compliance Check'}
          </button>

          {/* Workflow Action 1: Creator Submit for Review */}
          {(content.state === 'draft' || content.state === 'changes_requested') && (
            <button
              id="btn-submit-review"
              className="btn btn--primary"
              onClick={() => setShowSubmitModal(true)}
              disabled={analysing || isEditing}
            >
              Submit for Review →
            </button>
          )}

          {/* Workflow Action 2: Reviewer Decisions */}
          {(content.state === 'in_review' || user?.role === 'reviewer' || user?.role === 'manager') && content.state !== 'approved' && (
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <button
                id="btn-request-changes"
                className="btn btn--secondary"
                style={{ color: 'var(--color-warning)' }}
                onClick={() => {
                  setDecisionKind('changes_requested');
                  setShowDecisionModal(true);
                }}
              >
                ⟲ Request Changes
              </button>
              <button
                id="btn-approve-revision"
                className="btn btn--primary"
                style={{ background: 'var(--color-success)', borderColor: 'var(--color-success)' }}
                onClick={() => {
                  setDecisionKind('approved');
                  setShowDecisionModal(true);
                }}
              >
                ✓ Approve Exact Revision
              </button>
            </div>
          )}

          {/* Workflow Action 3: Export Certificate (Approved Revisions) */}
          {content.state === 'approved' && (
            <button
              id="btn-export-certificate"
              className="btn btn--primary"
              style={{ background: 'var(--color-success)', borderColor: 'var(--color-success)' }}
              onClick={() => setShowExportModal(true)}
            >
              ⬇ View Approved Export
            </button>
          )}
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

      {/* Revision Diff Viewer if toggled */}
      {showDiff && currentRevision && content.revisions.length > 1 && (
        <div style={{ marginBottom: 'var(--space-6)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
            <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>Compare Rev #{currentRevision.number} against:</span>
            <select
              className="input input--sm"
              style={{ width: 'auto' }}
              value={diffCompareIndex}
              onChange={e => setDiffCompareIndex(Number(e.target.value))}
            >
              {content.revisions.map((r, i) => (
                <option key={r.id} value={i} disabled={i === selectedRevIndex}>
                  Rev #{r.number} ({new Date(r.created_at).toLocaleTimeString()})
                </option>
              ))}
            </select>
          </div>

          <DiffViewer
            originalText={content.revisions[diffCompareIndex]?.text || ''}
            modifiedText={currentRevision.text}
            originalLabel={`Revision #${content.revisions[diffCompareIndex]?.number}`}
            modifiedLabel={`Revision #${currentRevision.number} (Current View)`}
          />
        </div>
      )}

      {/* Split Workspace */}
      <div className="workspace-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(340px, 1.1fr) minmax(340px, 0.9fr)', gap: 'var(--space-6)', alignItems: 'start' }}>
        {/* Left Column: Interactive Copy Editor / Annotated Preview */}
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
            <form onSubmit={e => handleSaveRevision(e)}>
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
              {renderAnnotatedDocument()}

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-4)', fontSize: '0.8125rem', color: 'var(--text-secondary)', marginTop: 'var(--space-4)' }}>
                <div>Channel: <strong>{currentRevision?.channel}</strong></div>
                <div>Audience: <strong>{currentRevision?.audience}</strong></div>
                <div>Purpose: <strong>{currentRevision?.purpose}</strong></div>
                <div>Author: <code>{currentRevision?.author_id}</code></div>
              </div>
            </div>
          )}

          {/* Collaborative Discussion / Notes on this Revision */}
          {currentRevision && (
            <CommentsSection
              revisionId={currentRevision.id}
              activeFindingId={activeFinding?.id}
            />
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
                  run.findings.map(finding => {
                    const isSelected = activeFinding?.id === finding.id;
                    return (
                      <div
                        key={finding.id}
                        className={`card finding-card ${isSelected ? 'finding-card--selected' : ''}`}
                        style={{
                          padding: 'var(--space-4)',
                          background: 'var(--glass-bg)',
                          cursor: 'pointer',
                        }}
                        onClick={() => setActiveFinding(finding)}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                            <SeverityBadge severity={finding.severity as any} />
                            <span className="badge badge--neutral">{finding.category}</span>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              [{finding.origin}]
                            </span>
                          </div>
                          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                            <button
                              className="btn btn--secondary btn--sm"
                              onClick={e => {
                                e.stopPropagation();
                                setResolvingFinding(finding);
                              }}
                              title="Record human disposition (confirm, dismiss, exception)"
                            >
                              Resolve
                            </button>
                            <button
                              className="btn btn--ghost btn--sm"
                              onClick={e => {
                                e.stopPropagation();
                                setActiveFinding(finding);
                              }}
                            >
                              Evidence ↗
                            </button>
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
                            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                              <button
                                type="button"
                                className="btn btn--ghost btn--sm"
                                onClick={e => {
                                  e.stopPropagation();
                                  applySuggestedEdit(finding);
                                }}
                                title="Apply suggestion directly into draft copy"
                              >
                                Quick Apply
                              </button>
                              <button
                                type="button"
                                className="btn btn--secondary btn--sm"
                                onClick={e => {
                                  e.stopPropagation();
                                  setEditingSuggestionFinding(finding);
                                }}
                              >
                                Inspect & Apply
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
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

      {/* Evidence Drawer */}
      {activeFinding && (
        <EvidenceDrawer
          finding={activeFinding}
          sources={sources}
          onClose={() => setActiveFinding(null)}
          onJumpToText={() => {
            const el = document.getElementById('document-preview-container');
            if (el) el.scrollIntoView({ behavior: 'smooth' });
          }}
        />
      )}

      {/* Suggestion Fine-Tuning Modal */}
      {editingSuggestionFinding && (
        <EditSuggestionModal
          finding={editingSuggestionFinding}
          onApply={handleApplySuggestion}
          onClose={() => setEditingSuggestionFinding(null)}
        />
      )}

      {/* Concurrency Conflict Resolution Modal (409) */}
      {conflictServerRevision && (
        <ConflictResolutionModal
          serverRevision={conflictServerRevision}
          localDraftText={draftText}
          onOverwrite={() => handleSaveRevision(undefined, conflictServerRevision.id)}
          onDiscard={() => {
            setDraftText(conflictServerRevision.text);
            setDraftChannel(conflictServerRevision.channel);
            setDraftAudience(conflictServerRevision.audience);
            setDraftPurpose(conflictServerRevision.purpose);
            setConflictServerRevision(null);
            setIsEditing(false);
          }}
          onClose={() => setConflictServerRevision(null)}
        />
      )}

      {/* D4: Submit for Review Modal */}
      {showSubmitModal && currentRevision && (
        <SubmitReviewModal
          revisionId={currentRevision.id}
          expectedItemVersion={content.workflow_version}
          expectedRunId={run?.id || 'run-default'}
          expectedSourceEpoch={run?.source_epoch ?? 0}
          currentReviewerId={content.reviewer_id}
          onSuccess={() => {
            setShowSubmitModal(false);
            loadContent();
          }}
          onClose={() => setShowSubmitModal(false)}
        />
      )}

      {/* D4: Reviewer Decision Modal (Approve / Request Changes) */}
      {showDecisionModal && currentRevision && (
        <DecisionModal
          revisionId={currentRevision.id}
          expectedItemVersion={content.workflow_version}
          expectedRunId={run?.id || 'run-default'}
          expectedSourceEpoch={run?.source_epoch ?? 0}
          kind={decisionKind}
          onSuccess={() => {
            setShowDecisionModal(false);
            loadContent();
          }}
          onClose={() => setShowDecisionModal(false)}
        />
      )}

      {/* D4: Export Certificate Modal */}
      {showExportModal && currentRevision && (
        <ExportModal
          revisionId={currentRevision.id}
          onClose={() => setShowExportModal(false)}
        />
      )}

      {/* D4: Finding Disposition Resolution Modal */}
      {resolvingFinding && (
        <ResolutionModal
          finding={resolvingFinding}
          expectedItemVersion={content.workflow_version}
          onSuccess={() => {
            setResolvingFinding(null);
            loadContent();
          }}
          onClose={() => setResolvingFinding(null)}
        />
      )}
    </main>
  );
}
