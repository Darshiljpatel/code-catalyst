import React from 'react';
import { createManualCheck } from '../api/client';
import type { RunOut, ManualCheckInput } from '../api/types';
import { Alert } from './Primitives';
import { categoryLabel } from './categoryLabel';

export function ManualChecks({ run, version, onSaved }: { run: RunOut; version: number; onSaved: () => void }) {
  return <RunManualChecks key={run.id} run={run} version={version} onSaved={onSaved} />;
}

function RunManualChecks({ run, version, onSaved }: { run: RunOut; version: number; onSaved: () => void }) {
  const [selectedCategory, setCategory] = React.useState<ManualCheckInput['category'] | null>(null);
  const [outcome, setOutcome] = React.useState<ManualCheckInput['outcome']>('complete');
  const [rationale, setRationale] = React.useState('');
  const [sourceIds, setSourceIds] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const incomplete = run.checks.filter(c => !['complete', 'not_applicable'].includes(c.status));
  const category = incomplete.find(c => c.category === selectedCategory)?.category || incomplete[0]?.category;
  const relevantSources = run.source_snapshot.filter(s => s.rules.some(rule => rule.category === category));
  const selectedIds = sourceIds.filter(id => run.source_snapshot.some(s => s.id === id));
  const evidenceValid = outcome === 'not_applicable' ? relevantSources.length === 0
    : selectedIds.length > 0 && (relevantSources.length === 0 || relevantSources.some(s => selectedIds.includes(s.id)));
  if (!category || run.stale || ['queued', 'running'].includes(run.status)) return null;
  return <section className="card manual-check-card" style={{ padding: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
    <h3>Manual category review</h3>
    <p>{incomplete.length} {incomplete.length === 1 ? 'category remains' : 'categories remain'}. Inspect the exact revision and approved sources, then record each check separately.</p>
    {error && <Alert kind="error">{error}</Alert>}
    <form onSubmit={async e => {
      e.preventDefault();
      if (busy || rationale.trim().length < 20 || !evidenceValid) return;
      setBusy(true); setError('');
      try {
        await createManualCheck(run.id, { expected_item_version: version, category, outcome, rationale: rationale.trim(), source_version_ids: outcome === 'complete' ? selectedIds : [] });
        setRationale(''); onSaved();
      } catch (err) { setError(err instanceof Error ? err.message : 'Could not save manual check.'); }
      finally { setBusy(false); }
    }}>
      <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0 }}>
      <label className="label" htmlFor="manual-category">Category</label>
      <select id="manual-category" className="input" value={category} onChange={e => { setCategory(e.target.value as ManualCheckInput['category']); setSourceIds([]); setRationale(''); setOutcome('complete'); setError(''); }}>
        {incomplete.map(c => <option key={c.category} value={c.category}>{categoryLabel(c.category)}</option>)}
      </select>
      <label className="label" htmlFor="manual-outcome">Outcome</label>
      <select id="manual-outcome" className="input" value={outcome} onChange={e => setOutcome(e.target.value as ManualCheckInput['outcome'])}>
        <option value="complete">Reviewed against approved sources</option>
        <option value="not_applicable" disabled={relevantSources.length > 0}>Not applicable to this revision</option>
      </select>
      <p id="manual-source-guidance">{relevantSources.length ? 'Approved rules apply to this category. Inspect and cite at least one relevant source; “not applicable” is unavailable.' : 'No approved rule covers this category. Inspect the revision before recording “not applicable”, or cite an approved source for a completed manual check.'}</p>
      {relevantSources.map(source => <details key={source.id}>
        <summary>Inspect {source.title} (v{source.version})</summary>
        {source.rules.filter(rule => rule.category === category).map(rule => <blockquote key={rule.id}><strong>{rule.id}</strong>: {rule.evidence_quote}</blockquote>)}
      </details>)}
      <fieldset aria-describedby="manual-source-guidance"><legend>Sources inspected</legend>
        {run.source_snapshot.map(s => <label key={s.id} style={{ display: 'block' }}>
          <input type="checkbox" checked={sourceIds.includes(s.id)} onChange={e => setSourceIds(ids => e.target.checked ? [...ids, s.id] : ids.filter(id => id !== s.id))} disabled={outcome === 'not_applicable'} /> {s.title} (v{s.version}){relevantSources.some(source => source.id === s.id) ? ' — relevant to this category' : ''}
        </label>)}
      </fieldset>
      <label className="label" htmlFor="manual-rationale">Review rationale (at least 20 characters)</label>
      <textarea id="manual-rationale" className="input" value={rationale} onChange={e => setRationale(e.target.value)} maxLength={4000} />
      <small>{rationale.trim().length} / 20 characters minimum</small>
      <button className="btn btn--primary" disabled={busy || rationale.trim().length < 20 || !evidenceValid}>{busy ? 'Recording manual check…' : 'Record manual check'}</button>
      </fieldset>
    </form>
  </section>;
}
