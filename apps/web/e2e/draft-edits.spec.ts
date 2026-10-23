import { test, expect } from '@playwright/test';
import { workingDraft, stageDraftEdit, projectDraftRange, changeDraftText, undoDraftChange } from '../src/api/draftEdits';

const original = '✨ lumadeks is providing free trial for users for 9000 days , OH MY GOD THIS IS INSANE!!!';
const range = (quote: string) => {
  const points = Array.from(original), needle = Array.from(quote);
  const start = points.findIndex((_, i) => points.slice(i, i + needle.length).join('') === quote);
  return [start, start + needle.length] as const;
};

test('stages every independent fix in any order while preserving Unicode and whitespace', () => {
  const corrections = [ ['lumadeks', 'LumaDesk'], ['9000 days', '14 days'], ['OH MY GOD THIS IS INSANE!!!', 'Explore your next workspace.'] ];
  for (const order of [[0, 1, 2], [2, 0, 1], [1, 2, 0]]) {
    let draft = workingDraft(original);
    for (const i of order) draft = stageDraftEdit(draft, String(i), ...range(corrections[i][0]), corrections[i][1], corrections[i][0]);
    expect(draft.text).toBe('✨ LumaDesk is providing free trial for users for 14 days , Explore your next workspace.');
    expect(draft.changes).toHaveLength(3);
    expect(draft.baseText).toBe(original);
    for (let i = 0; i < 3; i++) draft = undoDraftChange(draft);
    expect(draft.text).toBe(original);
  }
});

test('manual changes elsewhere keep suggestions usable; edited passages and duplicates are rejected', () => {
  let draft = changeDraftText(workingDraft(original), 'A note: ' + original);
  draft = stageDraftEdit(draft, 'term', ...range('lumadeks'), 'LumaDesk');
  draft = changeDraftText(draft, draft.text.replace('9000 days', '10 days'));
  expect(() => stageDraftEdit(draft, 'days', ...range('9000 days'), '14 days')).toThrow(/already edited/);
  expect(() => stageDraftEdit(draft, 'term', ...range('lumadeks'), 'LumaDesk')).toThrow(/already in/);
  draft = stageDraftEdit(draft, 'tone', ...range('OH MY GOD THIS IS INSANE!!!'), 'Try it.');
  expect(draft.text).toBe('A note: ✨ LumaDesk is providing free trial for users for 10 days , Try it.');
});

test('overlapping suggestions never change a different occurrence or silently overwrite edits', () => {
  const text = 'Lumadesk and Lumadesk';
  let draft = stageDraftEdit(workingDraft(text), 'first', 0, 8, 'LumaDesk');
  expect(projectDraftRange(draft, 0, 20)).toBeNull();
  expect(() => stageDraftEdit(draft, 'sentence', 0, 20, 'Replacement')).toThrow(/already edited/);
  draft = stageDraftEdit(draft, 'second', 13, 21, 'LumaDesk', 'Lumadesk');
  expect(draft.text).toBe('LumaDesk and LumaDesk');
  expect(() => stageDraftEdit(workingDraft(text), 'mismatch', 0, 8, 'X', 'Another text')).toThrow(/does not match/);
  for (const [start, end] of [[-1, 3], [0.5, 3], [0, 99], [2, 2]]) expect(projectDraftRange(workingDraft(text), start, end)).toBeNull();
});
