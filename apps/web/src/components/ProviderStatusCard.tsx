import React from 'react';
import { getProviderStatus } from '../api/client';
import type { ProviderStatusOut } from '../api/types';

/** Admin view of the AI provider over the last 24 hours: volume, provider errors and p95 latency. */
export function ProviderStatusCard() {
  const [status, setStatus] = React.useState<ProviderStatusOut | null>(null);
  React.useEffect(() => {
    let alive = true;
    getProviderStatus().then(value => { if (alive) setStatus(value); }).catch(() => undefined);
    return () => { alive = false; };
  }, []);
  if (!status) return null;
  return <section aria-label="AI provider status" className="provider-status" style={{ marginBottom: 'var(--space-4)', fontSize: '0.875rem' }}>
    <h3 style={{ margin: '0 0 var(--space-2)', fontSize: '1rem' }}>AI provider, last 24 hours</h3>
    <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.25rem 1rem', margin: 0 }}>
      <dt>Model</dt><dd style={{ margin: 0 }}>{status.model}</dd>
      <dt>AI checks</dt><dd style={{ margin: 0 }}>{status.runs_24h}</dd>
      <dt>Provider errors</dt><dd style={{ margin: 0 }}>{status.errors_24h}{status.error_rate_24h !== null && ` (${Math.round(status.error_rate_24h * 100)}%)`}</dd>
      <dt>p95 response time</dt><dd style={{ margin: 0 }}>{status.p95_latency_ms_24h !== null ? `${(status.p95_latency_ms_24h / 1000).toFixed(1)} s` : 'No calls yet'}</dd>
      <dt>Last success</dt><dd style={{ margin: 0 }}>{status.last_success_at ? new Date(status.last_success_at).toLocaleString() : 'None in the last 7 days'}</dd>
    </dl>
  </section>;
}
