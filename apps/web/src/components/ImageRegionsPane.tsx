/**
 * ImageRegionsPane — the analysed image with its confirmed regions (Improvement 2).
 * Clicking a finding outlines its region; selecting a region lists its findings.
 * Reviewers also see the OCR provenance: original reading, corrections and unreadable areas.
 */
import React from 'react';
import { assetUrl } from '../api/client';
import type { FindingOut, ImageInfo, RegionMapEntry } from '../api/types';

const ORIGIN_TEXT: Record<string, string> = {
  ocr: 'Read automatically', corrected: 'Corrected by the creator', added: 'Added by the creator', unreadable: 'Marked unreadable',
};

export function ImageRegionsPane({ image, regionMap, findings, activeRegionIds, onSelectFinding, showProvenance }: {
  image: ImageInfo;
  regionMap: RegionMapEntry[];
  findings: FindingOut[];
  activeRegionIds: string[];
  onSelectFinding: (finding: FindingOut) => void;
  showProvenance: boolean;
}) {
  const [zoom, setZoom] = React.useState(1);
  const [selected, setSelected] = React.useState<string | null>(null);
  const activeRef = React.useRef<HTMLButtonElement | null>(null);
  const byRegion = React.useMemo(() => {
    const map: Record<string, FindingOut[]> = {};
    for (const finding of findings) {
      for (const id of ((finding.location as { regions?: string[] }).regions ?? [])) (map[id] ??= []).push(finding);
    }
    return map;
  }, [findings]);

  React.useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [activeRegionIds]);

  const regionFindings = selected ? byRegion[selected] ?? [] : [];
  const corrected = regionMap.filter(r => r.origin === 'corrected' || r.origin === 'added');
  const unreadable = regionMap.filter(r => r.origin === 'unreadable');

  return (
    <section className="card image-pane" aria-labelledby="image-pane-title">
      <div className="image-pane__head">
        <h2 id="image-pane-title">Image</h2>
        <div className="filter-bar" role="group" aria-label="Zoom">
          {[1, 2, 3].map(level => (
            <button key={level} type="button" className={`filter-btn ${zoom === level ? 'filter-btn--active' : ''}`}
              aria-pressed={zoom === level} onClick={() => setZoom(level)}>{level * 100}%</button>
          ))}
        </div>
      </div>
      <div className="image-pane__viewport">
        <div className="ocr-frame ocr-frame--static" style={{ aspectRatio: `${image.width} / ${image.height}`, width: `${zoom * 100}%` }}>
          <img src={assetUrl(image.asset_id)} alt="Campaign image with highlighted text regions" draggable={false} />
          {regionMap.map((region, index) => {
            const active = activeRegionIds.includes(region.region_id);
            const count = byRegion[region.region_id]?.length ?? 0;
            return (
              <button key={region.region_id} type="button" ref={active ? activeRef : undefined}
                className={`ocr-box ocr-box--${region.origin === 'unreadable' ? 'unreadable' : count ? 'finding' : 'high'}${active ? ' ocr-box--active' : ''}${selected === region.region_id ? ' ocr-box--selected' : ''}`}
                style={{ left: `${region.box.x * 100}%`, top: `${region.box.y * 100}%`, width: `${region.box.w * 100}%`, height: `${region.box.h * 100}%` }}
                aria-label={`Region ${index + 1}: ${region.origin === 'unreadable' ? 'unreadable' : `“${region.final_text}”`}, ${count} finding${count === 1 ? '' : 's'}`}
                aria-pressed={selected === region.region_id}
                onClick={() => setSelected(selected === region.region_id ? null : region.region_id)}>
                {count > 0 && <span aria-hidden="true" className="ocr-box__tag">{count}</span>}
              </button>
            );
          })}
        </div>
      </div>
      <div aria-live="polite">
        {selected && (
          <div className="image-pane__findings">
            <strong>Findings in this region:</strong>
            {regionFindings.length === 0 ? ' none.' : (
              <ul>
                {regionFindings.map(f => (
                  <li key={f.id}><button type="button" className="text-link" onClick={() => onSelectFinding(f)}>{f.rule_id}: {f.rationale}</button></li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      {showProvenance && (
        <details className="image-pane__provenance" open={unreadable.length > 0 || corrected.length > 0}>
          <summary>Text extraction record</summary>
          {unreadable.length > 0 && (
            <p className="image-pane__warning">⚠ {unreadable.length} region{unreadable.length === 1 ? ' was' : 's were'} marked unreadable: check {unreadable.length === 1 ? 'it' : 'them'} by eye before approving.</p>
          )}
          <ul>
            {regionMap.map((region, index) => (
              <li key={region.region_id}>
                {index + 1}. {ORIGIN_TEXT[region.origin]}
                {region.origin === 'corrected' && <> — read as “{region.ocr_text}”, confirmed as “{region.final_text}”</>}
                {region.origin === 'ocr' && <> — “{region.final_text}”</>}
                {region.origin === 'added' && <> — “{region.final_text}”</>}
                {region.confidence !== null && ` (${Math.round(region.confidence * 100)}% confidence)`}
              </li>
            ))}
          </ul>
          <p className="recheck-table__sub">Image SHA-256 <code>{image.sha256.slice(0, 16)}…</code></p>
        </details>
      )}
    </section>
  );
}
