/** Mirrors the content/revision limits in the published API contract. Never truncates copy. */
export const DRAFT_LIMITS = { title: 200, text: 100000, channel: 100, audience: 300, purpose: 500 } as const;
export type DraftField = keyof typeof DRAFT_LIMITS;
const labels: Record<DraftField, string> = { title: 'Campaign title', text: 'Campaign copy', channel: 'Channel', audience: 'Audience', purpose: 'Purpose' };
type DraftValues = { text: string; channel: string; audience: string; purpose: string; title?: string };

export function draftFieldLength(field: DraftField, value: string): number {
  // These are exactly the values sent to the API; campaign text retains its whitespace.
  return Array.from(field === 'text' ? value : value.trim()).length;
}

export function draftFieldIssue(field: DraftField, value: string): string | null {
  if (!value.trim()) return `${labels[field]} is required.`;
  const count = draftFieldLength(field, value);
  return count > DRAFT_LIMITS[field]
    ? `${labels[field]} exceeds its ${DRAFT_LIMITS[field].toLocaleString('en-US')}-character limit by ${(count - DRAFT_LIMITS[field]).toLocaleString('en-US')}. Shorten it before saving.`
    : null;
}

export function validateDraft(values: DraftValues): string[] {
  return (Object.keys(DRAFT_LIMITS) as DraftField[]).flatMap(field => {
    const issue = values[field] === undefined ? null : draftFieldIssue(field, values[field]);
    return issue ? [issue] : [];
  });
}
