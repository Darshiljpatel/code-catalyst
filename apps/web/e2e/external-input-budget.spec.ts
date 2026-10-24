import { test, expect } from '@playwright/test';
import { FIXTURE_BRAND, FIXTURE_CONTENT_ITEM, FIXTURE_ME_CREATOR, FIXTURE_POLICY, FIXTURE_REVIEW_RUN } from '../src/api/fixtures';

test('intake and saved draft explain actual UTF-8 budget without changing consent', async ({ page }) => {
  let policy: Record<string, unknown> = { ...FIXTURE_POLICY, enabled: true, max_input_bytes: 1024 };
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/me')) return route.fulfill({ json: { ...FIXTURE_ME_CREATOR, membership_id: FIXTURE_CONTENT_ITEM.creator_id } });
    if (path.endsWith('/brands')) return route.fulfill({ json: [FIXTURE_BRAND] });
    if (path.endsWith('/reviewers')) return route.fulfill({ json: [] });
    if (path.endsWith('/processing-policy')) return route.fulfill({ json: policy });
    if (path.endsWith(`/content/${FIXTURE_CONTENT_ITEM.id}`)) return route.fulfill({ json: FIXTURE_CONTENT_ITEM });
    if (path.includes('/runs/')) return route.fulfill({ json: FIXTURE_REVIEW_RUN });
    return route.fulfill({ json: [] });
  });
  await page.goto('/review/new');
  const budget = page.getByTestId('external-input-budget');
  await page.locator('#txt-content-text').fill('😀'.repeat(257));
  await expect(budget).toContainText('1,028 UTF-8 bytes');
  await expect(budget).toContainText('draft alone exceeds the limit');
  await expect(page.locator('#chk-consent')).not.toBeChecked();
  await page.locator('#chk-consent').check();
  await page.locator('#txt-content-text').fill('😀'.repeat(256));
  await expect(budget).toContainText('1,024 UTF-8 bytes');
  await expect(budget).not.toContainText('draft alone exceeds');
  await expect(budget).toContainText('not guaranteed to fit');
  await expect(page.locator('#chk-consent')).toBeChecked();
  await page.goto(`/content/${FIXTURE_CONTENT_ITEM.id}`);
  await expect(budget).toContainText('External request limit: 1,024 bytes');
  policy = { ...policy, enabled: false };
  await page.goto('/review/new');
  await expect(page.locator('#txt-content-text')).toBeVisible();
  await expect(budget).toHaveCount(0);
  policy = { ...FIXTURE_POLICY, enabled: true }; // Older API: do not invent a limit.
  delete policy.max_input_bytes;
  await page.reload();
  await expect(page.locator('#chk-consent')).toBeVisible();
  await expect(budget).toHaveCount(0);
});
