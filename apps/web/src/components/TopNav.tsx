import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Spinner } from './Primitives';

export function TopNav() {
  const { user, status, signOut } = useAuth();
  const [signingOut, setSigningOut] = React.useState(false);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <nav className="topnav" aria-label="Main navigation">
      <Link to="/" className="topnav__brand" aria-label="BrandGuard home">
        <span className="topnav__logo" aria-hidden="true">BG</span>
        BrandGuard
      </Link>

      <div className="topnav__actions">
        {status === 'authenticated' && user && (
          <>
            <div className="topnav__user">
              <span>{user.user_id.slice(0, 8)}…</span>
              <span className="topnav__role-badge">{user.role}</span>
            </div>
            <button
              id="btn-sign-out"
              className="btn btn--ghost btn--sm"
              onClick={handleSignOut}
              disabled={signingOut}
              aria-busy={signingOut}
            >
              {signingOut ? <Spinner size="sm" label="Signing out…" /> : 'Sign out'}
            </button>
          </>
        )}
      </div>
    </nav>
  );
}
