import React from 'react';
import { decodeDraftFile, validateDraftFile } from '../api/importDraft';
import { Alert } from './Primitives';

export function ImportDraft({ onImported, disabled = false }: { onImported: (text: string) => void; disabled?: boolean }) {
  const id = React.useId();
  const input = React.useRef<HTMLInputElement>(null);
  const request = React.useRef(0);
  const [pending, setPending] = React.useState<{ name: string; text: string } | null>(null);
  const [reading, setReading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [notice, setNotice] = React.useState('');
  React.useEffect(() => () => { request.current++; }, []);
  const clear = () => {
    request.current++; setPending(null); setReading(false);
    if (input.current) input.current.value = '';
  };
  return <fieldset className="draft-import" disabled={disabled}>
    <legend>Import a text draft</legend>
    <p id={`${id}-help`}>UTF-8 .txt or .md, up to 256 KiB and 100,000 characters. Read locally in your browser; Markdown is imported as plain text. Analysis starts only when you submit the campaign.</p>
    <label htmlFor={id}>Choose draft file</label>
    <input id={id} ref={input} type="file" accept=".txt,.md,text/plain,text/markdown" aria-describedby={`${id}-help`} onChange={async e => {
      const file = e.target.files?.[0];
      const generation = ++request.current;
      setPending(null); setError(''); setNotice('');
      if (!file) { setReading(false); return; }
      setReading(true);
      try {
        validateDraftFile(file.name, file.size);
        const text = decodeDraftFile(file.name, new Uint8Array(await file.arrayBuffer()));
        if (request.current === generation) setPending({ name: file.name, text });
      } catch (err) {
        if (request.current === generation) setError(err instanceof Error ? err.message : 'Could not read this file. Try another text draft.');
      } finally {
        if (request.current === generation) setReading(false);
      }
    }} />
    {reading && <p role="status">Reading your text file…</p>}
    {error && <Alert kind="error">{error}</Alert>}
    {notice && <p role="status">{notice}</p>}
    {pending && <div>
      <p>Preview: {pending.name}. Replacing the draft below requires confirmation.</p>
      <label htmlFor={`${id}-preview`}>Imported draft preview</label>
      <textarea id={`${id}-preview`} className="input" value={pending.text} rows={5} readOnly />
      <div className="draft-import__actions">
        <button type="button" className="btn btn--secondary btn--sm" onClick={() => { clear(); setNotice('Import cancelled. Your current draft is unchanged.'); }}>Cancel import</button>
        <button type="button" className="btn btn--primary btn--sm" onClick={() => { onImported(pending.text); setNotice(`Imported ${pending.name}. Review the draft before submitting.`); clear(); }}>Replace draft with imported text</button>
      </div>
    </div>}
  </fieldset>;
}
