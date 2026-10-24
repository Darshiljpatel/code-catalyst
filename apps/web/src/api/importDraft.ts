export const MAX_DRAFT_FILE_BYTES = 256 * 1024;

export function validateDraftFile(name: string, size: number) {
  if (!/\.(txt|md)$/i.test(name)) throw new Error('Choose a UTF-8 .txt or .md file. Other document formats are not supported here.');
  if (size > MAX_DRAFT_FILE_BYTES) throw new Error('Choose a file no larger than 256 KiB.');
  if (!size) throw new Error('This file is empty. Choose a file containing campaign copy.');
}

export function decodeDraftFile(name: string, bytes: Uint8Array): string {
  validateDraftFile(name, bytes.byteLength);
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error('This file is not valid UTF-8. Save it as UTF-8 text and try again.'); }
  const points = Array.from(text);
  if (points.some(char => { const code = char.codePointAt(0)!; return code === 127 || (code < 32 && ![9, 10, 13].includes(code)); })) {
    throw new Error('This file contains binary or unsupported control characters. Choose a plain-text draft.');
  }
  if (!text.trim()) throw new Error('This file contains only whitespace. Choose a file containing campaign copy.');
  if (points.length > 100000) throw new Error('The draft exceeds the 100,000-character content limit. Split it into smaller campaigns.');
  return text;
}
