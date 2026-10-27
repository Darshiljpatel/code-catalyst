import React, { useId } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Alert, Spinner } from '../components/Primitives';
import { BrandMark } from '../components/BrandMark';
import { ReviewSample } from '../components/ReviewSample';

export function LoginPage() {
  const { signIn, status, error, clearError, startDemo } = useAuth();
  const [demoState, setDemoState] = React.useState<'idle' | 'creating' | 'failed'>('idle');
  const [demoError, setDemoError] = React.useState('');

  const tryDemo = async () => {
    setDemoState('creating');
    setDemoError('');
    try {
      await startDemo('creator');
      navigate('/', { replace: true });
    } catch (err) {
      setDemoState('failed');
      setDemoError(err instanceof Error ? err.message : 'The demo workspace could not be created.');
    }
  };
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
      <div className="login-wordmark"><BrandMark /><span>BrandGuard<span className="wordmark-period">.</span></span></div>
      <section className="login-panel" aria-labelledby="signin-heading">
        <div className="login-card animate-fade-in-up">
          <span className="eyebrow">YOUR REVIEW STUDIO</span>
          <h2 id="signin-heading" className="login-card__title">Welcome back<span className="wordmark-period">.</span></h2>
          <p className="login-card__subtitle">
            Your next great campaign starts here.<br />Sign in to your workspace to continue.
          </p>

          <div className="demo-cta">
            <button id="btn-try-demo" type="button" className="btn btn--primary btn--lg" onClick={() => { void tryDemo(); }}
              disabled={demoState === 'creating'} aria-busy={demoState === 'creating'}>
              {demoState === 'creating' ? <Spinner size="sm" label="Preparing your private demo…" /> : <>Try a private demo <span aria-hidden="true">→</span></>}
            </button>
            <p className="demo-cta__hint">
              Your own workspace with sample campaigns and five roles (creator, reviewer, manager, brand lead, admin). Switch roles from
              the top bar. No sign-up; it is deleted after 48 hours.
            </p>
            {demoError && <Alert kind="error">{demoError}</Alert>}
            <div className="demo-cta__divider" role="separator"><span>or sign in</span></div>
          </div>

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
                placeholder="you@company.com"
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
                placeholder="Your workspace ID"
                aria-required="true"
              />
              <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                Use the workspace ID provided by your administrator.
              </span>
            </div>

            <button
              id="btn-login-submit"
              type="submit"
              className="btn btn--primary"
              disabled={submitting || !form.email || !form.password || !form.org_id}
              aria-busy={submitting}
            >
              {submitting ? <Spinner size="sm" label="Signing in…" /> : <>Sign in <span aria-hidden="true">↗</span></>}
            </button>
          </form>

          <p className="login-notice">
            Review your workspace processing notice before starting an analysis.
          </p>
        </div>
        <div className="login-panel__footer"><span>YOUR VOICE. YOUR STANDARDS.</span><BrandMark /></div>
      </section>
      <section className="login-story" aria-labelledby="login-headline">
        <div className="login-story__intro animate-fade-in-up">
          <p className="eyebrow"><span className="accent-dash" /> GOOD WORK. ON BRAND.</p>
          <h1 id="login-headline">Keep the voice.<br />Lose the <em>risk.</em></h1>
          <p>A sharper eye on every campaign. Check the claim,<br className="desktop-break" /> trace the source, and put your best work forward.</p>
        </div>
        <ReviewSample />
        <div className="login-story__footer"><span>MADE FOR THE WORK BEFORE PUBLISH.</span><span>HUMAN APPROVED ↗</span></div>
      </section>
    </main>
  );
}
