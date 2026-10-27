import React from 'react';
import { Link, NavLink } from 'react-router-dom';
import { BrandMark } from './BrandMark';
import { useAuth } from '../context/AuthContext';
import { Spinner } from './Primitives';
import { PolicySettingsModal } from './PolicySettingsModal';
import { useLeaveConfirmation } from '../context/UnsavedChangesContext';
import { getGuidelineChanges } from '../api/client';

export function TopNav() {
  const { user, status, signOut } = useAuth();
  const { requestLeave } = useLeaveConfirmation();
  const [signingOut, setSigningOut] = React.useState(false);
  const [signOutError, setSignOutError] = React.useState('');
  const [showPolicyModal, setShowPolicyModal] = React.useState(false);
  const [openRechecks, setOpenRechecks] = React.useState(0);
  const isManager = status === 'authenticated' && user?.role === 'manager';

  React.useEffect(() => {
    if (!isManager) return;
    let cancelled = false;
    const load = () => getGuidelineChanges({ status: 'open' })
      .then(list => {
        if (cancelled || !Array.isArray(list)) return;
        setOpenRechecks(list.reduce((sum, change) => sum + Math.max(0, (change.total || 0) - (change.resolved || 0)), 0));
      })
      .catch(() => undefined);
    load();
    const timer = window.setInterval(load, 30_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [isManager]);

  const handleSignOut = async () => {
    setSigningOut(true);
    setSignOutError('');
    try {
      await signOut();
      return true;
    } catch {
      setSignOutError('Sign-out failed. Your session may still be active. Your edits are preserved; try signing out again.');
      return false;
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
          {isManager && (
            <NavLink to="/rechecks">
              Re-review inbox
              {openRechecks > 0 && <span className="nav-count" aria-label={`${openRechecks} open`}>{openRechecks}</span>}
            </NavLink>
          )}
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
                onClick={() => requestLeave(handleSignOut, 'sign out', '/login')}
                disabled={signingOut}
                aria-busy={signingOut}
              >
                {signingOut ? <Spinner size="sm" label="Signing out…" /> : 'Sign out'}
              </button>
            </>
          )}
        </div>
      </nav>
      {signOutError && <p role="alert" className="alert alert--error">{signOutError}</p>}

      <PolicySettingsModal
        isOpen={showPolicyModal}
        onClose={() => setShowPolicyModal(false)}
      />
    </>
  );
}
