import React from 'react';
import { getRetention, updateRetention } from '../api/client';
import type { RetentionOut } from '../api/types';
import { Alert } from './Primitives';

/** Admin control for how long inactive campaigns are kept before the hourly purge deletes them. */
export function RetentionSettings() {
  const [current, setCurrent] = React.useState<RetentionOut | null>(null);
  const [days, setDays] = React.useState('');
  const [rationale, setRationale] = React.useState('');
  const [error, setError] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    getRetention().then(value => { if (alive) { setCurrent(value); setDays(value.retention_days?.toString() ?? ''); } })
      .catch(() => { if (alive) setError('The retention setting could not be loaded.'); });
    return () => { alive = false; };
  }, []);

  const save = async () => {
    setError(''); setNotice(''); setSaving(true);
    try {
      const value = await updateRetention({ retention_days: days.trim() ? Number(days) : null, rationale: rationale.trim() });
      setCurrent(value); setRationale('');
      setNotice(value.retention_days ? `Campaigns inactive for ${value.retention_days} days will be deleted hourly, with a deletion record kept.` : 'Campaigns are kept until deleted by hand.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The retention setting could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return <fieldset className="retention-settings" style={{ marginTop: 'var(--space-5)', border: 0, padding: 0 }}>
    <legend style={{ fontWeight: 600 }}>Data retention</legend>
    <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
      Delete campaigns with no activity for this many days (30 to 3650). Leave empty to keep them. Each deletion is recorded,
      and restoring a backup re-applies it.{current && current.purged_campaigns > 0 && ` ${current.purged_campaigns} campaign${current.purged_campaigns === 1 ? '' : 's'} deleted so far.`}
    </p>
    <label htmlFor="retention-days" className="form-label">Keep inactive campaigns for (days)</label>
    <input id="retention-days" className="input" type="number" min={30} max={3650} value={days} onChange={e => setDays(e.target.value)} />
    <label htmlFor="retention-rationale" className="form-label" style={{ marginTop: 'var(--space-2)' }}>Reason for the change</label>
    <input id="retention-rationale" className="input" value={rationale} onChange={e => setRationale(e.target.value)} />
    <button type="button" className="btn btn--secondary btn--sm" style={{ marginTop: 'var(--space-2)' }}
      disabled={saving || rationale.trim().length < 10} onClick={() => { void save(); }}>{saving ? 'Saving…' : 'Save retention'}</button>
    {error && <Alert kind="error">{error}</Alert>}
    {notice && <p role="status">{notice}</p>}
  </fieldset>;
}
