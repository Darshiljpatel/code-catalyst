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
import { Skeleton, EmptyState, Alert } from '../components/Primitives';
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
    <main className="home-page page-container" id="main-content">
      <section className="home-hero animate-fade-in-up" aria-labelledby="home-headline">
        <div>
          <p className="eyebrow"><span className="accent-dash" /> THE CAMPAIGN STUDIO</p>
          <h1 id="home-headline" className="home-hero__title">Good work.<br /><span>Ready for review.</span></h1>
          <p className="home-hero__desc">Every claim checked. Every change yours.<br />Bring your next campaign into focus.</p>
        </div>
        <div className="home-hero__aside">
          <span className="studio-index" aria-hidden="true">[ / ]</span>
          <div className="home-hero__actions">
            <button id="btn-new-review" className="btn btn--primary btn--lg" onClick={() => navigate('/review/new')} aria-label="Start a new brand review">
              Review a campaign <span aria-hidden="true">↗</span>
            </button>
            <button id="btn-lumadesk-demo" className="text-link" onClick={() => navigate('/demo')} aria-label="Try the fictional LumaDesk example">
              Explore the fictional example <span aria-hidden="true">→</span>
            </button>
          </div>
        </div>
      </section>

      <div className="studio-process" aria-label="Review workflow">
        <span><b>01</b> Bring your draft</span><span aria-hidden="true">→</span>
        <span><b>02</b> Follow the evidence</span><span aria-hidden="true">→</span>
        <span><b>03</b> Approve with confidence</span>
      </div>

      <section className="home-campaigns" aria-label="Campaign review queue">
        <ReviewQueue />
      </section>

      {/* Brand list */}
      <section className="home-brands" aria-labelledby="brands-heading">
        <div className="home-brands__header">
          <div><p className="eyebrow">THE SOURCE OF TRUTH</p><h2 id="brands-heading">Your brand library</h2></div>
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
            icon="[ / ]"
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
                  <span className="brand-card__monogram" aria-hidden="true">{brand.name.slice(0, 1)}</span>
                  <span><span className="brand-card__name">{brand.name}</span><span className="brand-card__epoch">Guideline version {brand.source_epoch}</span></span>
                  <span className="brand-card__arrow" aria-hidden="true">↗</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="studio-footer"><span>BUILT FOR THE WORK BEFORE PUBLISH.</span><span>Evidence first. Human approved.</span></footer>
    </main>
  );
}
