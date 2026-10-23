import React from 'react';

interface DiffViewerProps {
  originalText: string;
  modifiedText: string;
  originalLabel?: string;
  modifiedLabel?: string;
}

interface DiffToken {
  type: 'added' | 'removed' | 'unchanged';
  value: string;
}

// Simple word-level LCS diff algorithm
function computeWordDiff(text1: string, text2: string): DiffToken[] {
  const words1 = text1.split(/(\s+)/);
  const words2 = text2.split(/(\s+)/);

  const n = words1.length;
  const m = words2.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      if (words1[i] === words2[j]) {
        dp[i + 1][j + 1] = dp[i][j] + 1;
      } else {
        dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const result: DiffToken[] = [];
  let i = n;
  let j = m;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && words1[i - 1] === words2[j - 1]) {
      result.unshift({ type: 'unchanged', value: words1[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: 'added', value: words2[j - 1] });
      j--;
    } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
      result.unshift({ type: 'removed', value: words1[i - 1] });
      i--;
    }
  }

  return result;
}

export function DiffViewer({
  originalText,
  modifiedText,
  originalLabel = 'Original Version',
  modifiedLabel = 'Modified Version',
}: DiffViewerProps) {
  const [mode, setMode] = React.useState<'inline' | 'sideBySide'>('inline');

  const diffTokens = React.useMemo(
    () => computeWordDiff(originalText, modifiedText),
    [originalText, modifiedText]
  );

  const stats = React.useMemo(() => {
    let additions = 0;
    let deletions = 0;
    diffTokens.forEach(t => {
      if (t.type === 'added' && t.value.trim()) additions++;
      if (t.type === 'removed' && t.value.trim()) deletions++;
    });
    return { additions, deletions };
  }, [diffTokens]);

  return (
    <div className="diff-viewer card" style={{ padding: 'var(--space-5)' }}>
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
