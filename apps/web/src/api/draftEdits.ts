/** Locations from the API and this change log use Unicode code points. */
export interface DraftChange {
  start: number;
  end: number;
  before: string;
  after: string;
  findingId?: string;
}
export interface WorkingDraft {
  baseText: string;
  text: string;
  changes: DraftChange[];
}

export function workingDraft(text: string): WorkingDraft {
  return { baseText: text, text, changes: [] };
}

/** Move a range from the analysed text through each successive local edit. */
export function projectDraftRange(draft: WorkingDraft, start: unknown, end: unknown): { start: number; end: number } | null {
  if (typeof start !== 'number' || typeof end !== 'number' || !Number.isInteger(start) ||
      !Number.isInteger(end) || start < 0 || end <= start || end > Array.from(draft.baseText).length) return null;
  for (const change of draft.changes) {
    const delta = Array.from(change.after).length - (change.end - change.start);
    if (change.end <= start) {
      start += delta;
      end += delta;
    } else if (change.start < end) {
      // A previous edit touched this quote. Never search for another occurrence.
      return null;
    }
  }
  return { start, end };
}

export function stageDraftEdit(draft: WorkingDraft, findingId: string, start: unknown, end: unknown, replacement: string, quote?: string): WorkingDraft {
  if (draft.changes.some(change => change.findingId === findingId)) throw new Error('This fix is already in your draft.');
  const range = projectDraftRange(draft, start, end);
  if (!range) throw new Error('This passage was already edited. Recheck your draft to get a fresh suggestion.');
  if (quote !== undefined && Array.from(draft.baseText).slice(start as number, end as number).join('') !== quote) {
    throw new Error('This suggestion does not match the analysed passage. Recheck your draft.');
  }
  const points = Array.from(draft.text);
  const before = points.slice(range.start, range.end).join('');
  if (before === replacement) return draft;
  return {
    ...draft,
    text: points.slice(0, range.start).join('') + replacement + points.slice(range.end).join(''),
    changes: [...draft.changes, { ...range, before, after: replacement, findingId }],
  };
}

/** Record manual typing too, so suggestions elsewhere retain their locations. */
export function changeDraftText(draft: WorkingDraft, text: string): WorkingDraft {
  if (text === draft.text) return draft;
  if (text === draft.baseText) return workingDraft(text);
  const before = Array.from(draft.text), after = Array.from(text);
  let start = 0, suffix = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  while (suffix < before.length - start && suffix < after.length - start && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
  const end = before.length - suffix;
  return { ...draft, text, changes: [...draft.changes, {
    start, end, before: before.slice(start, end).join(''), after: after.slice(start, after.length - suffix).join(''),
  }] };
}

export function undoDraftChange(draft: WorkingDraft): WorkingDraft {
  const change = draft.changes[draft.changes.length - 1];
  if (!change) return draft;
  const points = Array.from(draft.text);
  return {
    ...draft,
    text: points.slice(0, change.start).join('') + change.before + points.slice(change.start + Array.from(change.after).length).join(''),
    changes: draft.changes.slice(0, -1),
  };
}
