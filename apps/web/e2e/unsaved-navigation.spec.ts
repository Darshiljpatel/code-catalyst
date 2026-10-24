import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { FIXTURE_CONTENT_ITEM, FIXTURE_ME_CREATOR, FIXTURE_POLICY } from '../src/api/fixtures';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/me')) return route.fulfill({ json: { ...FIXTURE_ME_CREATOR, membership_id: FIXTURE_CONTENT_ITEM.creator_id } });
    if (path.endsWith('/processing-policy')) return route.fulfill({ json: FIXTURE_POLICY });
    if (path.endsWith('/content')) return route.fulfill({ json: { items: [FIXTURE_CONTENT_ITEM], total: 1, offset: 0, limit: 20 } });
    if (path.endsWith(`/content/${FIXTURE_CONTENT_ITEM.id}`)) return route.fulfill({ json: FIXTURE_CONTENT_ITEM });
    if (path.endsWith('/sessions/current')) return route.fulfill({ status: 204 });
    return route.fulfill({ json: [] });
  });
  await page.goto('/');
  await page.getByRole('button', { name: FIXTURE_CONTENT_ITEM.title, exact: true }).click();
  await page.getByRole('button', { name: 'Edit draft', exact: true }).click();
  await page.getByLabel('Copy Text', { exact: true }).fill('My private unsaved campaign copy.');
});

test('browser Back preserves edits until an explicit discard and allows a later clean exit', async ({ page }) => {
  await page.goBack();
  const dialog = page.getByRole('dialog', { name: 'Leave with unsaved changes?' });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/content/${FIXTURE_CONTENT_ITEM.id}$`));
  await dialog.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(page.getByLabel('Copy Text', { exact: true })).toHaveValue('My private unsaved campaign copy.');
  await page.getByRole('link', { name: 'Campaigns', exact: true }).click();
  await expect(dialog).toBeVisible();
  const axe = await new AxeBuilder({ page }).include('[aria-labelledby="unsaved-changes-title"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(axe.violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Campaigns', exact: true })).toBeFocused();
  await page.getByLabel('Copy Text', { exact: true }).fill(FIXTURE_CONTENT_ITEM.revisions[0].text);
  await page.getByRole('link', { name: 'Campaigns', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole('button', { name: FIXTURE_CONTENT_ITEM.title, exact: true }).click();
  await page.getByRole('button', { name: 'Edit draft', exact: true }).click();
  await page.getByLabel('Copy Text', { exact: true }).fill('Another unsaved change.');
  await page.goBack();
  await dialog.getByRole('button', { name: 'Discard edits and leave', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
});

test('sign-out sends no logout request until unsaved changes are explicitly discarded', async ({ page }) => {
  let logouts = 0;
  page.on('request', request => { if (request.method() === 'DELETE' && request.url().endsWith('/sessions/current')) logouts++; });
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Leave with unsaved changes?' });
  await expect(dialog).toBeVisible();
  expect(logouts).toBe(0);
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Copy Text', { exact: true })).toHaveValue('My private unsaved campaign copy.');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await dialog.getByRole('button', { name: 'Discard edits and sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(logouts).toBe(1);
});

test('a pending revision save cannot be abandoned and a failed save preserves the draft', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/content/*/revisions', async route => {
    await gate;
    await route.fulfill({ status: 503, json: { code: 'unavailable', message: 'Revision store unavailable', request_id: 'test', details: {} } });
  });
  const started = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/revisions'));
  await page.getByRole('button', { name: 'Save all & recheck', exact: true }).click();
  await started;
  await page.getByRole('link', { name: 'Campaigns', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Leave with unsaved changes?' });
  await expect(dialog.getByRole('button', { name: 'Discard edits and leave' })).toBeDisabled();
  await expect(dialog.getByRole('status')).toContainText('Saving your revision');
  release();
  await expect(dialog.getByRole('button', { name: 'Discard edits and leave' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Failed to save new revision');
  await expect(page.getByLabel('Copy Text', { exact: true })).toHaveValue('My private unsaved campaign copy.');
});

test('reload uses the native warning and cancelling retains in-memory copy', async ({ page }) => {
  const prompt = page.waitForEvent('dialog', { timeout: 10000 });
  const reload = page.reload({ timeout: 5000 }).catch(() => null);
  const dialog = await prompt;
  expect(dialog.type()).toBe('beforeunload');
  await dialog.dismiss();
  await reload;
  await expect(page.getByLabel('Copy Text', { exact: true })).toHaveValue('My private unsaved campaign copy.');
});

test('failed sign-out preserves the session, draft and leave protection, and allows retry', async ({ page }) => {
  let failed = true;
  await page.route('**/api/v1/sessions/current', route => failed
    ? route.fulfill({ status: 503, json: { code: 'unavailable', message: 'Session store unavailable', details: {}, request_id: 'test' } })
    : route.fulfill({ status: 204 }));
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Leave with unsaved changes?' });
  await dialog.getByRole('button', { name: 'Discard edits and sign out', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Sign-out failed');
  await expect(page).toHaveURL(new RegExp(`/content/${FIXTURE_CONTENT_ITEM.id}$`));
  await expect(page.getByLabel('Copy Text', { exact: true })).toHaveValue('My private unsaved campaign copy.');
  await page.getByRole('link', { name: 'Campaigns', exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Keep editing', exact: true }).click();
  failed = false;
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await dialog.getByRole('button', { name: 'Discard edits and sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test('browser Back during pending sign-out cannot discard edits if logout then fails', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/sessions/current', async route => {
    await gate;
    await route.fulfill({ status: 503, json: { code: 'unavailable', message: 'Session store unavailable', details: {}, request_id: 'test' } });
  });
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Leave with unsaved changes?' });
  const logout = page.waitForRequest(request => request.method() === 'DELETE' && request.url().endsWith('/sessions/current'));
  await dialog.getByRole('button', { name: 'Discard edits and sign out', exact: true }).click();
  await logout;
  try {
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/content/${FIXTURE_CONTENT_ITEM.id}$`));
  } finally { release(); }
  await expect(page.getByRole('alert')).toContainText('Sign-out failed');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel('Copy Text', { exact: true })).toHaveValue('My private unsaved campaign copy.');
});
