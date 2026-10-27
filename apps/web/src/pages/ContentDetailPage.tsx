import { categoryLabel } from '../components/categoryLabel';
import { DraftFieldCount } from '../components/DraftFieldCount';
import { draftFieldIssue, validateDraft } from '../api/draftValidation';
import { ExternalInputBudget } from '../components/ExternalInputBudget';
import { ALL_FINDINGS, filterFindings, type FindingFilters as FilterValues } from '../api/findingFilters';
import { FindingFilters } from '../components/FindingFilters';
import { AssignReviewerModal } from '../components/AssignReviewerModal';
import { resolutionActions } from '../api/resolutionActions';
import { RecheckBanner } from '../components/RecheckBanner';
import React from 'react';
import { workingDraft, changeDraftText, stageDraftEdit, projectDraftRange, undoDraftChange } from '../api/draftEdits';
import { incompleteCategories, submissionIssues } from '../api/reviewReadiness';
import { CoverageNotice } from '../components/CoverageNotice';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
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
import { useUnsavedChanges } from '../context/UnsavedChangesContext';
import { DiscussionDraftProvider, DiscussionDraftSummary, useDiscussionActivity } from '../context/DiscussionDraftContext';

export function ContentDetailPage() {
  const { contentId } = useParams<{ contentId: string }>();
  return <DiscussionDraftProvider key={contentId}><CampaignWorkspace /></DiscussionDraftProvider>;
}

