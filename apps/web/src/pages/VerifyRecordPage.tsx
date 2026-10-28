/**
 * VerifyRecordPage — check a downloaded audit record against what this workspace recorded:
 * the decision exists, the text, evidence and image are unchanged, and whether it is still current.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { verifyApprovalRecord } from '../api/client';
import type { VerificationOut } from '../api/types';
import { Alert } from '../components/Primitives';

export function VerifyRecordPage() {
  const [raw, setRaw] = React.useState('');
  const [result, setResult] = React.useState<VerificationOut | null>(null);
  const [error, setError] = React.useState('');
  const [checking, setChecking] = React.useState(false);

  const verify = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(''); setResult(null);
    let record: unknown;
    try { record = JSON.parse(raw); } catch {
      setError('This is not a BrandGuard audit record. Paste or choose the .json file downloaded from an approved export.');
      return;
    }
    setChecking(true);
    try { setResult(await verifyApprovalRecord(record)); }
    catch (err) { setError(err instanceof Error ? err.message : 'The record could not be checked. Try again.'); }
    finally { setChecking(false); }
  };

  return <main className="page-container" id="main-content">
    <h1>Verify an approval record</h1>
    <p>Check that an exported audit record matches what this workspace approved: the exact text, the evidence and, for image campaigns, the image fingerprint.</p>
    <form onSubmit={e => { void verify(e); }} className="card" style={{ padding: 'var(--space-4)' }}>
      <label htmlFor="record-file" className="form-label">Audit record file (.json)</label>
      <input id="record-file" type="file" accept=".json,application/json" onChange={async e => {
        const file = e.target.files?.[0];
        if (file) setRaw(await file.text());
      }} />
      <label htmlFor="record-json" className="form-label" style={{ marginTop: 'var(--space-3)' }}>Or paste the record</label>
      <textarea id="record-json" className="input" rows={8} value={raw} onChange={e => setRaw(e.target.value)} />
      <button type="submit" className="btn btn--primary" disabled={!raw.trim() || checking} style={{ marginTop: 'var(--space-3)' }}>
        {checking ? 'Checking…' : 'Verify record'}
      </button>
    </form>
    {error && <Alert kind="error">{error}</Alert>}
    {result && <section aria-label="Verification result" className="card" style={{ padding: 'var(--space-4)', marginTop: 'var(--space-4)' }}>
      <Alert kind={result.verified ? (result.still_current ? 'success' : 'warning') : 'error'}>
        {result.verified
          ? result.still_current ? 'Verified: this is the approved text and evidence, and the approval is still current.'
            : 'Authentic, but no longer current: the campaign has a newer revision or a guideline change reopened it.'
          : 'Not verified: this record does not match what the workspace approved.'}
      </Alert>
      <ul>
        {result.checks.map(check => <li key={check.code}>{check.passed ? '✓' : '✗'} {check.message}</li>)}
      </ul>
      {result.content_id && <Link to={`/content/${result.content_id}`}>Open the campaign</Link>}
    </section>}
  </main>;
}
