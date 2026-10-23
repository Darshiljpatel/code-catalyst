/** API locations are Unicode code points, never UTF-16 string offsets. */
export function replaceLocatedText(text: string, analysedText: string, start: unknown, end: unknown, replacement: string): string {
  const points = Array.from(text);
  if (text !== analysedText || typeof start !== 'number' || typeof end !== 'number' ||
      !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > points.length) {
    throw new Error('Reload the analysed revision before applying this suggestion. Your edits are preserved.');
  }
  return points.slice(0, start).join('') + replacement + points.slice(end).join('');
}
