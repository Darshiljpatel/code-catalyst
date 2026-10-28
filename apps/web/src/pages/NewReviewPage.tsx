import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  getBrands,
  getReviewers,
  getProcessingPolicy,
  createContent,
  startAnalysis,
  uploadImageCampaign,
  IMAGE_LIMITS,
  ApiResponseError,
} from '../api/client';
import type { Brand, PolicyOut, ReviewerOut } from '../api/types';
import { FIXTURE_LUMADESK_DRAFT_TEXT } from '../api/fixtures';
import { Alert, Spinner, ProcessingMode } from '../components/Primitives';
import { ImportDraft } from '../components/ImportDraft';
import { ExternalInputBudget } from '../components/ExternalInputBudget';
import { DraftFieldCount } from '../components/DraftFieldCount';
import { draftFieldIssue, validateDraft } from '../api/draftValidation';
import { useLeaveConfirmation, useUnsavedChanges } from '../context/UnsavedChangesContext';

export function NewReviewPage() {
  const navigate = useNavigate();
  const location = useLocation();

  const [brands, setBrands] = React.useState<Brand[]>([]);
  const [policy, setPolicy] = React.useState<PolicyOut | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Form fields
  const [brandId, setBrandId] = React.useState<string>('');
  const [title, setTitle] = React.useState('LumaDesk Q4 Launch Copy');
  const [channel, setChannel] = React.useState('email');
  const [audience, setAudience] = React.useState('SMB prospective customers');
  const [purpose, setPurpose] = React.useState('Acquisition and free trial signup');
  const [reviewerId, setReviewerId] = React.useState('');
  const [reviewers, setReviewers] = React.useState<ReviewerOut[]>([]);
  const [text, setText] = React.useState(FIXTURE_LUMADESK_DRAFT_TEXT);
  // Set when the draft came from a PDF/DOCX import; the server records whether the text was edited afterwards.
  const [documentImportId, setDocumentImportId] = React.useState<string | null>(null);

  // Consent
  const [consent, setConsent] = React.useState(true);
  // Text campaigns paste copy; image campaigns upload a PNG/JPEG whose text is read locally.
  const [mode, setMode] = React.useState<'text' | 'image'>('text');
  const [file, setFile] = React.useState<File | null>(null);
  const [preview, setPreview] = React.useState<string | null>(null);
  const [baseline, setBaseline] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const { setGuard } = useLeaveConfirmation();
  const fingerprint = JSON.stringify([brandId, title, channel, audience, purpose, reviewerId, text, consent, mode, file?.name ?? null]);
  React.useEffect(() => {
    if (!file) { setPreview(null); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const chooseFile = (candidate: File | undefined | null) => {
    if (!candidate) return;
    if (!IMAGE_LIMITS.types.includes(candidate.type)) { setError('Upload a PNG or JPEG image.'); return; }
    if (candidate.size > IMAGE_LIMITS.maxBytes) { setError('Images must be 8 MB or smaller.'); return; }
    setError(null);
    setFile(candidate);
  };

  const loadSampleAd = async () => {
    try {
      const response = await fetch('/samples/lumadesk-social-ad.png');
      const blob = await response.blob();
      chooseFile(new File([blob], 'lumadesk-social-ad.png', { type: 'image/png' }));
      setTitle('LumaDesk social ad');
      setChannel('social');
    } catch {
      setError('The sample ad could not be loaded.');
    }
  };
  React.useLayoutEffect(() => {
    if (!loading && baseline === null) setBaseline(fingerprint);
  }, [loading, baseline, fingerprint]);
  useUnsavedChanges(!saved && baseline !== null && baseline !== fingerprint, submitting && !saved);

  const openSavedCampaign = (id: string, analysisStartFailed = false) => {
    setSaved(true);
    // The revision exists now. Clear synchronously before the router evaluates navigation.
    setGuard({ dirty: false, busy: false });
    navigate(`/content/${id}`, analysisStartFailed ? { state: { analysisStartFailed: true } } : undefined);
  };

  React.useEffect(() => {
    setLoading(true);
    Promise.all([getBrands(), getProcessingPolicy().catch(() => null), getReviewers()])
      .then(([bList, p, availableReviewers]) => {
        setReviewers(availableReviewers);
        setBrands(bList);
        setPolicy(p);
        const preselected = (location.state as { brandId?: string } | null)?.brandId;
        if (preselected && bList.some(b => b.id === preselected)) {
          setBrandId(preselected);
        } else if (bList.length > 0) {
          setBrandId(bList[0].id);
        }
      })
      .catch(err => {
        setError(err instanceof Error ? err.message : 'Failed to initialize intake form');
      })
      .finally(() => setLoading(false));
  }, [location.state]);

  const wordCount = React.useMemo(() => {
    const trimmed = text.trim();
    return trimmed ? trimmed.split(/\s+/).length : 0;
  }, [text]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!brandId) {
      setError('Please select a brand.');
      return;
    }
    const issues = validateDraft({ title, text: mode === 'image' ? 'image' : text, channel, audience, purpose });
    if (issues.length) {
      setError(issues.join(' '));
      return;
    }
    if (mode === 'image' && !file) {
      setError('Choose a PNG or JPEG image to upload.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      if (mode === 'image' && file) {
        const created = await uploadImageCampaign({ brand_id: brandId, title: title.trim(), channel: channel.trim(),
          audience: audience.trim(), purpose: purpose.trim(), reviewer_id: reviewerId.trim() || null, file });
        openSavedCampaign(created.id);
        return;
      }
      // 1. Create content item (Revision 1)
      const content = await createContent({
        brand_id: brandId,
        title: title.trim(),
        text,
        channel: channel.trim(),
        audience: audience.trim(),
        purpose: purpose.trim(),
        reviewer_id: reviewerId.trim() || null,
        document_import_id: documentImportId,
      });

      // 2. Start review run on first revision
      const firstRev = content.revisions[0];
      if (firstRev) {
        try {
          await startAnalysis(
            firstRev.id,
            {
              external_processing_consent: policy?.enabled ? consent : false,
              policy_version: policy?.enabled && consent ? policy.version : null,
            },
            'run-' + crypto.randomUUID()
          );
        } catch {
          // Creation succeeded. Retrying intake would create a second campaign.
          openSavedCampaign(content.id, true);
          return;
        }
      }

      // 3. Navigate to workspace
      openSavedCampaign(content.id);
    } catch (err) {
      if (err instanceof ApiResponseError) {
        setError(err.body.message || 'Failed to submit content for review');
      } else {
        setError('Network error submitting content');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <main className="page-container" id="main-content" style={{ textAlign: 'center', padding: 'var(--space-12)' }}>
        <Spinner size="lg" label="Loading intake form…" />
      </main>
    );
  }

  return (
    <main className="page-container" id="main-content">
      <div style={{ maxWidth: '800px', margin: '0 auto' }}>
        <button
          className="btn btn--ghost btn--sm"
          onClick={() => navigate('/')}
          style={{ marginBottom: 'var(--space-4)' }}
        >
          ← Cancel and return home
        </button>

        <h1 style={{ marginBottom: 'var(--space-2)' }}>Start a Brand Compliance Review</h1>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 'var(--space-6)' }}>
          Submit marketing copy, campaign drafts, or customer-facing copy for source-grounded review.
        </p>

        {error && <Alert kind="error">{error}</Alert>}

        {/* Processing Mode Disclosure */}
        <div className="card" style={{ padding: 'var(--space-5)', marginBottom: 'var(--space-6)', background: 'var(--glass-bg)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: '6px' }}>
            <ProcessingMode isExternal={Boolean(policy?.enabled && consent)} />
            <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>
              Processing Mode & Boundary
            </span>
          </div>

          {policy?.enabled ? (
            <div>
              <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', margin: '0 0 var(--space-3)' }}>
                {policy.notice} (Provider: <strong>{policy.provider}</strong>, Model: <strong>{policy.model}</strong>)
              </p>
              <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  id="chk-consent"
                  checked={consent}
                  disabled={submitting}
                  onChange={e => setConsent(e.target.checked)}
                  style={{ width: '16px', height: '16px', accentColor: 'var(--accent)' }}
                />
                <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Include Nebius semantic review under workspace policy v{policy.version} (enabled by default; uncheck for local checks only)
                </span>
              </label>
              <ExternalInputBudget text={text} policy={policy} />
            </div>
          ) : (
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', margin: 0 }}>
              Local checks run for supported content and rules. Semantic checks remain unavailable until external processing is enabled and consented to. Review results show the coverage of each check.
            </p>
          )}
        </div>

        <form onSubmit={handleSubmit} className="card" style={{ padding: 'var(--space-8)' }}>
          <fieldset disabled={submitting} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
          <div className="form-group" style={{ marginBottom: 'var(--space-5)' }}>
            <label htmlFor="sel-brand" className="form-label">
              Brand Guidelines Target <span style={{ color: 'var(--color-blocker)' }}>*</span>
            </label>
            <select
              id="sel-brand"
              className="input"
              value={brandId}
              onChange={e => setBrandId(e.target.value)}
              required
            >
              {brands.map(b => (
                <option key={b.id} value={b.id}>
                  {b.name} (guideline version {b.source_epoch})
                </option>
              ))}
            </select>
          </div>

          <div className="form-group" style={{ marginBottom: 'var(--space-5)' }}>
            <label htmlFor="txt-title" className="form-label">
              Campaign / Asset Title <span style={{ color: 'var(--color-blocker)' }}>*</span>
            </label>
            <input
              id="txt-title"
              aria-describedby="new-title-count"
              aria-invalid={Boolean(draftFieldIssue('title', title))}
              type="text"
              className="input"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Q4 Growth Campaign - Free Trial Email"
              required
            />
            <DraftFieldCount field="title" value={title} id="new-title-count" />
          </div>

          <div className="form-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-4)', marginBottom: 'var(--space-5)' }}>
            <div className="form-group">
              <label htmlFor="sel-channel" className="form-label">
                Channel <span style={{ color: 'var(--color-blocker)' }}>*</span>
              </label>
              <select
                id="sel-channel"
                className="input"
                value={channel}
                onChange={e => setChannel(e.target.value)}
                required
              >
                <option value="email">Email</option>
                <option value="social">Social Media</option>
                <option value="landing_page">Landing Page</option>
                <option value="ad">Digital Ad</option>
                <option value="blog">Blog / PR</option>
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="txt-audience" className="form-label">
                Audience <span style={{ color: 'var(--color-blocker)' }}>*</span>
              </label>
              <input
                id="txt-audience"
                aria-describedby="new-audience-count"
                aria-invalid={Boolean(draftFieldIssue('audience', audience))}
                type="text"
                className="input"
                value={audience}
                onChange={e => setAudience(e.target.value)}
                placeholder="e.g. SMB decision makers"
                required
              />
              <DraftFieldCount field="audience" value={audience} id="new-audience-count" />
            </div>

            <div className="form-group">
              <label htmlFor="txt-purpose" className="form-label">
                Purpose <span style={{ color: 'var(--color-blocker)' }}>*</span>
              </label>
              <input
                id="txt-purpose"
                aria-describedby="new-purpose-count"
                aria-invalid={Boolean(draftFieldIssue('purpose', purpose))}
                type="text"
                className="input"
                value={purpose}
                onChange={e => setPurpose(e.target.value)}
                placeholder="e.g. Trial conversion"
                required
              />
              <DraftFieldCount field="purpose" value={purpose} id="new-purpose-count" />
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: 'var(--space-5)' }}>
            <label htmlFor="txt-reviewer" className="form-label">
              Assigned reviewer <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>(Optional)</span>
            </label>
            <select
              id="txt-reviewer"
              className="input"
              value={reviewerId}
              onChange={e => setReviewerId(e.target.value)}
            >
              <option value="">Assign later</option>
              {reviewers.map(reviewer => <option key={reviewer.id} value={reviewer.id}>{reviewer.email}</option>)}
            </select>
            {reviewers.length === 0 && <p className="form-hint">A workspace administrator must add a separate reviewer before approval.</p>}
          </div>

          <div className="form-group" style={{ marginBottom: 'var(--space-4)' }}>
            <span className="form-label" id="campaign-kind-label">Campaign type</span>
            <div className="filter-bar" role="group" aria-labelledby="campaign-kind-label">
              <button type="button" className={`filter-btn ${mode === 'text' ? 'filter-btn--active' : ''}`} aria-pressed={mode === 'text'} onClick={() => setMode('text')}>Text campaign</button>
              <button type="button" className={`filter-btn ${mode === 'image' ? 'filter-btn--active' : ''}`} aria-pressed={mode === 'image'} onClick={() => setMode('image')}>Image campaign</button>
            </div>
          </div>

          {mode === 'image' ? (
          <div className="form-group" style={{ marginBottom: 'var(--space-6)' }}>
            <label htmlFor="file-campaign-image" className="form-label">Campaign image <span style={{ color: 'var(--color-blocker)' }}>*</span></label>
            <div className={`image-drop${file ? ' image-drop--chosen' : ''}`}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); chooseFile(e.dataTransfer.files?.[0]); }}>
              {preview ? <img src={preview} alt="Preview of the chosen campaign image" className="image-drop__preview" /> : <p>Drop a PNG or JPEG here, or choose a file.</p>}
              <input id="file-campaign-image" type="file" accept="image/png,image/jpeg" aria-describedby="image-limits"
                onChange={e => chooseFile(e.target.files?.[0])} />
            </div>
            <p id="image-limits" className="form-hint">
              PNG or JPEG, up to 8 MB and {IMAGE_LIMITS.maxMegapixels} megapixels. Text is read on our servers and you confirm it
              before checking; the image itself is never sent to an AI provider. Location and camera details are removed.
            </p>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => { void loadSampleAd(); }}>Try the sample ad</button>
          </div>
          ) : (
          <div className="form-group" style={{ marginBottom: 'var(--space-6)' }}>
            <ImportDraft onImported={(imported, importId) => { setText(imported); setDocumentImportId(importId); }} disabled={submitting} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--space-2)' }}>
              <label htmlFor="txt-content-text" className="form-label" style={{ margin: 0 }}>
                Draft Campaign Copy <span style={{ color: 'var(--color-blocker)' }}>*</span>
              </label>
              <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                {wordCount} words • <DraftFieldCount field="text" value={text} id="new-copy-count" inline />
              </span>
            </div>
            <textarea
              id="txt-content-text"
              aria-describedby="new-copy-count"
              aria-invalid={Boolean(draftFieldIssue('text', text))}
              className="input"
              rows={6}
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="Enter the copy to be evaluated..."
              required
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-2)' }}>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => { setText(FIXTURE_LUMADESK_DRAFT_TEXT); setDocumentImportId(null); }}
              >
                Reset to LumaDesk Demo Copy
              </button>
            </div>
          </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => navigate('/')}
            >
              Cancel
            </button>
            <button
              id="btn-submit-review"
              type="submit"
              className="btn btn--primary btn--lg"
              disabled={submitting}
            >
              {submitting ? (mode === 'image' ? 'Uploading…' : 'Creating draft & analysing…') : mode === 'image' ? 'Upload and read text →' : 'Submit for Compliance Review →'}
            </button>
          </div>
          </fieldset>
        </form>
      </div>
    </main>
  );
}
