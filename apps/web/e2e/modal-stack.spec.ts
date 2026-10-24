import { test, expect } from '@playwright/test';
import { FIXTURE_CONTENT_ITEM, FIXTURE_REVIEW_RUN, FIXTURE_SOURCES, FIXTURE_POLICY } from '../src/api/fixtures';

test('Escape dismisses the leave confirmation before the underlying evidence drawer', async ({ page }) => {
  const item = { ...FIXTURE_CONTENT_ITEM, latest_run_id: FIXTURE_REVIEW_RUN.id };
  const run = { ...FIXTURE_REVIEW_RUN, status: 'complete' };
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/me')) return route.fulfill({ json: { membership_id: item.creator_id, role: 'creator' } });
    if (path.endsWith('/content')) return route.fulfill({ json: { items: [item], total: 1, offset: 0, limit: 20 } });
    if (path.endsWith(`/content/${item.id}`)) return route.fulfill({ json: item });
    if (path.endsWith(`/runs/${run.id}`)) return route.fulfill({ json: run });
    if (path.endsWith('/review')) return route.fulfill({ json: { evidence: { effective_checks: run.checks } } });
    if (path.endsWith('/sources')) return route.fulfill({ json: FIXTURE_SOURCES });
    if (path.endsWith('/processing-policy')) return route.fulfill({ json: FIXTURE_POLICY });
    return route.fulfill({ json: [] });
  });
  await page.goto('/');
  await page.getByRole('button', { name: item.title, exact: true }).click();
  await page.getByRole('button', { name: 'Edit draft', exact: true }).click();
  await page.getByLabel('Copy Text', { exact: true }).fill('My unsaved change while inspecting the approved source.');
  await page.getByRole('button', { name: 'Preview draft', exact: true }).click();
  await page.getByRole('button', { name: 'Evidence ↗', exact: true }).first().click();
  const evidence = page.locator('.drawer-overlay');
  await expect(evidence).toBeVisible();
  await page.goBack();
  const leave = page.getByRole('dialog', { name: 'Leave with unsaved changes?' });
  await expect(leave).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(leave).toHaveCount(0);
  await expect(evidence).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close evidence drawer', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(evidence).toHaveCount(0);
  await expect(page.locator('#document-preview-container')).toContainText('My unsaved change while inspecting the approved source.');
  await expect(page).toHaveURL(new RegExp(`/content/${item.id}$`));
});
