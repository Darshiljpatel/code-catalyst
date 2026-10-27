/**
 * ImageTextEditor — "Check extracted text" for image campaigns (Improvement 2).
 *
 * The image with every detected line boxed (coloured and labelled by confidence) beside an
 * editable list. Selecting a box focuses its line and the reverse. Creators correct, delete,
 * draw missed boxes or mark regions unreadable; low-confidence lines must be confirmed.
 */
import React from 'react';
import { ApiResponseError, assetUrl, confirmImageText, getOcr } from '../api/client';
import type { ContentOut, NormBox, OcrOut, RegionOrigin } from '../api/types';
import { Alert, Spinner } from './Primitives';

interface EditableRegion {
  region_id: string;
  box: NormBox;
  text: string;
  origin: RegionOrigin;
  ocr_line_id: string | null;
  ocr_text: string | null;
  confidence: number | null;
  confirmed: boolean;
  deleted: boolean;
}

function confidenceLevel(confidence: number | null, threshold: number, origin: RegionOrigin) {
  if (origin === 'unreadable') return 'unreadable';
  if (origin === 'added') return 'added';
  if (confidence === null) return 'added';
  return confidence < threshold ? 'low' : 'high';
}

const LEVEL_TEXT: Record<string, string> = {
  high: '✓ Clear', low: '⚠ Check this line', unreadable: '⊘ Unreadable', added: '+ Added by you',
};

function initialRegions(content: ContentOut, ocr: OcrOut | null): EditableRegion[] {
  const threshold = ocr?.low_confidence_threshold ?? 0.8;
  const current = content.revisions[content.revisions.length - 1];
  const lines = ocr?.lines ?? [];
  if (current?.region_map?.length) {
    const kept = new Set(current.region_map.map(r => r.region_id));
    return [
      ...current.region_map.map(r => ({
        region_id: r.region_id, box: r.box, text: r.final_text, origin: r.origin,
        ocr_line_id: lines.some(l => l.id === r.region_id) ? r.region_id : null,
        ocr_text: r.ocr_text, confidence: r.confidence, confirmed: true, deleted: false,
      })),
      ...lines.filter(l => !kept.has(l.id)).map(l => ({
        region_id: l.id, box: l.box, text: l.text, origin: 'ocr' as const, ocr_line_id: l.id, ocr_text: l.text,
        confidence: l.confidence, confirmed: l.confidence >= threshold, deleted: true,
      })),
    ];
  }
  return lines.map(l => ({
    region_id: l.id, box: l.box, text: l.text, origin: 'ocr', ocr_line_id: l.id, ocr_text: l.text,
    confidence: l.confidence, confirmed: l.confidence >= threshold, deleted: false,
  }));
}

