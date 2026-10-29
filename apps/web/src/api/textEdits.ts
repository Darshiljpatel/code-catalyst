/** API locations are Unicode code points, never UTF-16 string offsets. */
export function replaceLocatedText(text: string, analysedText: string, start: unknown, end: unknown, replacement: string): string {
  const points = Array.from(text);
  if (text !== analysedText || typeof start !== 'number' || typeof end !== 'number' ||
      !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > points.length) {
    throw new Error('Reload the analysed revision before applying this suggestion. Your edits are preserved.');
  }
  return points.slice(0, start).join('') + replacement + points.slice(end).join('');
}

const ADVICE = /^\W*(consider|either|rephrase|reword|replace|remove|avoid|ensure|you (should|could|may want to))\b|\bsuch as ['"‘“]|\bthe claim\b|\brephras/i;

/** True when a suggestion is drop-in copy for the flagged span, not reviewer advice about it. */
export function isReplacementText(suggestion: string | null | undefined): suggestion is string {
  return !!suggestion && !ADVICE.test(suggestion);
}
