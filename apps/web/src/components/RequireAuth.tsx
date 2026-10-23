/**
 * RequireAuth — route guard.
 * Redirects to /login if unauthenticated.
 * Shows spinner while session is being verified from the server.
 * NEVER checks role client-side — authorisation is always server-enforced.
 */
import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Spinner } from './Primitives';

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();

  if (status === 'loading') {
    return (
      <div
        style={{ display: 'grid', placeItems: 'center', minHeight: '60dvh' }}
        aria-live="polite"
        aria-label="Verifying session…"
      >
        <Spinner size="lg" label="Verifying session…" />
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
