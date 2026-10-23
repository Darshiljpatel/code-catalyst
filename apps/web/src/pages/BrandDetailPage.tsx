import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  getBrand,
  getSources,
  createSource,
  activateSource,
  ApiResponseError,
} from '../api/client';
import type {
  Brand,
  SourceOut,
  RuleInput,
  RuleCategory,
  RuleKind,
} from '../api/types';
import { useAuth } from '../context/AuthContext';
import { Alert, Spinner, EmptyState } from '../components/Primitives';

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
                    Epoch {brand.source_epoch}
                  </span>
                </div>
                <p style={{ color: 'var(--text-secondary)', margin: 'var(--space-2) 0 0' }}>
                  Approved brand guidelines, facts, terminology, and compliance rules.
                </p>
              </div>

              <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
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
}: {
  source: SourceOut;
  isManager: boolean;
  onActivate: () => void;
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
  const [validFrom, setValidFrom] = React.useState(new Date().toISOString().slice(0, 16));
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
    setRules(prev => [
      ...prev,
      {
        id: `R-${prev.length + 1}`,
        category: 'terminology',
        kind: 'terminology',
        key: '',
        value: '',
        evidence_quote: '',
      },
    ]);
  };

  const updateRule = (index: number, updates: Partial<RuleInput>) => {
    setRules(prev => prev.map((r, i) => (i === index ? { ...r, ...updates } : r)));
  };

  const removeRule = (index: number) => {
    setRules(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sourceKey.trim() || !title.trim() || !text.trim()) {
      setError('Key, title, and source text cannot be blank.');
      return;
    }
    if (rules.length === 0) {
      setError('At least one rule must be defined.');
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
        text: text.trim(),
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

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="add-source-title">
      <div className="modal-card modal-card--lg animate-scale-in">
        <div className="modal-header">
          <h2 id="add-source-title" style={{ margin: 0, fontSize: '1.25rem' }}>
            Add Brand Guideline Source Draft
          </h2>
          <button className="btn btn--ghost btn--sm" onClick={onClose} aria-label="Close dialog">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body">
          {error && <Alert kind="error">{error}</Alert>}

          <div className="form-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
            <div className="form-group">
              <label htmlFor="txt-src-key" className="form-label">
                Source Key <span style={{ color: 'var(--color-blocker)' }}>*</span>
              </label>
              <input
                id="txt-src-key"
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
          </div>

          <div style={{ marginTop: 'var(--space-6)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
              <h4 style={{ margin: 0 }}>Structured Rules & Facts ({rules.length})</h4>
              <button type="button" className="btn btn--secondary btn--sm" onClick={addRule}>
                + Add Rule
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {rules.map((rule, idx) => (
                <div key={idx} className="rule-editor-box">
                  <div style={{ display: 'grid', gridTemplateColumns: '80px 140px 130px 1fr auto', gap: 'var(--space-2)', alignItems: 'center' }}>
                    <input
                      type="text"
                      className="input input--sm"
                      placeholder="ID"
                      value={rule.id}
                      onChange={e => updateRule(idx, { id: e.target.value })}
                      required
                    />
                    <select
                      className="input input--sm"
                      value={rule.category}
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
                    >
                      ✕
                    </button>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
                    <input
                      type="text"
                      className="input input--sm"
                      placeholder="Approved value (e.g. 14 days)"
                      value={rule.value}
                      onChange={e => updateRule(idx, { value: e.target.value })}
                      required
                    />
                    <input
                      type="text"
                      className="input input--sm"
                      placeholder="Evidence Quote (must match source text)"
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
  const [rationale, setRationale] = React.useState('Verified against approved trial terms and brand policy.');
  const [verified, setVerified] = React.useState(true);
  const [retireIds, setRetireIds] = React.useState<string[]>([]);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Other active sources that could be retired
  const activeSources = allSources.filter(s => s.state === 'active' && s.id !== source.id);

  const toggleRetireId = (id: string) => {
    setRetireIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  };

  const handleActivate = async (e: React.FormEvent) => {
    e.preventDefault();
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
      await activateSource(source.id, {
        expected_epoch: brand.source_epoch,
        verified: true,
        retire_source_ids: retireIds,
        rationale: rationale.trim(),
      });
      onSuccess();
    } catch (err) {
      if (err instanceof ApiResponseError) {
        if (err.status === 409) {
          setError(`Activation conflict: ${err.body.message}. The brand source epoch has changed.`);
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

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="activate-source-title">
      <div className="modal-card animate-scale-in">
        <div className="modal-header">
          <h2 id="activate-source-title" style={{ margin: 0, fontSize: '1.25rem' }}>
            Activate Guideline Source: {source.title}
          </h2>
          <button className="btn btn--ghost btn--sm" onClick={onClose} aria-label="Close dialog">
            ✕
          </button>
        </div>

        <form onSubmit={handleActivate} className="modal-body">
          {error && <Alert kind="error">{error}</Alert>}

          <div className="info-box" style={{ marginBottom: 'var(--space-4)' }}>
            <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
              Source Epoch Transition: {brand.source_epoch} → {brand.source_epoch + 1}
            </div>
            <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
              Activating an approved source changes the brand's active evidence. Past review runs will be marked stale.
            </div>
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
              Activation Audit Rationale <span style={{ color: 'var(--color-blocker)' }}>*</span>
            </label>
            <textarea
              id="txt-activate-rationale"
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
                I confirm semantic consistency with all active guidelines (verified = true)
              </span>
            </label>
          </div>

          <div className="modal-actions">
            <button type="button" className="btn btn--ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary" disabled={submitting}>
              {submitting ? 'Activating…' : 'Activate & Advance Epoch'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
