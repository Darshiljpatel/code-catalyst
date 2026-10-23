import React from 'react';
import { createManualCheck } from '../api/client';
import type { RunOut, ManualCheckInput } from '../api/types';
import { Alert } from './Primitives';

export function ManualChecks({ run, version, onSaved }: { run: RunOut; version: number; onSaved: () => void }) {
  const [category, setCategory] = React.useState<ManualCheckInput['category']>('tone');
  const [outcome, setOutcome] = React.useState<ManualCheckInput['outcome']>('complete');
  const [rationale, setRationale] = React.useState('');
  const [sourceIds, setSourceIds] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const incomplete = run.checks.filter(c => !['complete', 'not_applicable'].includes(c.status));
  if (!incomplete.length || ['queued', 'running'].includes(run.status)) return null;
  return <section className="card" style={{ padding: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
    <h3>Manual category review</h3>
    <p>Inspect the exact revision and approved sources for each incomplete category. Record a separate rationale for each check.</p>
    {error && <Alert kind="error">{error}</Alert>}
    <form onSubmit={async e => {
      e.preventDefault(); setBusy(true); setError('');
      try {
        await createManualCheck(run.id, { expected_item_version: version, category, outcome, rationale: rationale.trim(), source_version_ids: sourceIds });
        setRationale(''); onSaved();
      } catch (err) { setError(err instanceof Error ? err.message : 'Could not save manual check.'); }
      finally { setBusy(false); }
    }}>
      <label className="label" htmlFor="manual-category">Category</label>
      <select id="manual-category" className="input" value={category} onChange={e => setCategory(e.target.value as ManualCheckInput['category'])}>
        {run.checks.map(c => <option key={c.category} value={c.category}>{c.category} ({c.status})</option>)}
      </select>
      <label className="label" htmlFor="manual-outcome">Outcome</label>
      <select id="manual-outcome" className="input" value={outcome} onChange={e => setOutcome(e.target.value as ManualCheckInput['outcome'])}>
        <option value="complete">Reviewed against approved sources</option>
        <option value="not_applicable">Not applicable to this revision</option>
      </select>
      <fieldset><legend>Sources inspected</legend>
        {run.source_snapshot.map(s => <label key={s.id} style={{ display: 'block' }}>
          <input type="checkbox" checked={sourceIds.includes(s.id)} onChange={e => setSourceIds(ids => e.target.checked ? [...ids, s.id] : ids.filter(id => id !== s.id))} /> {s.title} (v{s.version})
        </label>)}
      </fieldset>
      <label className="label" htmlFor="manual-rationale">Review rationale (at least 20 characters)</label>
      <textarea id="manual-rationale" className="input" value={rationale} onChange={e => setRationale(e.target.value)} maxLength={4000} />
      <button className="btn btn--primary" disabled={busy || rationale.trim().length < 20 || (outcome === 'complete' && !sourceIds.length)}>Record manual check</button>
    </form>
  </section>;
}
