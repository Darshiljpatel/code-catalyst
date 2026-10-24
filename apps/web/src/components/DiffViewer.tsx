import React from 'react';
import { computeTextDiff, diffWordCounts } from '../api/textDiff';

interface DiffViewerProps {
  originalText: string;
  modifiedText: string;
  originalLabel?: string;
  modifiedLabel?: string;
}

export function DiffViewer({
  originalText,
  modifiedText,
  originalLabel = 'Original Version',
  modifiedLabel = 'Modified Version',
}: DiffViewerProps) {
  const [mode, setMode] = React.useState<'inline' | 'sideBySide'>('inline');

  const comparison = React.useMemo(
    () => computeTextDiff(originalText, modifiedText),
    [originalText, modifiedText]
  );

  const diffTokens = comparison.tokens;
  const stats = React.useMemo(() => diffWordCounts(diffTokens), [diffTokens]);

  return (
    <div className="diff-viewer card" style={{ padding: 'var(--space-5)' }}>
      {comparison.detail === 'passage' && <p role="status">Large rewrite: changes are grouped into passages to keep comparison responsive. Both complete versions are available side by side.</p>}
      {/* Header & Mode Switcher */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <span style={{ fontWeight: 600, fontSize: '0.9375rem' }}>Revision Diff</span>
          <span style={{ fontSize: '0.8125rem', color: 'var(--color-success)', fontWeight: 600 }}>
            +{stats.additions} added
          </span>
          <span style={{ fontSize: '0.8125rem', color: 'var(--color-blocker)', fontWeight: 600 }}>
            -{stats.deletions} removed
          </span>
        </div>

        <div className="filter-bar">
          <button
            className={`filter-btn ${mode === 'inline' ? 'filter-btn--active' : ''}`}
            onClick={() => setMode('inline')}
          >
            Unified Inline
          </button>
          <button
            className={`filter-btn ${mode === 'sideBySide' ? 'filter-btn--active' : ''}`}
            onClick={() => setMode('sideBySide')}
          >
            Side-by-side
          </button>
        </div>
      </div>

      {mode === 'inline' ? (
        <div
          className="diff-content diff-content--inline"
          style={{
            background: 'var(--bg-base)',
            padding: 'var(--space-4)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-subtle)',
            fontSize: '0.9rem',
            lineHeight: 1.7,
            whiteSpace: 'pre-wrap',
            fontFamily: 'inherit',
          }}
        >
          {diffTokens.map((token, idx) => {
            if (token.type === 'added') {
              return (
                <ins
                  key={idx}
                  style={{
                    background: 'hsla(142, 70%, 45%, 0.25)',
                    color: 'var(--color-success)',
                    textDecoration: 'none',
                    borderRadius: '2px',
                    padding: '1px 2px',
                  }}
                >
                  {token.value}
                </ins>
              );
            }
            if (token.type === 'removed') {
              return (
                <del
                  key={idx}
                  style={{
                    background: 'hsla(0, 84%, 60%, 0.25)',
                    color: 'var(--color-blocker)',
                    borderRadius: '2px',
                    padding: '1px 2px',
                  }}
                >
                  {token.value}
                </del>
              );
            }
            return <span key={idx}>{token.value}</span>;
          })}
        </div>
      ) : (
        <div
          className="diff-content diff-content--split"
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 'var(--space-3)',
          }}
        >
          <div style={{ background: 'var(--bg-base)', padding: 'var(--space-4)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 'var(--space-2)' }}>
              {originalLabel}
            </div>
            <div style={{ whiteSpace: 'pre-wrap', fontSize: '0.875rem', lineHeight: 1.6 }}>
              {originalText}
            </div>
          </div>

          <div style={{ background: 'var(--bg-base)', padding: 'var(--space-4)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 'var(--space-2)' }}>
              {modifiedLabel}
            </div>
            <div style={{ whiteSpace: 'pre-wrap', fontSize: '0.875rem', lineHeight: 1.6 }}>
              {modifiedText}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
