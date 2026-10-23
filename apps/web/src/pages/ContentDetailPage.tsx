import { categoryLabel } from '../components/categoryLabel';
import React from 'react';
import { replaceLocatedText } from '../api/textEdits';
import { useParams, useNavigate } from 'react-router-dom';
import {
  getContent,
  getReviewRecord,
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
import { ManualChecks } from '../components/ManualChecks';
import { ResolutionModal } from '../components/ResolutionModal';
import { useAuth } from '../context/AuthContext';

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
      if (item.latest_run_id) {
        const latestRun = await getRun(item.latest_run_id);
        if (!['queued', 'running'].includes(latestRun.status)) {
          const record = await getReviewRecord(latestRun.revision_id);
          latestRun.checks = record.evidence.effective_checks;
        }
        setRun(latestRun);
      } else setRun(null);

      // Fetch sources for evidence drawer
      if (item.brand_id) {
        getSources(item.brand_id)
          .then(setSources)
          .catch(() => { setSources([]); setError('Source evidence could not be loaded. Retry before reviewing.'); });
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

  const cancelEditing = () => {
    if (currentRevision) {
      setDraftText(currentRevision.text);
      setDraftChannel(currentRevision.channel);
      setDraftAudience(currentRevision.audience);
      setDraftPurpose(currentRevision.purpose);
    }
    setIsEditing(false);
  };

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
        text: draftText,
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
      setError(err instanceof ApiResponseError ? err.body.message : 'Analysis request failed. Your draft is saved; retry when the service is available.');
    } finally {
      setAnalysing(false);
    }
  };

  const pollingRunId = run?.id;
  const pollingRunStatus = run?.status;
  React.useEffect(() => {
    if (!pollingRunId || !pollingRunStatus || !['queued', 'running'].includes(pollingRunStatus)) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    setAnalysing(true);
    const poll = async () => {
      try {
        const updated = await getRun(pollingRunId);
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
  }, [pollingRunId, pollingRunStatus, contentId]);

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
    try {
      if (!currentRevision) return;
      setDraftText(replaceLocatedText(draftText, currentRevision.text, finding.location?.start, finding.location?.end, replacementText));
      setIsEditing(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid suggestion location.');
    }
    setEditingSuggestionFinding(null);
  };

  // Document preview rendering with interactive highlight marks
  const renderAnnotatedDocument = () => {
    if (!currentRevision) return null;
    const points = Array.from(draftText);
    const segments: React.ReactNode[] = [];
    let cursor = 0;
    const located = draftText === currentRevision.text ? [...(run?.findings || [])].sort((a, b) => Number(a.location.start) - Number(b.location.start)) : [];
    for (const finding of located) {
      const { start, end } = finding.location;
      if (typeof start !== 'number' || typeof end !== 'number' || start < cursor || end <= start || end > points.length) continue;
      segments.push(points.slice(cursor, start).join(''));
      segments.push(<button type="button" key={finding.id} className={`located-finding located-finding--${finding.severity}`} onClick={() => setActiveFinding(finding)} aria-label={`${categoryLabel(finding.category)}: ${points.slice(start, end).join('')}`}>
        {points.slice(start, end).join('')}
      </button>);
      cursor = end;
    }
    segments.push(points.slice(cursor).join(''));
    return <div className="document-preview-text" id="document-preview-container">{segments}</div>;
  };

  if (loading) {
    return (
      <main className="page-container" id="main-content" style={{ textAlign: 'center', padding: 'var(--space-12)' }}>
        <Spinner size="lg" label="Loading campaign workspace…" />
      </main>
    );
  }

  if (!content) {
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
    <main className="page-container review-workspace" id="main-content">
      {error && <Alert kind="error">{error}</Alert>}
      {/* Top Header */}
      <div className="workspace-header">
        <div>
          <button className="btn btn--ghost btn--sm" onClick={() => navigate('/')} style={{ marginBottom: 'var(--space-2)' }}>
            ← Back to campaigns
          </button>
          <div className="workspace-title">
            <h1 style={{ margin: 0, fontSize: '1.75rem' }}>{content.title}</h1>
            <span className="badge badge--neutral">{content.state.toUpperCase()}</span>
          </div>
          <div className="workspace-subtitle">
            Campaign studio <span aria-hidden="true">/</span> Revision <strong>#{content.current_revision}</strong>
          </div>
        </div>

        <div className="workspace-actions">
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
            disabled={analysing || isEditing || user?.membership_id !== content.creator_id || content.state === 'approved'}
          >
            {analysing ? 'Analysing…' : 'Run Compliance Check'}
          </button>

          {/* Workflow Action 1: Creator Submit for Review */}
          {user?.membership_id === content.creator_id && ['draft', 'changes_requested', 'ready_for_review', 'needs_changes', 'incomplete'].includes(content.state) && (
            <button
              id="btn-submit-review"
              className="btn btn--primary"
              onClick={() => setShowSubmitModal(true)}
              disabled={analysing || isEditing || user?.membership_id !== content.creator_id || content.state === 'approved'}
            >
              Submit for Review →
            </button>
          )}

          {/* Workflow Action 2: Reviewer Decisions */}
          {content.state === 'in_review' && user?.membership_id === content.reviewer_id && (
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
                style={{ background: 'var(--color-success)', borderColor: 'var(--color-success)', color: 'var(--bg-base)' }}
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
              style={{ background: 'var(--color-success)', borderColor: 'var(--color-success)', color: 'var(--bg-base)' }}
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
            aria-pressed={selectedRevIndex === idx}
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
      <div className="workspace-grid">
        {/* Left Column: Interactive Copy Editor / Annotated Preview */}
        <div className="document-panel">
          <div className="panel-heading">
            <h2 style={{ margin: 0, fontSize: '1.125rem' }}>
              Draft Copy (Rev #{currentRevision?.number})
            </h2>
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => {
                if (isEditing) cancelEditing();
                else setIsEditing(true);
              }}
              disabled={user?.membership_id !== content.creator_id}
            >
              {isEditing ? 'Cancel Edit' : 'Edit Copy / Save Revision'}
            </button>
          </div>

          {isEditing ? (
            <form className="document-editor" onSubmit={e => handleSaveRevision(e)}>
              <div className="form-group" style={{ marginBottom: 'var(--space-4)' }}>
                <label htmlFor="edit-copy" className="form-label">Copy Text</label>
                <textarea
                  id="edit-copy"
                  className="input"
                  rows={8}
                  value={draftText}
                  onChange={e => setDraftText(e.target.value)}
                  required
                />
              </div>

              <div className="document-editor__metadata">
                <div>
                  <label htmlFor="edit-channel" className="form-label" style={{ fontSize: '0.75rem' }}>Channel</label>
                  <input
                    id="edit-channel"
                    type="text"
                    className="input input--sm"
                    value={draftChannel}
                    onChange={e => setDraftChannel(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label htmlFor="edit-audience" className="form-label" style={{ fontSize: '0.75rem' }}>Audience</label>
                  <input
                    id="edit-audience"
                    type="text"
                    className="input input--sm"
                    value={draftAudience}
                    onChange={e => setDraftAudience(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label htmlFor="edit-purpose" className="form-label" style={{ fontSize: '0.75rem' }}>Purpose</label>
                  <input
                    id="edit-purpose"
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
                  onClick={cancelEditing}
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
            <div className="document-canvas">
              <div className="document-canvas__masthead"><span>CAMPAIGN COPY</span><span>NO. {String(currentRevision?.number || 1).padStart(2, '0')}</span></div>
              <p className="document-canvas__hint">{run?.findings.some(f => typeof f.location.start === 'number' && typeof f.location.end === 'number') ? 'Select an underlined phrase to follow the evidence.' : 'Your words. Ready for a closer look.'}</p>
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
        <section className="findings-panel" aria-labelledby="findings-heading">
          <div className="panel-heading">
            <div><p className="eyebrow">A CLOSER LOOK</p><h2 id="findings-heading" style={{ margin: 0, fontSize: '1.125rem' }}>Compliance Findings {run && <span className="finding-count">{run.findings.length}</span>}</h2></div>
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
              <div className="check-coverage">
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
                    Source guidelines changed since this run. Re-run analysis for the latest standards.
                  </Alert>
                </div>
              )}

              {user?.membership_id === content.reviewer_id && content.state !== 'approved' && <ManualChecks run={run} version={content.workflow_version} onSaved={loadContent} />}
              {/* Findings List */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {run.findings.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 'var(--space-6)', color: 'var(--text-secondary)' }}>
                    {['queued', 'running'].includes(run.status) ? 'Analysis is pending.' : 'No compliance violations detected. Check category coverage before approval.'}
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
                        <div className="finding-card__header">
                          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                            <SeverityBadge severity={finding.severity} />
                            <span className="badge badge--neutral">{categoryLabel(finding.category)}</span>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              [{finding.origin}]
                            </span>
                          </div>
                          <div className="finding-card__actions">
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
                          <div className="finding-suggestion">
                            <div style={{ fontSize: '0.8125rem', color: 'var(--color-success)' }}>
                              Suggestion: <code>{finding.suggested_edit}</code>
                            </div>
                            <div className="finding-card__actions">
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
              <div className="review-empty-mark" aria-hidden="true">[ / ]</div>
              <p>Click "Run Compliance Check" to evaluate this revision against approved guidelines.</p>
            </div>
          )}
        </section>
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
