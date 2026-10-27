import React from 'react';
import { localDateTimeInput } from '../api/localDateTime';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { useParams, useNavigate } from 'react-router-dom';
import {
  getBrand,
  getSources,
  createSource,
  activateSource,
  getImpactPreview,
  ApiResponseError,
} from '../api/client';
import type {
  Brand,
  SourceOut,
  RuleInput,
  RuleCategory,
  RuleKind,
  ImpactPreview,
} from '../api/types';
import { ImpactBadge } from '../components/ImpactBadge';
import { useAuth } from '../context/AuthContext';
import { Alert, Spinner, EmptyState } from '../components/Primitives';
import { BrandInsightsModal } from '../components/BrandInsightsModal';
import { AmbiguityReportModal } from '../components/AmbiguityReportModal';

export function BrandDetailPage() {
  const { brandId } = useParams<{ brandId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [brand, setBrand] = React.useState<Brand | null>(null);
  const [sources, setSources] = React.useState<SourceOut[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [filterState, setFilterState] = React.useState<'all' | 'active' | 'draft' | 'retired'>('all');

  // Modals
  const [showAddModal, setShowAddModal] = React.useState(false);
  const [activatingSource, setActivatingSource] = React.useState<SourceOut | null>(null);
  const [showInsightsModal, setShowInsightsModal] = React.useState(false);
  const [reportingAmbiguity, setReportingAmbiguity] = React.useState<{ sourceId: string; sourceTitle?: string; ruleId?: string } | null>(null);

  const isManager = user?.role === 'manager';

  const loadData = React.useCallback(async () => {
    if (!brandId) return;
    setLoading(true);
    setError(null);
    try {
      const [b, s] = await Promise.all([getBrand(brandId), getSources(brandId)]);
      setBrand(b);
      setSources(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load brand sources');
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  React.useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredSources = React.useMemo(() => {
    if (filterState === 'all') return sources;
    return sources.filter(s => s.state === filterState);
  }, [sources, filterState]);

  return (
    <main className="page-container" id="main-content">
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <button
          className="btn btn--ghost btn--sm"
          onClick={() => navigate('/')}
          style={{ marginBottom: 'var(--space-3)' }}
        >
          ← Back to all brands
        </button>

        {loading ? (
          <div style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
            <Spinner size="lg" label="Loading brand guidelines…" />
          </div>
        ) : error || !brand ? (
          <Alert kind="error">{error || 'Brand not found'}</Alert>
        ) : (
          <>
            <div className="brand-header">
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                  <h1 style={{ margin: 0 }}>{brand.name}</h1>
                  <span className="badge badge--neutral">
                    Guideline set v{brand.source_epoch}
                  </span>
                </div>
                <p style={{ color: 'var(--text-secondary)', margin: 'var(--space-2) 0 0' }}>
                  Approved brand guidelines, facts, terminology, and compliance rules.
                </p>
              </div>

              <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
                {user?.role === 'manager' && (
                  <button id="btn-guideline-health" className="btn btn--primary" onClick={() => navigate(`/brands/${brand.id}/health`)}>
                    Guideline health
                  </button>
                )}
                <button
                  id="btn-brand-insights"
                  className="btn btn--secondary"
                  onClick={() => setShowInsightsModal(true)}
                  title="View real-data rule violation rates and governance metrics"
                >
                  📊 Governance Insights
                </button>
                <button
                  className="btn btn--secondary"
                  onClick={() => navigate('/review/new', { state: { brandId: brand.id } })}
                >
                  ＋ Review content
                </button>
                {isManager && (
                  <button
                    id="btn-add-source"
                    className="btn btn--primary"
                    onClick={() => setShowAddModal(true)}
                  >
                    ＋ Add guideline source
                  </button>
                )}
              </div>
            </div>

            {/* Source lifecycle filters */}
            <div className="filter-bar" style={{ marginTop: 'var(--space-6)', marginBottom: 'var(--space-6)' }}>
              {(['all', 'active', 'draft', 'retired'] as const).map(tab => {
                const count = tab === 'all' ? sources.length : sources.filter(s => s.state === tab).length;
                return (
                  <button
                    key={tab}
                    className={`filter-btn ${filterState === tab ? 'filter-btn--active' : ''}`}
                    onClick={() => setFilterState(tab)}
                  >
                    {tab.charAt(0).toUpperCase() + tab.slice(1)} ({count})
                  </button>
                );
              })}
            </div>

            {/* Sources list */}
            {filteredSources.length === 0 ? (
              <EmptyState
                icon="📄"
                title={`No ${filterState === 'all' ? '' : filterState} sources found`}
                description={
                  isManager
                    ? 'Add a structured brand source to establish compliance criteria.'
                    : 'A manager can define and activate approved guidelines for this brand.'
                }
              />
            ) : (
              <div className="sources-list" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                {filteredSources.map(source => (
                  <SourceCard
                    key={source.id}
                    source={source}
                    isManager={isManager}
                    onActivate={() => setActivatingSource(source)}
                    onReportAmbiguity={(ruleId?: string) =>
                      setReportingAmbiguity({
                        sourceId: source.id,
                        sourceTitle: source.title,
                        ruleId,
                      })
                    }
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Add Source Modal */}
      {showAddModal && brand && (
        <AddSourceModal
          brandId={brand.id}
          onClose={() => setShowAddModal(false)}
          onSuccess={() => {
            setShowAddModal(false);
            loadData();
          }}
        />
      )}

      {/* Activate Source Modal */}
      {activatingSource && brand && (
        <ActivateSourceModal
          source={activatingSource}
          brand={brand}
          allSources={sources}
          onClose={() => setActivatingSource(null)}
          onSuccess={() => {
            setActivatingSource(null);
            loadData();
          }}
        />
      )}

      {/* D4: Brand Governance Insights Modal */}
      {showInsightsModal && brand && (
        <BrandInsightsModal
          brandId={brand.id}
          brandName={brand.name}
          onClose={() => setShowInsightsModal(false)}
        />
      )}

      {/* D4: Ambiguity Report Modal */}
      {reportingAmbiguity && (
        <AmbiguityReportModal
          sourceId={reportingAmbiguity.sourceId}
          sourceTitle={reportingAmbiguity.sourceTitle}
          ruleId={reportingAmbiguity.ruleId}
          onSuccess={() => {
            setReportingAmbiguity(null);
            loadData();
          }}
          onClose={() => setReportingAmbiguity(null)}
        />
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Source Card Component
// ---------------------------------------------------------------------------

function SourceCard({
  source,
  isManager,
  onActivate,
  onReportAmbiguity,
}: {
  source: SourceOut;
  isManager: boolean;
  onActivate: () => void;
  onReportAmbiguity: (ruleId?: string) => void;
}) {
  const [expanded, setExpanded] = React.useState(false);

  const stateBadgeClass =
    source.state === 'active'
      ? 'badge--success'
      : source.state === 'draft'
      ? 'badge--warning'
      : 'badge--neutral';

  return (
    <article className="card source-card" style={{ padding: 'var(--space-6)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: '4px' }}>
            <h3 style={{ margin: 0, fontSize: '1.125rem' }}>{source.title}</h3>
            <span className={`badge ${stateBadgeClass}`}>{source.state.toUpperCase()}</span>
            <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
              v{source.version} • key: <code>{source.source_key}</code>
            </span>
          </div>
          <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
            Valid: {new Date(source.valid_from).toLocaleDateString()}
            {source.valid_until ? ` to ${new Date(source.valid_until).toLocaleDateString()}` : ' (ongoing)'}
            {source.activated_by && ` • Activated by ${source.activated_by}`}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => onReportAmbiguity()}
            title="Report this source as ambiguous or conflicting"
          >
            🚩 Report Ambiguity
          </button>
          {isManager && source.state === 'draft' && (
            <button className="btn btn--primary btn--sm" onClick={onActivate}>
              Activate Source
            </button>
          )}
          <button
            className="btn btn--ghost btn--sm"
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
          >
            {expanded ? 'Hide Rules & Text' : `View Rules (${source.rules.length})`}
          </button>
        </div>
      </div>

      {expanded && (
        <div style={{ marginTop: 'var(--space-5)', borderTop: '1px solid var(--border-subtle)', paddingTop: 'var(--space-4)' }}>
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '6px', color: 'var(--text-secondary)' }}>
              Raw Source Text:
            </div>
            <div className="source-raw-text">
              {source.text}
            </div>
          </div>

          <div>
            <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '6px', color: 'var(--text-secondary)' }}>
              Structured Extraction Rules:
            </div>
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Rule ID</th>
                    <th>Category</th>
                    <th>Kind</th>
                    <th>Key</th>
                    <th>Approved Value</th>
                    <th>Evidence Quote</th>
                    <th style={{ textAlign: 'right' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {source.rules.map(rule => (
                    <tr key={rule.id}>
                      <td><code>{rule.id}</code></td>
                      <td><span className="badge badge--neutral">{rule.category}</span></td>
                      <td>{rule.kind}</td>
                      <td><strong>{rule.key}</strong></td>
                      <td>{rule.value}</td>
                      <td style={{ fontStyle: 'italic', color: 'var(--text-secondary)' }}>
                        "{rule.evidence_quote}"
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() => onReportAmbiguity(rule.id)}
                          title={`Report rule ${rule.id} as ambiguous or conflicting`}
                        >
                          🚩
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Add Source Modal Component
// ---------------------------------------------------------------------------

function useSourceDialog(onClose: () => void, busy: boolean) {
  const ref = useDialogFocus();
  React.useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose, busy]);
  return ref;
}

function AddSourceModal({
  brandId,
  onClose,
  onSuccess,
}: {
  brandId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [sourceKey, setSourceKey] = React.useState('trial_terms');
  const [title, setTitle] = React.useState('Approved trial terms');
  const [text, setText] = React.useState('The trial lasts 14 days. No credit card is required.');
  const [validFrom, setValidFrom] = React.useState(() => localDateTimeInput(new Date()));
  const [rules, setRules] = React.useState<RuleInput[]>([
    {
      id: 'F-01',
      category: 'facts_claims',
      kind: 'fact',
      key: 'trial_duration',
      value: '14 days',
      evidence_quote: 'The trial lasts 14 days.',
    },
  ]);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const addRule = () => {
    if (rules.length >= 100) return;
    setRules(prev => {
      let next = 1;
      while (prev.some(rule => rule.id === `R-${next}`)) next++;
      return [...prev, {
        id: `R-${next}`,
        category: 'terminology',
        kind: 'terminology',
        key: '',
        value: '',
        evidence_quote: '',
      }];
    });
  };

  const updateRule = (index: number, updates: Partial<RuleInput>) => {
    setRules(prev => prev.map((r, i) => (i === index ? { ...r, ...updates } : r)));
  };

  const removeRule = (index: number) => {
    setRules(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!sourceKey.trim() || !title.trim() || !text.trim()) {
      setError('Key, title, and source text cannot be blank.');
      return;
    }
    if (rules.length === 0) {
      setError('At least one rule must be defined.');
      return;
    }
    if (new Set(rules.map(rule => rule.id.trim())).size !== rules.length) {
      setError('Each rule needs a unique ID within this source.');
      return;
    }
    // Check evidence quotes
    for (const r of rules) {
      if (!text.includes(r.evidence_quote)) {
        setError(`Evidence quote for rule "${r.id}" must literally appear in the source text.`);
        return;
      }
    }

    setSubmitting(true);
    setError(null);
    try {
      await createSource(brandId, {
        source_key: sourceKey.trim(),
        title: title.trim(),
        text,
        rules,
        valid_from: new Date(validFrom).toISOString(),
        valid_until: null,
      });
      onSuccess();
    } catch (err) {
      if (err instanceof ApiResponseError) {
        setError(err.body.message || 'Creation rejected by server');
      } else {
        setError('Failed to create source draft');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const dialogRef = useSourceDialog(onClose, submitting);
  return (
    <div className="modal-backdrop source-authoring-dialog" ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="add-source-title">
      <div className="modal-card modal-card--lg animate-scale-in">
        <div className="modal-header">
          <h2 id="add-source-title" style={{ margin: 0, fontSize: '1.25rem' }}>
            Add Brand Guideline Source Draft
          </h2>
          <button className="btn btn--ghost btn--sm" onClick={onClose} aria-label="Close dialog" disabled={submitting}>
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body">
          {error && <Alert kind="error">{error}</Alert>}
          <fieldset disabled={submitting} className="source-dialog-fields">

          <div className="form-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
            <div className="form-group">
              <label htmlFor="txt-src-key" className="form-label">
                Source Key <span style={{ color: 'var(--color-blocker)' }}>*</span>
              </label>
              <input
                id="txt-src-key"
                maxLength={100}
                type="text"
                className="input"
                pattern="^[A-Za-z0-9_-]+$"
                value={sourceKey}
                onChange={e => setSourceKey(e.target.value)}
                placeholder="e.g. trial_terms"
                required
              />
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Groups versions of the same guideline.
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="txt-src-title" className="form-label">
                Title <span style={{ color: 'var(--color-blocker)' }}>*</span>
              </label>
              <input
                id="txt-src-title"
                maxLength={200}
                type="text"
                className="input"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="e.g. Approved trial terms"
                required
              />
            </div>
          </div>

          <div className="form-group" style={{ marginTop: 'var(--space-4)' }}>
            <label htmlFor="txt-src-text" className="form-label">
              Full Source Text <span style={{ color: 'var(--color-blocker)' }}>*</span>
            </label>
            <textarea
              id="txt-src-text"
              maxLength={100000}
              className="input"
              rows={4}
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="Paste or write the authoritative brand guidelines or contract text..."
              required
            />
          </div>

          <div className="form-group" style={{ marginTop: 'var(--space-4)' }}>
            <label htmlFor="txt-src-from" className="form-label">
              Effective Valid From (Date & Time)
            </label>
            <input
              id="txt-src-from"
              type="datetime-local"
              className="input"
              value={validFrom}
              onChange={e => setValidFrom(e.target.value)}
              required
            />
            <small>Local time in {Intl.DateTimeFormat().resolvedOptions().timeZone}; saved as a UTC timestamp.</small>
          </div>

          <div style={{ marginTop: 'var(--space-6)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
              <h4 style={{ margin: 0 }}>Structured Rules & Facts ({rules.length})</h4>
              <button type="button" className="btn btn--secondary btn--sm" onClick={addRule} disabled={rules.length >= 100}>
                + Add Rule
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {rules.map((rule, idx) => (
                <div key={idx} className="rule-editor-box">
                  <div className="source-rule-controls" style={{ display: 'grid', gridTemplateColumns: '80px 140px 130px minmax(0, 1fr) auto', gap: 'var(--space-2)', alignItems: 'center' }}>
                    <input
                      type="text"
                      className="input input--sm"
                      placeholder="ID"
                      aria-label={`Rule ${idx + 1} ID`}
                      maxLength={100}
                      value={rule.id}
                      onChange={e => updateRule(idx, { id: e.target.value })}
                      required
                    />
                    <select
                      className="input input--sm"
                      value={rule.category}
                      aria-label={`Rule ${idx + 1} category`}
                      onChange={e => updateRule(idx, { category: e.target.value as RuleCategory })}
                    >
                      <option value="facts_claims">facts_claims</option>
                      <option value="terminology">terminology</option>
                      <option value="tone">tone</option>
                      <option value="messaging">messaging</option>
                      <option value="visual">visual</option>
                      <option value="accessibility">accessibility</option>
                    </select>
                    <select
                      className="input input--sm"
                      value={rule.kind}
                      aria-label={`Rule ${idx + 1} kind`}
                      onChange={e => updateRule(idx, { kind: e.target.value as RuleKind })}
                    >
                      <option value="fact">fact</option>
                      <option value="terminology">terminology</option>
                      <option value="guidance">guidance</option>
                      <option value="claim_policy">claim_policy</option>
                      <option value="asset">asset</option>
                      <option value="contrast">contrast</option>
                      <option value="alt_text">alt_text</option>
                    </select>
                    <input
                      type="text"
                      className="input input--sm"
                      placeholder="Fact Key (e.g. trial_duration)"
                      aria-label={`Rule ${idx + 1} key`}
                      maxLength={100}
                      value={rule.key}
                      onChange={e => updateRule(idx, { key: e.target.value })}
                      required
                    />
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => removeRule(idx)}
                      disabled={rules.length <= 1}
                      title="Remove rule"
                      aria-label={`Remove rule ${idx + 1}`}
                    >
                      ✕
                    </button>
                  </div>

                  <div className="source-rule-values" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
                    <input
                      type="text"
                      className="input input--sm"
                      placeholder="Approved value (e.g. 14 days)"
                      aria-label={`Rule ${idx + 1} approved value`}
                      maxLength={2000}
                      value={rule.value}
                      onChange={e => updateRule(idx, { value: e.target.value })}
                      required
                    />
                    <input
                      type="text"
                      className="input input--sm"
                      placeholder="Evidence Quote (must match source text)"
                      aria-label={`Rule ${idx + 1} evidence quote`}
                      maxLength={4000}
                      value={rule.evidence_quote}
                      onChange={e => updateRule(idx, { evidence_quote: e.target.value })}
                      required
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="modal-actions" style={{ marginTop: 'var(--space-6)' }}>
            <button type="button" className="btn btn--ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary" disabled={submitting}>
              {submitting ? 'Creating draft…' : 'Create Source Draft'}
            </button>
          </div>
          </fieldset>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Activate Source Modal Component
// ---------------------------------------------------------------------------

function ActivateSourceModal({
  source,
  brand,
  allSources,
  onClose,
  onSuccess,
}: {
  source: SourceOut;
  brand: Brand;
  allSources: SourceOut[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [rationale, setRationale] = React.useState('');
  const [verified, setVerified] = React.useState(false);
  const [retireIds, setRetireIds] = React.useState<string[]>([]);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<ImpactPreview | null>(null);
  const [previewState, setPreviewState] = React.useState<'loading' | 'ready' | 'unavailable'>('loading');
  const navigate = useNavigate();

  // Dry-run impact before anything changes; the inbox shows exactly these campaigns afterwards.
  React.useEffect(() => {
    let cancelled = false;
    setPreviewState('loading');
    getImpactPreview(source.id, retireIds)
      .then(result => {
        if (cancelled) return;
        if (result && result.counts && Array.isArray(result.entries)) { setPreview(result); setPreviewState('ready'); }
        else setPreviewState('unavailable');
      })
      .catch(() => { if (!cancelled) setPreviewState('unavailable'); });
    return () => { cancelled = true; };
  }, [source.id, retireIds]);

  // Other active sources that could be retired
  const activeSources = allSources.filter(s => s.state === 'active' && s.id !== source.id);

  const toggleRetireId = (id: string) => {
    setRetireIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  };

  const handleActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!verified) {
      setError('You must confirm verification of semantic consistency before activating.');
      return;
    }
    if (rationale.trim().length < 10) {
      setError('Audit rationale must be at least 10 characters.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const result = await activateSource(source.id, {
        expected_epoch: brand.source_epoch,
        verified: true,
        retire_source_ids: retireIds,
        rationale: rationale.trim(),
      });
      onSuccess();
      if (result?.change_id && (result.impact_counts?.total || 0) > 0) navigate(`/rechecks/${result.change_id}`);
    } catch (err) {
      if (err instanceof ApiResponseError) {
        if (err.status === 409) {
          setError(`${err.body.message} Another manager may have just published an update; reload to see it.`);
        } else {
          setError(err.body.message || 'Activation failed');
        }
      } else {
        setError('Connection error activating source');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const dialogRef = useSourceDialog(onClose, submitting);
  return (
    <div className="modal-backdrop" ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="activate-source-title">
      <div className="modal-card animate-scale-in">
        <div className="modal-header">
          <h2 id="activate-source-title" style={{ margin: 0, fontSize: '1.25rem' }}>
            Publish guideline update: {source.title}
          </h2>
          <button className="btn btn--ghost btn--sm" onClick={onClose} aria-label="Close dialog" disabled={submitting}>
            ✕
          </button>
        </div>

        <form onSubmit={handleActivate} className="modal-body">
          {error && <Alert kind="error">{error}</Alert>}
          <fieldset disabled={submitting} className="source-dialog-fields">

          <div className="info-box impact-preview" role="status" aria-live="polite">
            {previewState === 'loading' && <Spinner size="sm" label="Checking which campaigns used this guideline…" />}
            {previewState === 'unavailable' && (
              <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                Impact preview unavailable. Campaigns that relied on the replaced version will still be listed in the re-review inbox after publishing.
              </div>
            )}
            {previewState === 'ready' && preview && (
              <>
                <div className="impact-preview__headline">
                  {preview.counts.total === 0
                    ? 'No reviewed campaign used the version this replaces.'
                    : `${preview.counts.total} campaign${preview.counts.total === 1 ? '' : 's'} used this guideline; ${preview.counts.on_hold} approved or in-review campaign${preview.counts.on_hold === 1 ? '' : 's'} will go on hold.`}
                </div>
                <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                  {preview.counts.confirmed} confirmed · {preview.counts.likely} likely · {preview.counts.possible} possible · {preview.counts.not_affected} not affected.
                  {' '}Each affected campaign is rechecked automatically against the new rules.
                </div>
                {preview.entries.length > 0 && (
                  <ul className="impact-preview__list">
                    {preview.entries.slice(0, 8).map(entry => (
                      <li key={entry.item_id}><ImpactBadge level={entry.impact_level} /> {entry.title} <span style={{ color: 'var(--text-secondary)' }}>({entry.state.replace(/_/g, ' ')})</span></li>
                    ))}
                    {preview.entries.length > 8 && <li>…and {preview.entries.length - 8} more</li>}
                  </ul>
                )}
              </>
            )}
          </div>

          {activeSources.length > 0 && (
            <div className="form-group" style={{ marginBottom: 'var(--space-4)' }}>
              <label className="form-label">
                Retire Earlier / Conflicting Sources (optional)
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '120px', overflowY: 'auto' }}>
                {activeSources.map(s => (
                  <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: '0.875rem' }}>
                    <input
                      type="checkbox"
                      checked={retireIds.includes(s.id)}
                      onChange={() => toggleRetireId(s.id)}
                    />
                    <span>{s.title} (v{s.version}, key: {s.source_key})</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="form-group" style={{ marginBottom: 'var(--space-4)' }}>
            <label htmlFor="txt-activate-rationale" className="form-label">
              Reason for this update <span style={{ color: 'var(--color-blocker)' }}>*</span>
            </label>
            <textarea
              id="txt-activate-rationale"
              maxLength={2000}
              minLength={10}
              className="input"
              rows={2}
              value={rationale}
              onChange={e => setRationale(e.target.value)}
              placeholder="e.g. Verified against the approved trial terms."
              required
            />
          </div>

          <div className="form-group" style={{ marginBottom: 'var(--space-6)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={verified}
                onChange={e => setVerified(e.target.checked)}
                style={{ width: '18px', height: '18px', accentColor: 'var(--accent)' }}
              />
              <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                I reviewed this source against the active guidelines and approve its activation.
              </span>
            </label>
          </div>

          <div className="modal-actions">
            <button type="button" className="btn btn--ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary" disabled={submitting || !verified || rationale.trim().length < 10}>
              {submitting ? 'Publishing…' : 'Publish guideline update'}
            </button>
          </div>
          </fieldset>
        </form>
      </div>
    </div>
  );
}
