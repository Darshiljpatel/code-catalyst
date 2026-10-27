/**
 * App — root component with router.
 *
 * Routing:
 *   /login             — unauthenticated sign-in
 *   /                  — home (authenticated)
 *   /demo              — LumaDesk fictional demo (authenticated)
 *   /brands/:brandId   — brand detail & source management (D2)
 *   /review/new        — content intake / new review (D2)
 *   /content/:contentId — campaign revisions & review workspace (D2/D3)
 *   *                  — 404
 *
 * The mock transport is enabled ONLY when:
 *   - Running in Vite dev mode (import.meta.env.DEV === true)
 *   - AND VITE_USE_MOCK_API=true in .env.local
 * It is never activated in production builds.
 */
import { useLayoutEffect } from 'react';
import { createBrowserRouter, createRoutesFromElements, RouterProvider, Route, Outlet, useLocation } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { UnsavedChangesProvider } from './context/UnsavedChangesContext';
import { RequireAuth } from './components/RequireAuth';
import { TopNav } from './components/TopNav';
import { LoginPage } from './pages/LoginPage';
import { HomePage } from './pages/HomePage';
import { DemoPage } from './pages/DemoPage';
import { BrandDetailPage } from './pages/BrandDetailPage';
import { NewReviewPage } from './pages/NewReviewPage';
import { ContentDetailPage } from './pages/ContentDetailPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { JudgeGuide } from './components/JudgeGuide';
import { ServerStatusBanner, BuildFooter } from './components/ServerStatusBanner';

function ScrollToTop() {
  const { pathname } = useLocation();
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [pathname]);
  return null;
}

function AuthenticatedLayout() {
  return (
    <RequireAuth>
      <TopNav />
      <Outlet />
    </RequireAuth>
  );
}

function RootLayout() {
  return (
    <AuthProvider>
      <UnsavedChangesProvider>
        <ScrollToTop />
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

        <ServerStatusBanner />
        <Outlet />
        <BuildFooter />
        <JudgeGuide />
      </UnsavedChangesProvider>
    </AuthProvider>
  );
}

const router = createBrowserRouter(createRoutesFromElements(
  <Route element={<RootLayout />}>
    <Route path="/login" element={<LoginPage />} />
    <Route element={<AuthenticatedLayout />}>
      <Route path="/" element={<HomePage />} />
      <Route path="/demo" element={<DemoPage />} />
      <Route path="/brands/:brandId" element={<BrandDetailPage />} />
      <Route path="/review/new" element={<NewReviewPage />} />
      <Route path="/content/:contentId" element={<ContentDetailPage />} />
    </Route>
    <Route path="/404" element={<NotFoundPage />} />
    <Route path="*" element={<NotFoundPage />} />
  </Route>
));

export function App() {
  return <RouterProvider router={router} />;
}