export function ImageTextEditor({ content, onConfirmed, onCancel }: {
  content: ContentOut; onConfirmed: (next: ContentOut) => void; onCancel?: () => void;
}) {
  const image = content.image!;
  const current = content.revisions[content.revisions.length - 1];
  const [ocr, setOcr] = React.useState<OcrOut | null>(null);
  const [regions, setRegions] = React.useState<EditableRegion[] | null>(null);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [channel, setChannel] = React.useState(current?.channel ?? image.intake.channel);
  const [audience, setAudience] = React.useState(current?.audience ?? image.intake.audience);
  const [purpose, setPurpose] = React.useState(current?.purpose ?? image.intake.purpose);
  const [error, setError] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const frameRef = React.useRef<HTMLDivElement>(null);
  const dragStart = React.useRef<{ x: number; y: number } | null>(null);
  const inputs = React.useRef<Record<string, HTMLInputElement | null>>({});
  const boxes = React.useRef<Record<string, HTMLButtonElement | null>>({});
  const nextId = React.useRef(1);

  React.useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const poll = () => getOcr(image.asset_id).then(result => {
      if (cancelled) return;
      setOcr(result);
      if (result.status === 'queued' || result.status === 'running') timer = window.setTimeout(poll, 2000);
      else setRegions(prev => prev ?? initialRegions(content, result));
    }).catch(() => { if (!cancelled) { setRegions(prev => prev ?? initialRegions(content, null)); } });
    poll();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [image.asset_id, content]);

  const threshold = ocr?.low_confidence_threshold ?? 0.8;
  const visible = (regions ?? []).filter(r => !r.deleted);
  const pending = visible.filter(r => confidenceLevel(r.confidence, threshold, r.origin) === 'low' && !r.confirmed);

  const update = (id: string, patch: Partial<EditableRegion>) =>
    setRegions(prev => (prev ?? []).map(r => (r.region_id === id ? { ...r, ...patch } : r)));

  const focusLine = (id: string) => { setActiveId(id); inputs.current[id]?.focus(); };

  const point = (event: React.PointerEvent) => {
    const rect = frameRef.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)), y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)) };
  };

  const onPointerDown = (event: React.PointerEvent) => {
    if ((event.target as HTMLElement).closest('.ocr-box')) return;
    dragStart.current = point(event);
    setDraft({ ...dragStart.current, w: 0, h: 0 });
    frameRef.current?.setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent) => {
    if (!dragStart.current) return;
    const p = point(event);
    const s = dragStart.current;
    setDraft({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) });
  };
  const onPointerUp = () => {
    const box = draft;
    dragStart.current = null;
    setDraft(null);
    if (!box || box.w < 0.01 || box.h < 0.01) return;
    const id = `added-${nextId.current++}`;
    setRegions(prev => [...(prev ?? []), { region_id: id, box, text: '', origin: 'added', ocr_line_id: null, ocr_text: null,
      confidence: null, confirmed: true, deleted: false }]);
    window.setTimeout(() => focusLine(id), 0);
  };

  const moveFocus = (event: React.KeyboardEvent, index: number) => {
    const ids = visible.map(r => r.region_id);
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') { event.preventDefault(); boxes.current[ids[Math.min(ids.length - 1, index + 1)]]?.focus(); }
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') { event.preventDefault(); boxes.current[ids[Math.max(0, index - 1)]]?.focus(); }
  };

  const confirm = async () => {
    setSaving(true); setError('');
    try {
      const next = await confirmImageText(content.id, {
        parent_revision_id: current?.id ?? null, channel, audience, purpose,
        regions: visible.map(r => ({
          region_id: r.region_id, box: r.box, text: r.origin === 'unreadable' ? '' : r.text.trim(),
          origin: r.origin === 'ocr' && r.text.trim() !== r.ocr_text ? 'corrected' : r.origin,
          ocr_line_id: r.ocr_line_id, confirmed: r.confirmed,
        })),
        deleted_line_ids: (regions ?? []).filter(r => r.deleted && r.ocr_line_id).map(r => r.ocr_line_id!),
      });
      onConfirmed(next);
    } catch (err) {
      setError(err instanceof ApiResponseError ? err.body.message : 'Could not save the confirmed text.');
    } finally {
      setSaving(false);
    }
  };

  if (!ocr && !regions) return <Spinner label="Loading the extracted text…" />;
  const waiting = ocr && (ocr.status === 'queued' || ocr.status === 'running');

  return (
    <section className="ocr-editor card" aria-labelledby="ocr-editor-title">
      <h2 id="ocr-editor-title">Check extracted text</h2>
      <p className="ocr-editor__lede">
        Text was read from your image on our servers; the image is never sent to an AI provider. Fix any mistakes, delete
        false detections, drag on the image to box text that was missed, or mark a region unreadable. Lines under
        {' '}{Math.round(threshold * 100)}% confidence must be confirmed before checking.
      </p>
      <div aria-live="polite" className="ocr-editor__status">
        {waiting && <Spinner size="sm" label="Reading text from the image…" />}
        {ocr?.status === 'failed' && (
          <Alert kind="warning">
            Text could not be read automatically{ocr.error_code === 'ocr_engine_unavailable' ? ' (the text reader is not installed on this server)' : ''}.
            Drag on the image to box each piece of text and type it in.
          </Alert>
        )}
        {ocr?.status === 'complete' && ocr.lines.length === 0 && <Alert kind="info">No text was found. Drag on the image to box any text and type it in.</Alert>}
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      <div className="ocr-editor__layout">
        <div className="ocr-frame" ref={frameRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
          style={{ aspectRatio: `${image.width} / ${image.height}` }}>
          <img src={assetUrl(image.asset_id)} alt={`Uploaded campaign image for ${content.title}`} draggable={false} />
          {visible.map((region, index) => {
            const level = confidenceLevel(region.confidence, threshold, region.origin);
            return (
              <button key={region.region_id} type="button" ref={el => { boxes.current[region.region_id] = el; }}
                className={`ocr-box ocr-box--${level}${activeId === region.region_id ? ' ocr-box--active' : ''}${level === 'low' && !region.confirmed ? ' ocr-box--pending' : ''}`}
                style={{ left: `${region.box.x * 100}%`, top: `${region.box.y * 100}%`, width: `${region.box.w * 100}%`, height: `${region.box.h * 100}%` }}
                aria-label={`Region ${index + 1}: ${region.origin === 'unreadable' ? 'unreadable' : `“${region.text || 'empty'}”`}, ${LEVEL_TEXT[level]}`}
                onClick={() => focusLine(region.region_id)} onFocus={() => setActiveId(region.region_id)}
                onKeyDown={event => { moveFocus(event, index); if (event.key === 'Enter') { event.preventDefault(); focusLine(region.region_id); } }}>
                <span aria-hidden="true" className="ocr-box__tag">{index + 1}</span>
              </button>
            );
          })}
          {draft && <span className="ocr-box ocr-box--drawing" style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%`, width: `${draft.w * 100}%`, height: `${draft.h * 100}%` }} />}
        </div>
        <div className="ocr-lines">
          <div className="ocr-legend" aria-label="Confidence legend">
            <span className="ocr-legend__item ocr-legend__item--high">✓ Clear</span>
            <span className="ocr-legend__item ocr-legend__item--low">⚠ Check</span>
            <span className="ocr-legend__item ocr-legend__item--added">+ Added</span>
            <span className="ocr-legend__item ocr-legend__item--unreadable">⊘ Unreadable</span>
          </div>
          <ol className="ocr-line-list">
            {visible.map((region, index) => {
              const level = confidenceLevel(region.confidence, threshold, region.origin);
              return (
                <li key={region.region_id} className={`ocr-line${activeId === region.region_id ? ' ocr-line--active' : ''}`}>
                  <div className="ocr-line__head">
                    <span className={`ocr-line__level ocr-line__level--${level}`}>{index + 1} · {LEVEL_TEXT[level]}{region.confidence !== null ? ` (${Math.round(region.confidence * 100)}%)` : ''}</span>
                    {region.ocr_text && region.text !== region.ocr_text && region.origin !== 'unreadable' && <span className="ocr-line__was">Read as “{region.ocr_text}”</span>}
                  </div>
                  <input ref={el => { inputs.current[region.region_id] = el; }} className="input input--sm"
                    aria-label={`Text of region ${index + 1}`} value={region.origin === 'unreadable' ? '' : region.text}
                    disabled={region.origin === 'unreadable'} placeholder={region.origin === 'unreadable' ? 'Marked unreadable' : 'Type the text shown'}
                    onFocus={() => setActiveId(region.region_id)}
                    onChange={e => update(region.region_id, { text: e.target.value, confirmed: true })} />
                  <div className="ocr-line__actions">
                    {level === 'low' && !region.confirmed && (
                      <button type="button" className="btn btn--secondary btn--sm" onClick={() => update(region.region_id, { confirmed: true })}>Confirm as read</button>
                    )}
                    <button type="button" className="btn btn--ghost btn--sm" aria-pressed={region.origin === 'unreadable'}
                      onClick={() => update(region.region_id, region.origin === 'unreadable'
                        ? { origin: region.ocr_line_id ? 'ocr' : 'added', text: region.ocr_text ?? '', confirmed: level !== 'low' }
                        : { origin: 'unreadable', confirmed: true })}>
                      {region.origin === 'unreadable' ? 'Readable after all' : 'Mark unreadable'}
                    </button>
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => update(region.region_id, { deleted: true })}
                      aria-label={`Delete region ${index + 1}`}>Delete</button>
                  </div>
                </li>
              );
            })}
          </ol>
          {(regions ?? []).some(r => r.deleted) && (
            <p className="recheck-table__sub">{(regions ?? []).filter(r => r.deleted).length} detection(s) deleted.{' '}
              <button type="button" className="text-link" onClick={() => setRegions(prev => (prev ?? []).map(r => ({ ...r, deleted: false })))}>Restore all</button>
            </p>
          )}
        </div>
      </div>
      <div className="ocr-editor__context">
        <label className="form-label" htmlFor="ocr-channel">Channel</label>
        <input id="ocr-channel" className="input input--sm" value={channel} maxLength={100} onChange={e => setChannel(e.target.value)} />
        <label className="form-label" htmlFor="ocr-audience">Audience</label>
        <input id="ocr-audience" className="input input--sm" value={audience} maxLength={300} onChange={e => setAudience(e.target.value)} />
        <label className="form-label" htmlFor="ocr-purpose">Purpose</label>
        <input id="ocr-purpose" className="input input--sm" value={purpose} maxLength={500} onChange={e => setPurpose(e.target.value)} />
      </div>
      <div className="modal-actions">
        {onCancel && <button type="button" className="btn btn--ghost" onClick={onCancel}>Cancel</button>}
        <button type="button" className="btn btn--primary" onClick={confirm}
          disabled={saving || !!waiting || pending.length > 0 || !visible.some(r => r.origin !== 'unreadable' && r.text.trim()) || !channel.trim() || !audience.trim() || !purpose.trim()}>
          {saving ? 'Saving…' : pending.length > 0 ? `Confirm ${pending.length} highlighted line${pending.length === 1 ? '' : 's'} first` : 'Confirm text'}
        </button>
      </div>
    </section>
  );
}
