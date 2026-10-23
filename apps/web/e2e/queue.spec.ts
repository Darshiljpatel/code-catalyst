import { test, expect } from '@playwright/test';

// Browser transport interception isolates queue interactions; API tests cover SQL
// matching and access control against PostgreSQL separately.
test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/me', route => route.fulfill({ json: { user_id: 'user', org_id: 'org', role: 'creator', membership_id: 'creator' } }));
  await page.route('**/api/v1/brands', route => route.fulfill({ json: [] }));
});
const row = (id: string, title: string, state = 'draft') => ({ id, title, state, brand_id: 'brand', creator_id: 'creator', reviewer_id: null, current_revision: 1, workflow_version: 1, approval_stale: false, created_at: '2026-10-23T00:00:00Z' });

test('queue paginates and searches the server, with useful empty and retry states', async ({ page }) => {
  let fail = false;
  await page.route('**/api/v1/content?*', async route => {
    const query = new URL(route.request().url()).searchParams;
    if (fail) return route.fulfill({ status: 503, json: { code: 'unavailable', message: 'Queue temporarily unavailable', request_id: 'test', details: {} } });
    const search = query.get('q');
    const offset = Number(query.get('offset'));
    const items = search === 'Older campaign' ? [row('old', 'Older campaign')] : search ? [] : offset ? [row('21', 'Campaign 21')] : Array.from({ length: 20 }, (_, n) => row(String(n), `Campaign ${n}`));
    await route.fulfill({ json: { items, total: search ? items.length : 21, offset, limit: 20 } });
  });
  await page.goto('/');
  await expect(page.getByRole('status')).toContainText('of 21 campaigns');
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByRole('button', { name: 'Campaign 21', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next page' })).toBeDisabled();
  const search = page.getByRole('searchbox', { name: 'Filter campaigns by title or ID' });
  await search.fill('Older campaign');
  await expect(page.getByRole('button', { name: 'Older campaign', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Previous page' })).toBeDisabled();
  await search.fill('Missing');
  await expect(page.getByText('No matching campaigns', { exact: true })).toBeVisible();
  await expect(page.getByText('No campaigns exist yet', { exact: false })).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear search' }).click();
  await expect(page.getByRole('status')).toContainText('of 21 campaigns');
  fail = true;
  await page.getByRole('button', { name: 'Refresh campaigns' }).click();
  await expect(page.getByRole('alert')).toContainText('Queue temporarily unavailable');
  await expect(page.locator('.campaign-table')).toHaveCount(0);
  fail = false;
  await page.getByRole('button', { name: 'Retry loading campaigns' }).click();
  await expect(page.locator('.campaign-table')).toBeVisible();
});

test('late filter responses cannot replace the current filter', async ({ page }) => {
  await page.route('**/api/v1/content?*', async route => {
    const state = new URL(route.request().url()).searchParams.get('state');
    if (state === 'in_review') await new Promise(resolve => setTimeout(resolve, 800));
    await route.fulfill({ json: { items: [row(state || 'all', state || 'All item', state || 'draft')], total: 1, offset: 0, limit: 20 } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'In Review', exact: true }).click();
  await page.getByRole('button', { name: 'Approved', exact: true }).click();
  await expect(page.getByRole('button', { name: 'approved', exact: true })).toBeVisible();
  await page.waitForTimeout(1000); // Let the intentionally delayed response arrive.
  await expect(page.getByRole('button', { name: 'approved', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'in_review', exact: true })).toHaveCount(0);
});
