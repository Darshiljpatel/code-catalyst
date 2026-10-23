import React, { useId } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Alert, Spinner } from '../components/Primitives';

export function LoginPage() {
  const { signIn, status, error, clearError } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = React.useState({ email: '', password: '', org_id: '' });
  const [submitting, setSubmitting] = React.useState(false);
  const errorId = useId();

  // If already authenticated, bounce to home
  React.useEffect(() => {
    if (status === 'authenticated') navigate('/', { replace: true });
  }, [status, navigate]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    clearError();
    setForm(f => ({ ...f, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      await signIn({ email: form.email.trim(), password: form.password, org_id: form.org_id.trim() });
      navigate('/', { replace: true });
    } catch {
      // error is set in AuthContext
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="login-page" id="main-content">
      <div className="login-card animate-fade-in-up" role="region" aria-label="Sign in">
        <div className="login-card__logo" aria-hidden="true">BG</div>
        <h1 className="login-card__title">Sign in to BrandGuard</h1>
        <p className="login-card__subtitle">
          Pre-publication brand review with source-linked findings.
        </p>

        {error && (
          <div style={{ marginBottom: 'var(--space-5)' }}>
            <Alert kind="error" id={errorId}>{error}</Alert>
          </div>
        )}

        <form
          className="login-form"
          onSubmit={handleSubmit}
          aria-describedby={error ? errorId : undefined}
          noValidate
        >
          <div className="field">
            <label className="label label--required" htmlFor="login-email">
              Email
            </label>
            <input
              id="login-email"
              name="email"
              type="email"
              className="input"
              autoComplete="email"
              value={form.email}
              onChange={handleChange}
              required
              placeholder="creator@lumadesk.test"
              aria-required="true"
            />
          </div>

          <div className="field">
            <label className="label label--required" htmlFor="login-password">
              Password
            </label>
            <input
              id="login-password"
              name="password"
              type="password"
              className="input"
              autoComplete="current-password"
              value={form.password}
              onChange={handleChange}
              required
              aria-required="true"
            />
          </div>

          <div className="field">
            <label className="label label--required" htmlFor="login-org-id">
              Workspace ID
            </label>
            <input
              id="login-org-id"
              name="org_id"
              type="text"
              className="input"
              autoComplete="off"
              value={form.org_id}
              onChange={handleChange}
              required
              placeholder="Organisation UUID"
              aria-required="true"
            />
            <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
              For the synthetic demo, use the org ID printed when running{' '}
              <code>python -m brandguard.seed</code>.
            </span>
          </div>

          <button
            id="btn-login-submit"
            type="submit"
            className="btn btn--primary"
            disabled={submitting || !form.email || !form.password || !form.org_id}
            aria-busy={submitting}
          >
            {submitting ? <Spinner size="sm" label="Signing in…" /> : 'Sign in'}
          </button>
        </form>

        <p style={{ marginTop: 'var(--space-6)', fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center' }}>
          Review your workspace processing notice before starting an analysis.
        </p>
      </div>
    </main>
  );
}
