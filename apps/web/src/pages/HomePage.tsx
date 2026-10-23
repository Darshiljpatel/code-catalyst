/**
 * HomePage — entry point after login.
 *
 * Shows:
 * - "Review a campaign" CTA
 * - "Try the fictional LumaDesk example" CTA  (IMPLEMENTATION_PLAN.md §6)
 * - Brand list for the authenticated org
 * - Processing-mode disclosure (MODEL_PLAN.md + CONTRACTS.md)
 *
 * Brands are fetched from the real API; no mock data is rendered
 * in the deployed build.
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { getBrands } from '../api/client';
import type { Brand } from '../api/types';
import { useAuth } from '../context/AuthContext';
import { Skeleton, EmptyState, Alert, ProcessingMode } from '../components/Primitives';
import { ReviewQueue } from '../components/ReviewQueue';

export function HomePage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [brands, setBrands] = React.useState<Brand[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setLoading(true);
    getBrands()
      .then(setBrands)
      .catch(() => setError('Unable to load brands. Check your connection.'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="home-page" id="main-content">
      {/* Processing-mode disclosure — always visible before any analysis */}
      <div className="disclosure-banner" role="note" aria-label="Processing disclosure">
        <ProcessingMode isExternal={false} />
        <span>
          Local deterministic processing only. Semantic checks are unavailable until
          an external provider policy is enabled by an admin.
        </span>
      </div>

      {/* Hero */}
      <section className="home-hero animate-fade-in-up" aria-labelledby="home-headline">
        <div className="home-hero__eyebrow" aria-hidden="true">
          ✦ Brand compliance review
        </div>
        <h1 id="home-headline" className="home-hero__title">
          Review content against approved brand standards
        </h1>
        <p className="home-hero__desc">
          Source-linked findings, human control of every revision, and an exact
          approved record — built for Round 2 of CODE CATALYST.
        </p>

        <div className="home-hero__actions">
          {/* D2+ gate: POST /content not yet available — placeholder, wired in D2 */}
          <button
            id="btn-new-review"
            className="btn btn--primary btn--lg"
            onClick={() => navigate('/review/new')}
            aria-label="Start a new brand review"
          >
            ＋ Review a campaign
          </button>

          {/* LumaDesk synthetic demo CTA */}
          <button
            id="btn-lumadesk-demo"
            className="btn btn--ghost btn--lg"
            onClick={() => navigate('/demo')}
            aria-label="Try the fictional LumaDesk example"
          >
            Try the LumaDesk example
          </button>
        </div>
      </section>

      {/* Brand list */}
      <section className="home-brands" aria-labelledby="brands-heading">
        <div className="home-brands__header">
          <h2 id="brands-heading">Your brands</h2>
          {user?.role === 'manager' && (
            <button
              id="btn-new-brand"
              className="btn btn--ghost btn--sm"
              onClick={() => navigate('/brands/new')}
            >
              + New brand
            </button>
          )}
        </div>

        {error && <Alert kind="error">{error}</Alert>}

        {loading ? (
          <div className="brands-grid" aria-busy="true" aria-label="Loading brands…">
            {[1, 2, 3].map(i => (
              <div key={i} className="card brand-card" style={{ gap: 'var(--space-3)', display: 'flex', flexDirection: 'column' }}>
                <Skeleton height={22} width="60%" />
                <Skeleton height={14} width="40%" />
              </div>
            ))}
          </div>
        ) : brands.length === 0 ? (
          <EmptyState
            icon="📋"
            title="No brands yet"
            description="A manager can create the first brand for this workspace."
          />
        ) : (
          <ul className="brands-grid" role="list">
            {brands.map(brand => (
              <li key={brand.id} style={{ listStyle: 'none' }}>
                <button
                  id={`btn-brand-${brand.id}`}
                  className="card brand-card"
                  style={{ width: '100%', textAlign: 'left', background: 'var(--glass-bg)', cursor: 'pointer' }}
                  onClick={() => navigate(`/brands/${brand.id}`)}
                  aria-label={`Open brand ${brand.name}`}
                >
                  <div className="brand-card__name">{brand.name}</div>
                  <div className="brand-card__epoch">Source epoch {brand.source_epoch}</div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Review Workflow Queue */}
      <section aria-labelledby="queue-heading">
        <ReviewQueue />
      </section>
    </div>
  );
}
