import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  getBrands,
  getProcessingPolicy,
  createContent,
  startAnalysis,
  ApiResponseError,
} from '../api/client';
import type { Brand, PolicyOut } from '../api/types';
import { FIXTURE_LUMADESK_DRAFT_TEXT } from '../api/fixtures';
import { Alert, Spinner, ProcessingMode } from '../components/Primitives';

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
  const [text, setText] = React.useState(FIXTURE_LUMADESK_DRAFT_TEXT);

  // Consent
  const [consent, setConsent] = React.useState(false);

  React.useEffect(() => {
    setLoading(true);
    Promise.all([getBrands(), getProcessingPolicy().catch(() => null)])
      .then(([bList, p]) => {
        setBrands(bList);
        setPolicy(p);
        const preselected = (location.state as any)?.brandId;
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
    if (!brandId) {
      setError('Please select a brand.');
      return;
    }
    if (!title.trim() || !text.trim() || !channel.trim() || !audience.trim() || !purpose.trim()) {
      setError('All fields except reviewer ID are required.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      // 1. Create content item (Revision 1)
      const content = await createContent({
        brand_id: brandId,
        title: title.trim(),
        text: text.trim(),
        channel: channel.trim(),
        audience: audience.trim(),
        purpose: purpose.trim(),
        reviewer_id: reviewerId.trim() || null,
      });

      // 2. Start review run on first revision
      const firstRev = content.revisions[0];
      if (firstRev) {
        const idempotencyKey = 'run-' + Math.random().toString(36).substring(2, 15);
        await startAnalysis(
          firstRev.id,
          {
            external_processing_consent: policy?.enabled ? consent : false,
            policy_version: policy?.enabled && consent ? policy.version : null,
          },
          idempotencyKey
        );
      }

      // 3. Navigate to workspace
      navigate(`/content/${content.id}`);
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
                  onChange={e => setConsent(e.target.checked)}
                  style={{ width: '16px', height: '16px', accentColor: 'var(--accent)' }}
                />
                <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  I consent to external semantic evaluation under workspace policy v{policy.version}
                </span>
              </label>
            </div>
          ) : (
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', margin: 0 }}>
              Local deterministic checking only. Terminology, structured facts, visual, and accessibility rules are verified against active guidelines. Semantic processing is currently disabled by administrator policy.
            </p>
          )}
        </div>

        <form onSubmit={handleSubmit} className="card" style={{ padding: 'var(--space-8)' }}>
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
                  {b.name} (Source Epoch {b.source_epoch})
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
              type="text"
              className="input"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Q4 Growth Campaign - Free Trial Email"
              required
            />
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
                type="text"
                className="input"
                value={audience}
                onChange={e => setAudience(e.target.value)}
                placeholder="e.g. SMB decision makers"
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="txt-purpose" className="form-label">
                Purpose <span style={{ color: 'var(--color-blocker)' }}>*</span>
              </label>
              <input
                id="txt-purpose"
                type="text"
                className="input"
                value={purpose}
                onChange={e => setPurpose(e.target.value)}
                placeholder="e.g. Trial conversion"
                required
              />
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: 'var(--space-5)' }}>
            <label htmlFor="txt-reviewer" className="form-label">
              Assigned Reviewer Membership ID <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>(Optional)</span>
            </label>
            <input
              id="txt-reviewer"
              type="text"
              className="input"
              value={reviewerId}
              onChange={e => setReviewerId(e.target.value)}
              placeholder="UUID or membership identifier of a separate reviewer"
            />
          </div>

          <div className="form-group" style={{ marginBottom: 'var(--space-6)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--space-2)' }}>
              <label htmlFor="txt-content-text" className="form-label" style={{ margin: 0 }}>
                Draft Campaign Copy <span style={{ color: 'var(--color-blocker)' }}>*</span>
              </label>
              <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                {wordCount} words • {text.length} characters
              </span>
            </div>
            <textarea
              id="txt-content-text"
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
                onClick={() => setText(FIXTURE_LUMADESK_DRAFT_TEXT)}
              >
                Reset to LumaDesk Demo Copy
              </button>
            </div>
          </div>

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
              {submitting ? 'Creating draft & analysing…' : 'Submit for Compliance Review →'}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
