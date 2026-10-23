import React from 'react';
import { Link, NavLink } from 'react-router-dom';
import { BrandMark } from './BrandMark';
import { useAuth } from '../context/AuthContext';
import { Spinner } from './Primitives';
import { PolicySettingsModal } from './PolicySettingsModal';

export function TopNav() {
  const { user, status, signOut } = useAuth();
  const [signingOut, setSigningOut] = React.useState(false);
  const [showPolicyModal, setShowPolicyModal] = React.useState(false);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <>
      <nav className="topnav" aria-label="Main navigation">
        <Link to="/" className="topnav__brand" aria-label="BrandGuard home">
          <BrandMark />
          <span>BrandGuard<span className="wordmark-period">.</span></span>
        </Link>

        <div className="topnav__links">
          <NavLink to="/" end>Campaigns</NavLink>
          <NavLink to="/demo">Guided example <span aria-hidden="true">↗</span></NavLink>
        </div>

        <div className="topnav__actions">
          {status === 'authenticated' && user && (
            <>
              {user.role === 'admin' && (
                <button
                  id="btn-nav-policy"
                  className="btn btn--secondary btn--sm"
                  onClick={() => setShowPolicyModal(true)}
                  style={{ marginRight: 'var(--space-2)' }}
                >
                  Processing policy
                </button>
              )}
              <div className="topnav__user">
                <span className="topnav__avatar" aria-hidden="true">{user.role.slice(0, 1).toUpperCase()}</span>
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

      <PolicySettingsModal
        isOpen={showPolicyModal}
        onClose={() => setShowPolicyModal(false)}
      />
    </>
  );
}
