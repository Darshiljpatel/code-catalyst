import React from 'react';
import { decodeDraftFile, validateDraftFile, isDocumentFile, validateDocumentFile } from '../api/importDraft';
import { importDocument, ApiResponseError } from '../api/client';
import type { DocumentImportOut } from '../api/types';
import { Alert } from './Primitives';

/** `onImported` receives the import id when the text came from a server-side PDF/DOCX extraction. */
export function ImportDraft({ onImported, onScannedPdf, disabled = false }: {
  onImported: (text: string, documentImportId: string | null) => void;
  /** Offered when a PDF has no text layer: check the scanned page as an image campaign instead. */
  onScannedPdf?: (file: File) => void;
  disabled?: boolean;
}) {
  const id = React.useId();
  const input = React.useRef<HTMLInputElement>(null);
  const request = React.useRef(0);
  const [pending, setPending] = React.useState<{ name: string; text: string; document?: DocumentImportOut } | null>(null);
  const [reading, setReading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const [scanned, setScanned] = React.useState<File | null>(null);
  React.useEffect(() => () => { request.current++; }, []);
  const clear = () => {
    request.current++; setPending(null); setReading(false);
    if (input.current) input.current.value = '';
  };
  return <fieldset className="draft-import" disabled={disabled}>
    <legend>Import a draft</legend>
    <p id={`${id}-help`}>UTF-8 .txt or .md (up to 256 KiB, read locally in your browser), or a PDF or Word .docx (up to 10 MB and 50 pages). PDF and Word text is extracted on the server, which keeps the file's fingerprint but not the file. Analysis starts only when you submit the campaign.</p>
    <label htmlFor={id}>Choose draft file</label>
    <input id={id} ref={input} type="file" accept=".txt,.md,.pdf,.docx,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" aria-describedby={`${id}-help`} onChange={async e => {
      const file = e.target.files?.[0];
      const generation = ++request.current;
      setPending(null); setError(''); setNotice(''); setScanned(null);
      if (!file) { setReading(false); return; }
      setReading(true);
      try {
        if (isDocumentFile(file.name)) {
          validateDocumentFile(file.size);
          const document = await importDocument(file);
          if (request.current === generation) setPending({ name: document.filename, text: document.text, document });
          return;
        }
        validateDraftFile(file.name, file.size);
        const text = decodeDraftFile(file.name, new Uint8Array(await file.arrayBuffer()));
        if (request.current === generation) setPending({ name: file.name, text });
      } catch (err) {
        if (request.current === generation) {
          setError(err instanceof Error ? err.message : 'Could not read this file. Try another text draft.');
          if (err instanceof ApiResponseError && err.body.code === 'no_text_layer' && onScannedPdf) setScanned(file);
        }
      } finally {
        if (request.current === generation) setReading(false);
      }
    }} />
    {reading && <p role="status">Reading your file…</p>}
    {error && <Alert kind="error">{error}</Alert>}
    {scanned && onScannedPdf && <button type="button" className="btn btn--secondary btn--sm" onClick={() => { onScannedPdf(scanned); setScanned(null); setError(''); }}>
      Check this scan as an image campaign
    </button>}
    {notice && <p role="status">{notice}</p>}
    {pending && <div>
      <p>Preview: {pending.name}. Replacing the draft below requires confirmation.</p>
      {pending.document && <p className="draft-import__meta">
        {pending.document.pages != null ? `${pending.document.pages} page${pending.document.pages === 1 ? '' : 's'}, ` : ''}
        {pending.document.blocks.length} paragraph{pending.document.blocks.length === 1 ? '' : 's'} found. File fingerprint {pending.document.original_sha256.slice(0, 12)}…
      </p>}
      {pending.document?.warnings.map(warning => <Alert key={warning} kind="warning">{warning}</Alert>)}
      <label htmlFor={`${id}-preview`}>Imported draft preview</label>
      <textarea id={`${id}-preview`} className="input" value={pending.text} rows={5} readOnly />
      <div className="draft-import__actions">
        <button type="button" className="btn btn--secondary btn--sm" onClick={() => { clear(); setNotice('Import cancelled. Your current draft is unchanged.'); }}>Cancel import</button>
        <button type="button" className="btn btn--primary btn--sm" onClick={() => { onImported(pending.text, pending.document?.id ?? null); setNotice(`Imported ${pending.name}. Review the draft before submitting.`); clear(); }}>Replace draft with imported text</button>
      </div>
    </div>}
  </fieldset>;
}