function CampaignWorkspace() {
  const { contentId } = useParams<{ contentId: string }>();
  const { hasUnsentNotes, posting: postingNote } = useDiscussionActivity();
  const navigate = useNavigate();
  const location = useLocation();

  const [content, setContent] = React.useState<ContentOut | null>(null);
  const [sources, setSources] = React.useState<SourceOut[]>([]);
  const [selectedRevIndex, setSelectedRevIndex] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // Policy
  const [policy, setPolicy] = React.useState<PolicyOut | null>(null);
  const [consent, setConsent] = React.useState(true);

  // Active run state
  const [run, setRun] = React.useState<RunOut | null>(null);
  const [findingFilterState, setFindingFilterState] = React.useState<{ runId: string; values: FilterValues }>({ runId: '', values: ALL_FINDINGS });
  const [analysing, setAnalysing] = React.useState(false);

  // Selected finding for evidence drawer / highlighting
  const [activeFinding, setActiveFinding] = React.useState<FindingOut | null>(null);
  const [editingSuggestionFinding, setEditingSuggestionFinding] = React.useState<FindingOut | null>(null);

  // Diff comparison mode between revisions
  const [showDiff, setShowDiff] = React.useState(false);
  const [diffCompareIndex, setDiffCompareIndex] = React.useState(0);

  // Edit mode
  const [isEditing, setIsEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(() => workingDraft(''));
  const draftText = draft.text;
  const resetDraft = React.useCallback((text: string) => setDraft(workingDraft(text)), []);
  const [draftNotice, setDraftNotice] = React.useState<string | null>(() => location.state?.analysisStartFailed === true
    ? 'Your campaign is saved, but analysis could not start. Use Run Compliance Check to retry; you do not need to create the campaign again.' : null);
  const [submitAfterRun, setSubmitAfterRun] = React.useState<string | null>(null);
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
  const [showAssignment, setShowAssignment] = React.useState(false);

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
        resetDraft(rev.text);
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
  }, [contentId, resetDraft]);

  React.useEffect(() => {
    loadContent();
  }, [loadContent]);

  const currentRevision: RevisionOut | undefined =
    content?.revisions[selectedRevIndex];

  const cancelEditing = () => {
    if (currentRevision) {
      resetDraft(currentRevision.text);
      setDraftChannel(currentRevision.channel);
      setDraftAudience(currentRevision.audience);
      setDraftPurpose(currentRevision.purpose);
    }
    setIsEditing(false);
    setDraftNotice(null);
    setError(null);
  };

  // Initialize or update fields when switching revisions
  const handleSelectRevision = (index: number) => {
    if (!content || postingNote) return;
    setSelectedRevIndex(index);
    setActiveFinding(null);
    setDraftNotice(null);
    setRun(null);
    const rev = content.revisions[index];
    if (rev) {
      resetDraft(rev.text);
      setDraftChannel(rev.channel);
      setDraftAudience(rev.audience);
      setDraftPurpose(rev.purpose);
      setIsEditing(false);
      setConflictServerRevision(null);
      if (index > 0) setDiffCompareIndex(index - 1);
    }
  };

  const handleSaveRevision = async (e?: React.FormEvent, customParentId?: string, thenSubmit = false) => {
    if (e) e.preventDefault();
    if (!content || !currentRevision || savingRevision || postingNote || (!hasDraftChanges && !customParentId)) return;
    const inputIssues = validateDraft({ text: draftText, channel: draftChannel, audience: draftAudience, purpose: draftPurpose });
    if (inputIssues.length) {
      setError(inputIssues.join(' '));
      setIsEditing(true);
      return;
    }

    setSavingRevision(true);
    setError(null);
    setDraftNotice(null);
    if (!customParentId) setConflictServerRevision(null);

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
      const saved = updated.revisions[newLatestIdx];
      setSelectedRevIndex(newLatestIdx);
      resetDraft(saved.text);
      setDraftChannel(saved.channel);
      setDraftAudience(saved.audience);
      setDraftPurpose(saved.purpose);
      setRun(null);
      setActiveFinding(null);
      setIsEditing(false);
      setConflictServerRevision(null);
      setDraftNotice(`All changes saved together as revision #${saved.number}. Checking the updated draft…`);
      try {
        const nextRun = await startAnalysis(saved.id, {
          external_processing_consent: Boolean(policy?.enabled && consent),
          policy_version: policy?.enabled && consent ? policy.version : null,
        }, 'run-' + crypto.randomUUID());
        setRun(nextRun);
        if (thenSubmit) setSubmitAfterRun(nextRun.id);
      } catch {
        setError(`Your changes are saved as revision #${saved.number}, but the check could not start. Use Run Compliance Check to retry; you do not need to save again.`);
      }
    } catch (err) {
      if (err instanceof ApiResponseError && err.status === 409) {
        // Fetch fresh server state to display conflict diff
        try {
          const fresh = await getContent(content.id);
          setContent(fresh);
          // Keep the local draft, but let the editor continue against the latest
          // saved parent after the user inspects or closes the comparison.
          setSelectedRevIndex(fresh.revisions.length - 1);
          setRun(null);
          setActiveFinding(null);
          const latestServerRev = fresh.revisions[fresh.revisions.length - 1];
          setConflictServerRevision(latestServerRev);
        } catch {
          setError('A newer revision exists, but it could not be loaded. Your edits are preserved. Retry saving when the connection is available.');
        }
      } else {
        setError('Failed to save new revision');
      }
    } finally {
      setSavingRevision(false);
    }
  };

  const handleRunAnalysis = async (thenSubmit = false) => {
    if (!currentRevision || postingNote) return;
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
      setDraftNotice(null);
      if (thenSubmit) setSubmitAfterRun(newRun.id);
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
        if (['queued', 'running'].includes(updated.status)) {
          setRun(updated);
          if (++attempts < 40) timer = setTimeout(poll, 1500);
          else {
            setAnalysing(false);
            setError('Analysis is still pending. The worker may be unavailable; reload to check its status.');
          }
        } else {
          if (contentId) {
            const [updatedContent, record] = await Promise.all([getContent(contentId), getReviewRecord(updated.revision_id)]);
            if (!cancelled) {
              setContent(updatedContent);
              setRun({ ...updated, checks: record.evidence.effective_checks });
              setDraftNotice('Recheck finished. Review the updated findings before submitting.');
            }
          }
          setAnalysing(false);
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

  const hasDraftChanges = Boolean(currentRevision && (draftText !== currentRevision.text ||
    draftChannel !== currentRevision.channel || draftAudience !== currentRevision.audience || draftPurpose !== currentRevision.purpose));
  useUnsavedChanges(hasDraftChanges || hasUnsentNotes, savingRevision || postingNote,
    hasUnsentNotes ? (hasDraftChanges
      ? 'Your campaign edits and discussion notes have not been saved. Save the edits and post the notes, or discard them before leaving.'
      : 'Your discussion notes have not been posted. Keep editing to post them, or discard them before leaving.') : undefined,
    postingNote ? 'Posting your discussion note. Wait for the request to finish before leaving.' : undefined);
  const canEditDraft = Boolean(user?.membership_id === content?.creator_id &&
    currentRevision?.number === content?.current_revision && !savingRevision && !postingNote && !analysing && !['queued', 'running'].includes(run?.status || ''));
  const stagedCount = draft.changes.filter(change => change.findingId).length;
  const findingFilterValues = findingFilterState.runId === run?.id ? findingFilterState.values : ALL_FINDINGS;
  const visibleFindings = filterFindings(run?.findings || [], findingFilterValues);
  const findingFiltersActive = Object.values(findingFilterValues).some(value => value !== 'all');
  const availableFixCount = visibleFindings.filter(finding => finding.suggested_edit &&
    !draft.changes.some(change => change.findingId === finding.id) &&
    projectDraftRange(draft, finding.location.start, finding.location.end) !== null).length;
  const issues = currentRevision ? submissionIssues(run, currentRevision.id) : [];

  React.useEffect(() => {
    if (submitAfterRun && run?.id === submitAfterRun && !['queued', 'running'].includes(run.status) && !analysing) {
      setSubmitAfterRun(null);
      setShowSubmitModal(true);
    }
  }, [submitAfterRun, run, analysing]);

  const applySuggestedEdit = (finding: FindingOut, replacement = finding.suggested_edit) => {
    if (replacement === null || !currentRevision || !canEditDraft || run?.revision_id !== currentRevision.id) return;
    try {
      setDraft(stageDraftEdit(draft, finding.id, finding.location.start, finding.location.end, replacement, finding.location.quote));
      setDraftNotice('Fix added to your working draft. Keep going, then save all changes together.');
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add this fix.');
    }
  };

  const applyAvailableFixes = () => {
    if (!run || !canEditDraft) return;
    let next = draft, applied = 0, skipped = 0;
    for (const finding of visibleFindings) {
      if (!finding.suggested_edit || next.changes.some(change => change.findingId === finding.id)) continue;
      try {
        const updated = stageDraftEdit(next, finding.id, finding.location.start, finding.location.end, finding.suggested_edit, finding.location.quote);
        if (updated !== next) applied++;
        next = updated;
      } catch { skipped++; }
    }
    setDraft(next);
    setError(null);
    setDraftNotice(`${applied} fixes added to your draft.${skipped ? ` ${skipped} overlapping or unavailable suggestions need manual review.` : ''} Nothing is saved until you save all changes.`);
  };

  const handleApplySuggestion = (replacementText: string) => {
    if (editingSuggestionFinding) applySuggestedEdit(editingSuggestionFinding, replacementText);
    setEditingSuggestionFinding(null);
  };

  const prepareSubmission = () => {
    if (postingNote) return;
    if (hasDraftChanges) void handleSaveRevision(undefined, undefined, true);
    else if (!run) void handleRunAnalysis(true);
    else setShowSubmitModal(true);
  };

  // Document preview rendering with interactive highlight marks
  const renderAnnotatedDocument = () => {
    if (!currentRevision) return null;
    const points = Array.from(draftText);
    const segments: React.ReactNode[] = [];
    let cursor = 0;
    const located = [...(run?.findings || [])].sort((a, b) => Number(a.location.start) - Number(b.location.start));
    for (const finding of located) {
      const range = projectDraftRange(draft, finding.location.start, finding.location.end);
      if (!range) continue;
      const { start, end } = range;
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
    <main className={`page-container review-workspace${hasDraftChanges ? ' review-workspace--dirty' : ''}`} id="main-content">
      {error && <Alert kind="error">{error}</Alert>}
      {/* Top Header */}
      <div className="workspace-header">
        <div>
          <button className="btn btn--ghost btn--sm" disabled={hasDraftChanges || savingRevision} title={hasDraftChanges ? 'Save or discard your working draft before leaving.' : undefined} onClick={() => navigate('/')} style={{ marginBottom: 'var(--space-2)' }}>
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
            onClick={() => { void handleRunAnalysis(); }}
            disabled={analysing || savingRevision || postingNote || hasDraftChanges || user?.membership_id !== content.creator_id || content.state === 'approved'}
          >
            {analysing ? 'Analysing…' : 'Run Compliance Check'}
          </button>

          {/* Workflow Action 1: Creator Submit for Review */}
          {user?.role === 'manager' && content.state !== 'approved' && <button type="button" className="btn btn--secondary" disabled={postingNote} onClick={() => setShowAssignment(true)}>{content.reviewer_id ? 'Change reviewer' : 'Assign reviewer'}</button>}
          {user?.membership_id === content.creator_id && ['draft', 'changes_requested', 'ready_for_review', 'needs_changes', 'incomplete', 'analysing'].includes(content.state) && (
            <button
              id="btn-submit-review"
              className="btn btn--primary"
              onClick={prepareSubmission}
              disabled={analysing || savingRevision || postingNote || user?.membership_id !== content.creator_id || currentRevision?.number !== content.current_revision}
            >
              {savingRevision ? 'Saving all changes…' : hasDraftChanges ? 'Save all & submit →' : 'Submit for Review →'}
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

      {content.recheck && (
        <RecheckBanner notice={content.recheck}
          viewer={user?.membership_id === content.creator_id ? 'creator' : user?.membership_id === content.reviewer_id ? 'reviewer' : 'manager'} />
      )}

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
            disabled={hasDraftChanges || savingRevision || analysing || postingNote}
            title={postingNote ? 'Wait for your discussion note to finish posting before switching revisions.' : hasDraftChanges ? 'Save or discard the working draft before switching revisions.' : undefined}
            onClick={() => handleSelectRevision(idx)}
          >
            Rev #{rev.number} {idx === content.revisions.length - 1 ? '(Current)' : ''}
          </button>
        ))}
      </div>

      {/* Revision Diff Viewer if toggled */}
      <DiscussionDraftSummary revisions={content.revisions} currentId={currentRevision?.id}
        disabled={hasDraftChanges || savingRevision || analysing || postingNote} onOpen={handleSelectRevision} />
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
              {hasDraftChanges ? 'Working draft' : `Draft Copy (Rev #${currentRevision?.number})`}
            </h2>
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => {
                setIsEditing(!isEditing);
              }}
              disabled={!canEditDraft}
            >
              {isEditing ? 'Close editor' : 'Edit draft'}
            </button>
          </div>

          {isEditing ? (
            <form className="document-editor" onSubmit={e => e.preventDefault()}>
              <fieldset className="document-editor__fields" disabled={savingRevision || analysing || postingNote}>
              <div className="form-group" style={{ marginBottom: 'var(--space-4)' }}>
                <label htmlFor="edit-copy" className="form-label">Copy Text</label>
                <textarea
                  id="edit-copy"
                  aria-describedby="edit-copy-count"
                  aria-invalid={Boolean(draftFieldIssue('text', draftText))}
                  className="input"
                  rows={8}
                  value={draftText}
                  onChange={e => setDraft(current => changeDraftText(current, e.target.value))}
                  required
                />
                <DraftFieldCount field="text" value={draftText} id="edit-copy-count" />
              </div>

              <div className="document-editor__metadata">
                <div>
                  <label htmlFor="edit-channel" className="form-label" style={{ fontSize: '0.75rem' }}>Channel</label>
                  <input
                    id="edit-channel"
                    aria-describedby="edit-channel-count"
                    aria-invalid={Boolean(draftFieldIssue('channel', draftChannel))}
                    type="text"
                    className="input input--sm"
                    value={draftChannel}
                    onChange={e => setDraftChannel(e.target.value)}
                    required
                  />
                  <DraftFieldCount field="channel" value={draftChannel} id="edit-channel-count" />
                </div>
                <div>
                  <label htmlFor="edit-audience" className="form-label" style={{ fontSize: '0.75rem' }}>Audience</label>
                  <input
                    id="edit-audience"
                    aria-describedby="edit-audience-count"
                    aria-invalid={Boolean(draftFieldIssue('audience', draftAudience))}
                    type="text"
                    className="input input--sm"
                    value={draftAudience}
                    onChange={e => setDraftAudience(e.target.value)}
                    required
                  />
                  <DraftFieldCount field="audience" value={draftAudience} id="edit-audience-count" />
                </div>
                <div>
                  <label htmlFor="edit-purpose" className="form-label" style={{ fontSize: '0.75rem' }}>Purpose</label>
                  <input
                    id="edit-purpose"
                    aria-describedby="edit-purpose-count"
                    aria-invalid={Boolean(draftFieldIssue('purpose', draftPurpose))}
                    type="text"
                    className="input input--sm"
                    value={draftPurpose}
                    onChange={e => setDraftPurpose(e.target.value)}
                    required
                  />
                  <DraftFieldCount field="purpose" value={draftPurpose} id="edit-purpose-count" />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => setIsEditing(false)}
                >
                  Preview draft
                </button>

              </div>
              </fieldset>
            </form>
          ) : (
            <div className="document-canvas">
              <div className="document-canvas__masthead"><span>CAMPAIGN COPY</span><span>NO. {String(currentRevision?.number || 1).padStart(2, '0')}</span></div>
              <p className="document-canvas__hint">{hasDraftChanges ? 'Your working draft. Save all changes together when you’re ready.' : run?.findings.some(f => typeof f.location.start === 'number' && typeof f.location.end === 'number') ? 'Select an underlined phrase to follow the evidence.' : 'Your words. Ready for a closer look.'}</p>
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
              findings={run?.revision_id === currentRevision.id ? run.findings : []}
            />
          )}
        </div>

        {/* Right Column: Findings & Compliance Results */}
        <section className="findings-panel" aria-labelledby="findings-heading">
          <div className="panel-heading">
            <div><p className="eyebrow">A CLOSER LOOK</p><h2 id="findings-heading" style={{ margin: 0, fontSize: '1.125rem' }}>Compliance Findings {run && <span className="finding-count">{run.findings.length}</span>}</h2></div>
            <ProcessingMode isExternal={Boolean(run?.processing_snapshot.enabled && run?.processing_snapshot.consent)} />
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
                <span>For the next check: include external semantic review (Nebius Token Factory)</span>
              </label>
              <ExternalInputBudget text={draftText} policy={policy} />
            </div>
          )}

          {run ? (
            <div>
              {hasDraftChanges && <p className="draft-findings-note">These findings describe the saved revision. Staged fixes are only confirmed after rechecking.</p>}
              {canEditDraft && run.findings.some(f => f.suggested_edit) && <button className="btn btn--ghost btn--sm batch-apply" disabled={!availableFixCount} onClick={applyAvailableFixes}>{findingFiltersActive ? 'Apply visible fixes' : 'Apply available fixes'}</button>}
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

              <CoverageNotice run={run} canRecordManual={user?.membership_id === content.reviewer_id && !['approved', 'changes_requested'].includes(content.state)} />

              {run.stale && (
                <div style={{ marginBottom: 'var(--space-4)' }}>
                  <Alert kind="warning">
                    Source guidelines changed since this run. Re-run analysis for the latest standards.
                  </Alert>
                </div>
              )}

              {user?.membership_id === content.reviewer_id && !['approved', 'changes_requested'].includes(content.state) && <ManualChecks run={run} version={content.workflow_version} onSaved={loadContent} />}
              {/* Findings List */}
              {run.findings.length > 0 && <FindingFilters findings={run.findings} visibleCount={visibleFindings.length} values={findingFilterValues} onChange={values => setFindingFilterState({ runId: run.id, values })} />}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {run.findings.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 'var(--space-6)', color: 'var(--text-secondary)' }}>
                    {['queued', 'running'].includes(run.status) ? 'Analysis is pending.' : incompleteCategories(run).length ? 'No findings were returned. Review coverage is incomplete; this is not a clean compliance result.' : 'No compliance violations detected in completed checks. Human approval is still required.'}
                  </div>
                ) : visibleFindings.length === 0 ? <p className="draft-findings-note">No findings match these filters. Clear finding filters to see the complete review.</p> : (
                  visibleFindings.map(finding => {
                    const isSelected = activeFinding?.id === finding.id;
                    const isStaged = draft.changes.some(change => change.findingId === finding.id);
                    const hasLocation = typeof finding.location.start === 'number' && typeof finding.location.end === 'number';
                    const available = !isStaged && projectDraftRange(draft, finding.location.start, finding.location.end) !== null;
                    return (
                      <div
                        key={finding.id}
                        className={`card finding-card ${isSelected ? 'finding-card--selected' : ''} ${isStaged ? 'finding-card--staged' : ''}`}
                        data-finding-category={finding.category}
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
                              disabled={hasDraftChanges || savingRevision || resolutionActions(user, content, finding, run).length === 0}
                              title={hasDraftChanges ? 'Save and recheck before recording a disposition.' : 'Record human disposition (confirm, dismiss, exception)'}
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

                        {isStaged && <p className="staged-fix-label">✓ Added to draft · pending recheck</p>}
                        {finding.suggested_edit && !available && !isStaged && <p className="draft-findings-note">{hasLocation ? 'This passage overlaps another edit. Recheck the draft for a fresh suggestion.' : 'This suggestion has no exact text location. Use Edit draft to make the change.'}</p>}
                        {hasLocation && <div className="finding-passage"><span>In the saved draft</span><q>{finding.location.quote || Array.from(draft.baseText).slice(finding.location.start, finding.location.end).join('')}</q></div>}
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
                                disabled={!canEditDraft || !available}
                                title="Add this fix to the working draft without saving a revision"
                              >
                                {isStaged ? 'Added to draft' : 'Apply fix'}
                              </button>
                              <button
                                type="button"
                                className="btn btn--secondary btn--sm"
                                disabled={!canEditDraft || !available}
                                onClick={e => {
                                  e.stopPropagation();
                                  setEditingSuggestionFinding(finding);
                                }}
                              >
                                Customize fix
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

      {draftNotice && <p className="draft-notice" role="status">{draftNotice}</p>}
      {!hasDraftChanges && run && !analysing && issues.length > 0 && <aside className="review-readiness" aria-label="Before you submit"><h3>Before you submit</h3><ul>{issues.map(issue => <li key={issue}>{issue}</li>)}</ul></aside>}
      {hasDraftChanges && (
        <aside className="draft-action-bar" aria-label="Working draft actions">
          <div><strong>One draft. All your changes.</strong><p>{stagedCount} suggested {stagedCount === 1 ? 'fix' : 'fixes'} staged{draft.changes.some(change => !change.findingId) ? ' · manual edits included' : ''}. Save once when you’re ready.</p></div>
          <div className="draft-action-bar__buttons">
            <button className="btn btn--ghost btn--sm" disabled={savingRevision || !draft.changes.length} onClick={() => { setDraft(undoDraftChange(draft)); setDraftNotice('Last text change undone.'); }}>Undo last change</button>
            <button className="btn btn--ghost btn--sm" disabled={savingRevision} onClick={cancelEditing}>Discard changes</button>
            <button className="btn btn--ghost" disabled={savingRevision || analysing || !canEditDraft} onClick={() => { void handleSaveRevision(); }}>Save all & recheck</button>
            <button className="btn btn--primary" disabled={savingRevision || analysing || !canEditDraft} onClick={() => { void handleSaveRevision(undefined, undefined, true); }}>{savingRevision ? 'Saving all changes…' : 'Save all & submit'}</button>
          </div>
        </aside>
      )}

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
          contentQuote={Array.from(draft.baseText).slice(editingSuggestionFinding.location.start, editingSuggestionFinding.location.end).join('')}
          onApply={handleApplySuggestion}
          onClose={() => setEditingSuggestionFinding(null)}
        />
      )}

      {/* Concurrency Conflict Resolution Modal (409) */}
      {showAssignment && <AssignReviewerModal itemId={content.id} creatorId={content.creator_id} currentReviewerId={content.reviewer_id} version={content.workflow_version} onClose={() => setShowAssignment(false)} onRefresh={() => { setShowAssignment(false); void loadContent(); }} onAssigned={email => { setShowAssignment(false); setDraftNotice(`Reviewer assigned: ${email}. The assignment is recorded in the audit history.`); void loadContent(); }} />}
      {conflictServerRevision && (
        <ConflictResolutionModal
          serverRevision={conflictServerRevision}
          localDraftText={draftText}
          localContext={{ channel: draftChannel.trim(), audience: draftAudience.trim(), purpose: draftPurpose.trim() }}
          saving={savingRevision}
          error={error}
          onOverwrite={() => handleSaveRevision(undefined, conflictServerRevision.id)}
          onDiscard={() => {
            setSelectedRevIndex(content.revisions.findIndex(revision => revision.id === conflictServerRevision.id));
            setRun(null);
            setActiveFinding(null);
            resetDraft(conflictServerRevision.text);
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
      {showSubmitModal && currentRevision && run && (
        <SubmitReviewModal
          revisionId={currentRevision.id}
          expectedItemVersion={content.workflow_version}
          expectedRunId={run.id}
          expectedSourceEpoch={run?.source_epoch ?? 0}
          currentReviewerId={content.reviewer_id}
          blockingReasons={issues}
          onSuccess={() => {
            setShowSubmitModal(false);
            loadContent();
          }}
          onClose={() => setShowSubmitModal(false)}
        />
      )}

      {/* D4: Reviewer Decision Modal (Approve / Request Changes) */}
      {showDecisionModal && currentRevision && run && (
        <DecisionModal
          revisionId={currentRevision.id}
          expectedItemVersion={content.workflow_version}
          expectedRunId={run.id}
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
          allowedActions={resolutionActions(user, content, resolvingFinding, run)}
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
