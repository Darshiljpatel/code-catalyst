/**
 * App — root component with router.
 *
 * Routing:
 *   /login        — unauthenticated sign-in
 *   /             — home (authenticated)
 *   /demo         — LumaDesk fictional demo (authenticated)
 *   /brands/:id   — brand detail stub (D2)
 *   /review/new   — new review stub (D2)
 *   *             — 404
 *
 * The mock transport is enabled ONLY when:
 *   - Running in Vite dev mode (import.meta.env.DEV === true)
 *   - AND VITE_USE_MOCK_API=true in .env.local
 * It is never activated in production builds.
 */
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { RequireAuth } from './components/RequireAuth';
import { TopNav } from './components/TopNav';
import { LoginPage } from './pages/LoginPage';
import { HomePage } from './pages/HomePage';
import { DemoPage } from './pages/DemoPage';
import { NotFoundPage } from './pages/NotFoundPage';

// D2 stubs — replace with real pages when APIs are available
function BrandDetailStub() {
  return (
    <main className="page-container" id="main-content">
      <p style={{ color: 'var(--text-secondary)' }}>
        Brand detail — coming in D2 (sources, intake, processing mode).
      </p>
    </main>
  );
}

function NewReviewStub() {
  return (
    <main className="page-container" id="main-content">
      <p style={{ color: 'var(--text-secondary)' }}>
        New review — coming in D2 (POST /content).
      </p>
    </main>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        {/* Skip-to-content link for keyboard/screen-reader users */}
        <a
          href="#main-content"
          style={{
            position: 'absolute', top: '-100px', left: 'var(--space-4)',
            padding: 'var(--space-2) var(--space-4)',
            background: 'var(--accent)', color: '#fff',
            borderRadius: 'var(--radius-md)', fontWeight: 600,
            zIndex: 9999,
            transition: 'top 150ms',
          }}
          onFocus={e => { (e.target as HTMLElement).style.top = 'var(--space-4)'; }}
          onBlur={e => { (e.target as HTMLElement).style.top = '-100px'; }}
        >
          Skip to main content
        </a>

        <Routes>
          {/* Public */}
          <Route path="/login" element={<LoginPage />} />

          {/* Authenticated */}
          <Route element={
            <>
              <TopNav />
              <RequireAuth><></></RequireAuth>
            </>
          }>
            {/* Root */}
            <Route path="/" element={
              <RequireAuth><HomePage /></RequireAuth>
            } />
            <Route path="/demo" element={
              <RequireAuth><DemoPage /></RequireAuth>
            } />
            <Route path="/brands/:brandId" element={
              <RequireAuth><BrandDetailStub /></RequireAuth>
            } />
            <Route path="/review/new" element={
              <RequireAuth><NewReviewStub /></RequireAuth>
            } />
          </Route>

          {/* Fallbacks */}
          <Route path="/404" element={<NotFoundPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
