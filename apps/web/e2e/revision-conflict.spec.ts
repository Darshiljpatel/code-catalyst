import { test, expect } from '@playwright/test';
import { FIXTURE_CONTENT_ITEM } from '../src/api/fixtures';

test('revision conflict preserves local edits, supports keyboard recovery and retries a failed save', async ({ page }) => {
  const first = FIXTURE_CONTENT_ITEM.revisions[0];
  const newer = { ...first, id: 'newer-revision', number: 2, text: 'Another saved version.' };
  const localText = '✨ My working draft keeps exact whitespace.  ';
  let saves = 0, latest = false;
  const parents: string[] = [];
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/me')) return route.fulfill({ json: { membership_id: FIXTURE_CONTENT_ITEM.creator_id, role: 'creator' } });
    if (path.endsWith(`/content/${FIXTURE_CONTENT_ITEM.id}`)) return route.fulfill({ json: latest ? { ...FIXTURE_CONTENT_ITEM, current_revision: 2, revisions: [first, newer] } : FIXTURE_CONTENT_ITEM });
    if (path.endsWith('/processing-policy')) return route.fulfill({ json: { enabled: false, version: 0 } });
    if (path.endsWith('/revisions') && route.request().method() === 'POST') {
      saves++;
      const payload = route.request().postDataJSON();
      parents.push(payload.parent_revision_id);
      if (saves === 1) {
        latest = true;
        return route.fulfill({ status: 409, json: { code: 'stale_revision', message: 'A newer revision exists', request_id: 'test', details: {} } });
      }
      await new Promise(resolve => setTimeout(resolve, 600));
      if (saves === 2) return route.fulfill({ status: 503, json: { code: 'unavailable', message: 'Save failed', request_id: 'test', details: {} } });
      return route.fulfill({ status: 201, json: { ...FIXTURE_CONTENT_ITEM, current_revision: 3, revisions: [first, newer, { ...first, ...payload, id: 'local-saved', number: 3 }] } });
    }
    if (path.endsWith('/analysis')) return route.fulfill({ status: 503, json: { code: 'unavailable', message: 'Analysis unavailable', request_id: 'test', details: {} } });
    return route.fulfill({ json: [] });
  });
  await page.goto(`/content/${FIXTURE_CONTENT_ITEM.id}`);
  await page.getByRole('button', { name: 'Edit draft', exact: true }).click();
  await page.getByLabel('Copy Text', { exact: true }).fill(localText);
  await page.getByRole('button', { name: 'Save all & recheck', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'A newer revision was saved' });
  await dialog.getByRole('button', { name: 'Side-by-side', exact: true }).click();
  await expect(dialog).toContainText('Another saved version.');
  await expect(dialog).toContainText('Your edits are preserved');
  await dialog.getByRole('button', { name: 'Save my draft as Rev #3' }).click();
  await expect(dialog.getByRole('button', { name: 'Saving your draft…' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('alert')).toContainText('Failed to save new revision');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  // Closing the comparison must not strand the local draft in a read-only view.
  await expect(page.getByLabel('Copy Text', { exact: true })).toBeEnabled();
  await expect(page.getByLabel('Copy Text', { exact: true })).toHaveValue(localText);
  // The retry uses the newest saved parent and retains the user's exact text.
  await page.getByRole('button', { name: 'Save all & recheck', exact: true }).click();
  await expect(page.locator('#document-preview-container')).toHaveText(localText);
  expect(parents).toEqual([first.id, newer.id, newer.id]);
  expect(saves).toBe(3);
  await expect(page.getByRole('button', { name: 'Rev #2', exact: true })).toBeVisible();
});
