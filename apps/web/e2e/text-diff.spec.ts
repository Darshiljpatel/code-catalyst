import { test, expect } from '@playwright/test';
import { computeTextDiff, diffWordCounts } from '../src/api/textDiff';
import { FIXTURE_CONTENT_ITEM } from '../src/api/fixtures';

function reconstruct(before: string, after: string) {
  const result = computeTextDiff(before, after);
  expect(result.tokens.filter(t => t.type !== 'added').map(t => t.value).join('')).toBe(before);
  expect(result.tokens.filter(t => t.type !== 'removed').map(t => t.value).join('')).toBe(after);
  return result;
}

test('word comparison preserves exact text across Unicode, repeated words and whitespace', () => {
  for (const [before, after] of [
    ['', ''], ['', 'New text\n  '], ['Old text', ''],
    ['👨‍💻 café draft  ', '👨‍💻 café approved\n'],
    ['one two one two', 'two one two one'], ['same', 'same'],
    ['a\r\nb\tc', 'a\nb  c'],
  ]) reconstruct(before, after);
  expect(diffWordCounts(computeTextDiff('one two three', 'four five').tokens)).toEqual({ additions: 2, deletions: 3 });
  // Reproducible combinations check reconstruction without depending on a tie-breaking algorithm.
  let seed = 98765;
  const pick = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return ['a', 'b', '✨', 'é', ' ', '\n', '\t'][seed % 7]; };
  for (let index = 0; index < 150; index++) {
    reconstruct(Array.from({ length: 20 }, pick).join(''), Array.from({ length: 20 }, pick).join(''));
  }
});

test('large rewrites have bounded comparison and small edits retain detailed results', () => {
  const before = Array.from({ length: 10000 }, (_, i) => `old${i}`).join(' ');
  const after = Array.from({ length: 10000 }, (_, i) => `new${i}`).join(' ');
  const large = reconstruct(before, after);
  expect(large.detail).toBe('passage');
  expect(large.tokens).toHaveLength(2);
  const near = reconstruct(before + ' old-end', before + ' new-end');
  expect(near.detail).toBe('word');
  expect(near.tokens.length).toBeLessThan(6);
  expect(diffWordCounts(near.tokens)).toEqual({ additions: 1, deletions: 1 });
});

test('large revision UI stays usable and discloses passage comparison', async ({ page }) => {
  const original = Array.from({ length: 1500 }, (_, i) => `original${i}`).join(' ');
  const changed = Array.from({ length: 1500 }, (_, i) => `changed${i}`).join(' ');
  const first = { ...FIXTURE_CONTENT_ITEM.revisions[0], text: original };
  const item = { ...FIXTURE_CONTENT_ITEM, current_revision: 2, revisions: [first, { ...first, id: 'second', number: 2, text: changed }] };
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/me')) return route.fulfill({ json: { membership_id: item.creator_id, role: 'creator' } });
    if (path.endsWith(`/content/${item.id}`)) return route.fulfill({ json: item });
    if (path.endsWith('/processing-policy')) return route.fulfill({ json: { enabled: false, version: 0 } });
    return route.fulfill({ json: [] });
  });
  await page.goto(`/content/${item.id}`);
  await page.getByRole('button', { name: /Compare Revisions/ }).click();
  const viewer = page.locator('.diff-viewer');
  await expect(viewer.getByRole('status')).toContainText('Large rewrite');
  await expect(viewer.locator('del')).toHaveText(original);
  await expect(viewer.locator('ins')).toHaveText(changed);
  await viewer.getByRole('button', { name: 'Side-by-side', exact: true }).click();
  await expect(viewer.locator('del')).toHaveCount(0);
  await expect(viewer).toContainText(original);
  await expect(viewer).toContainText(changed);
});
