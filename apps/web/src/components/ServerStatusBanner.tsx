import React from 'react';
import { getServerStatus, subscribeServerStatus, setWorkerOffline } from '../api/serverStatus';
import { getReady, getVersion, getWorkerHealth } from '../api/client';
import { useAuth } from '../context/AuthContext';

const WORKER_POLL_MS = 30_000;

/** One banner for a waking backend or a stale worker heartbeat; renders nothing when healthy. */
export function ServerStatusBanner() {
  const status = React.useSyncExternalStore(subscribeServerStatus, getServerStatus);
  const { status: authStatus } = useAuth();

  // Warm-up ping: start waking the backend while the judge reads the sign-in page.
  React.useEffect(() => {
    getReady().catch(() => undefined);
  }, []);

  React.useEffect(() => {
    if (authStatus !== 'authenticated') return;
    let cancelled = false;
    const poll = () => getWorkerHealth()
      .then(health => { if (!cancelled) setWorkerOffline(health?.status === 'offline'); })
      .catch(() => undefined);
    poll();
    const timer = window.setInterval(poll, WORKER_POLL_MS);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [authStatus]);

  if (status.waking) {
    return (
      <div className="server-banner server-banner--waking" role="status" aria-live="polite">
        <span className="server-banner__pulse" aria-hidden="true" />
        Waking up the review server, usually under a minute…
      </div>
    );
  }
  if (status.workerOffline && authStatus === 'authenticated') {
    return (
      <div className="server-banner server-banner--offline" role="alert">
        Review engine offline. New analyses will wait in the queue until it is back; nothing is lost.
      </div>
    );
  }
  return null;
}

/** Deployed commit, so judges can match the running build to the repository. */
export function BuildFooter() {
  const [sha, setSha] = React.useState('');
  React.useEffect(() => {
    getVersion()
      .then(version => { if (typeof version?.commit_sha === 'string') setSha(version.commit_sha); })
      .catch(() => undefined);
  }, []);
  if (!sha) return null;
  return (
    <footer className="build-footer">
      Build <code title={sha}>{sha === 'unknown' ? 'local' : sha.slice(0, 7)}</code>
    </footer>
  );
}
