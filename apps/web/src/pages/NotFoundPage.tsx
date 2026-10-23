/**
 * NotFoundPage — 404 fallback.
 * Accessible, links back home without full-page reload.
 */
import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <main className="page-container" id="main-content" style={{ display: 'grid', placeItems: 'center', minHeight: '70dvh', textAlign: 'center' }}>
      <div>
        <p style={{ fontSize: '4rem', fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '-0.04em' }}>404</p>
        <h1 style={{ marginBottom: 'var(--space-4)' }}>Page not found</h1>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 'var(--space-8)' }}>
          The page you requested doesn't exist or you don't have access to it.
        </p>
        <Link to="/" className="btn btn--primary">Return to home</Link>
      </div>
    </main>
  );
}
