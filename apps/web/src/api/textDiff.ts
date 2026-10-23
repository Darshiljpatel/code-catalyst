export interface DiffToken { type: 'added' | 'removed' | 'unchanged'; value: string }
export interface TextDiff { tokens: DiffToken[]; detail: 'word' | 'passage' }
const MAX_CELLS = 250_000;

/** Exact reconstruction with bounded LCS work. Long rewrites use passage changes. */
export function computeTextDiff(before: string, after: string): TextDiff {
  if (before === after) return { tokens: before ? [{ type: 'unchanged', value: before }] : [], detail: 'word' };
  const a = before.split(/(\s+)/), b = after.split(/(\s+)/);
  let prefix = 0, suffix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - suffix - 1] === b[b.length - suffix - 1]) suffix++;
  const left = a.slice(prefix, a.length - suffix), right = b.slice(prefix, b.length - suffix);
  const tokens: DiffToken[] = [];
  const push = (type: DiffToken['type'], value: string) => {
    if (!value) return;
    const previous = tokens[tokens.length - 1];
    if (previous?.type === type) previous.value += value;
    else tokens.push({ type, value });
  };
  push('unchanged', a.slice(0, prefix).join(''));
  let detail: TextDiff['detail'] = 'word';
  if (!left.length || !right.length || (left.length + 1) * (right.length + 1) > MAX_CELLS) {
    if (left.length && right.length) detail = 'passage';
    push('removed', left.join(''));
    push('added', right.join(''));
  } else {
    const matrix = Array.from({ length: left.length + 1 }, () => new Uint32Array(right.length + 1));
    for (let i = 0; i < left.length; i++) {
      for (let j = 0; j < right.length; j++) {
        matrix[i + 1][j + 1] = left[i] === right[j] ? matrix[i][j] + 1 : Math.max(matrix[i][j + 1], matrix[i + 1][j]);
      }
    }
    const reversed: DiffToken[] = [];
    let i = left.length, j = right.length;
    while (i || j) {
      if (i && j && left[i - 1] === right[j - 1]) {
        reversed.push({ type: 'unchanged', value: left[--i] }); j--;
      } else if (j && (!i || matrix[i][j - 1] >= matrix[i - 1][j])) {
        reversed.push({ type: 'added', value: right[--j] });
      } else reversed.push({ type: 'removed', value: left[--i] });
    }
    for (const token of reversed.reverse()) push(token.type, token.value);
  }
  push('unchanged', suffix ? a.slice(a.length - suffix).join('') : '');
  return { tokens, detail };
}

export function diffWordCounts(tokens: DiffToken[]) {
  const count = (type: DiffToken['type']) => tokens.filter(token => token.type === type)
    .reduce((total, token) => total + (token.value.trim() ? token.value.trim().split(/\s+/).length : 0), 0);
  return { additions: count('added'), deletions: count('removed') };
}
