import React from 'react';
import { draftRules, getRuleDraftingStatus, importDocument } from '../api/client';
import type { RuleDraftOut } from '../api/types';
import { Alert } from './Primitives';

/** Optional AI start for a new guideline source: import a brand book, get quote-checked draft rules to edit. */
export function RuleDraftAssist({ brandId, onDrafted }: { brandId: string; onDrafted: (draft: RuleDraftOut, filename: string) => void }) {
  const [enabled, setEnabled] = React.useState(false);
  const [file, setFile] = React.useState<File | null>(null);
  const [consent, setConsent] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [notice, setNotice] = React.useState('');

  React.useEffect(() => {
    let alive = true;
    getRuleDraftingStatus().then(status => { if (alive) setEnabled(status.enabled); }).catch(() => undefined);
    return () => { alive = false; };
  }, []);
  if (!enabled) return null;

  const run = async () => {
    if (!file) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const imported = await importDocument(file);
      const draft = await draftRules(brandId, imported.id);
      onDrafted(draft, imported.filename);
      setNotice(`${draft.proposals.length} draft rule${draft.proposals.length === 1 ? '' : 's'} added below${draft.rejected.length ? `; ${draft.rejected.length} suggestion${draft.rejected.length === 1 ? ' was' : 's were'} dropped because the quote was not in the brand book or the rule was invalid` : ''}. Check every rule before saving.${draft.warnings.length ? ' ' + draft.warnings.join(' ') : ''}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rules could not be drafted. Write them by hand instead.');
    } finally {
      setBusy(false);
    }
  };

  return <fieldset className="rule-draft-assist" style={{ border: '1px dashed var(--border-subtle, #ccc)', borderRadius: 8, padding: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
    <legend style={{ fontWeight: 600 }}>Start from a brand book (AI draft)</legend>
    <p style={{ fontSize: '0.875rem', margin: '0 0 var(--space-2)' }}>
      Upload a PDF or Word brand book. Its text goes to Nebius, which proposes rules; each one must quote the book exactly.
      Nothing is saved until you save the source, and it still needs activation.
    </p>
    <label htmlFor="brand-book-file" className="form-label">Brand book (PDF or .docx)</label>
    <input id="brand-book-file" type="file" accept=".pdf,.docx" onChange={e => setFile(e.target.files?.[0] ?? null)} />
    <label style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)', fontSize: '0.875rem' }}>
      <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /> I agree to send this brand book’s text to Nebius.
    </label>
    <button type="button" className="btn btn--secondary btn--sm" style={{ marginTop: 'var(--space-2)' }} disabled={!file || !consent || busy}
      onClick={() => { void run(); }}>{busy ? 'Drafting rules…' : 'Draft rules'}</button>
    {error && <Alert kind="error">{error}</Alert>}
    {notice && <p role="status">{notice}</p>}
  </fieldset>;
}
