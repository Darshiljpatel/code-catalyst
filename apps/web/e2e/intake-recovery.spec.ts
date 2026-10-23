import { test, expect } from '@playwright/test';
import { FIXTURE_BRAND, FIXTURE_CONTENT_ITEM, FIXTURE_ME_CREATOR, FIXTURE_REVIEW_RUN } from '../src/api/fixtures';

test('saved campaign survives analysis-start failure and retries without duplicate creation', async ({ page }) => {
  let creates = 0, starts = 0;
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/me')) return route.fulfill({ json: { ...FIXTURE_ME_CREATOR, membership_id: FIXTURE_CONTENT_ITEM.creator_id } });
    if (path.endsWith('/brands')) return route.fulfill({ json: [FIXTURE_BRAND] });
    if (path.endsWith('/reviewers')) return route.fulfill({ json: [] });
    if (path.endsWith('/processing-policy')) return route.fulfill({ json: { enabled: false, version: 0 } });
    if (path.endsWith('/content') && route.request().method() === 'POST') {
      creates++;
      return route.fulfill({ status: 201, json: FIXTURE_CONTENT_ITEM });
    }
    if (path.endsWith(`/content/${FIXTURE_CONTENT_ITEM.id}`)) return route.fulfill({ json: FIXTURE_CONTENT_ITEM });
    if (path.endsWith('/analysis')) {
      starts++;
      if (starts === 1) return route.fulfill({ status: 503, json: { code: 'unavailable', message: 'Worker queue unavailable', details: {}, request_id: 'test' } });
      return route.fulfill({ status: 202, json: { ...FIXTURE_REVIEW_RUN, status: 'complete' } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto('/review/new');
  await page.locator('#txt-title').fill('Saved despite queue failure');
  await page.locator('#txt-content-text').fill('LumaDesk offers a 14-day free trial.');
  await page.locator('#btn-submit-review').click();
  await expect(page).toHaveURL(new RegExp(`/content/${FIXTURE_CONTENT_ITEM.id}$`));
  await expect(page.locator('.draft-notice')).toContainText('Your campaign is saved, but analysis could not start');
  expect(creates).toBe(1);
  await page.getByRole('button', { name: 'Run Compliance Check' }).click();
  await expect.poll(() => starts).toBe(2);
  expect(creates).toBe(1);
  await expect(page.locator('.finding-card').first()).toBeVisible();
  await expect(page.getByText('Your campaign is saved, but analysis could not start', { exact: false })).toHaveCount(0);
});
