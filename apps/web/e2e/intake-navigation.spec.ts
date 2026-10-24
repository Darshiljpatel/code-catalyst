import { test, expect } from '@playwright/test';
import { FIXTURE_BRAND, FIXTURE_CONTENT_ITEM, FIXTURE_ME_CREATOR, FIXTURE_POLICY } from '../src/api/fixtures';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/me')) return route.fulfill({ json: FIXTURE_ME_CREATOR });
    if (path.endsWith('/brands')) return route.fulfill({ json: [FIXTURE_BRAND] });
    if (path.endsWith('/processing-policy')) return route.fulfill({ json: { ...FIXTURE_POLICY, enabled: true } });
    if (path.endsWith('/content')) return route.fulfill({ json: { items: [], total: 0, offset: 0, limit: 20 } });
    if (path.endsWith(`/content/${FIXTURE_CONTENT_ITEM.id}`)) return route.fulfill({ json: FIXTURE_CONTENT_ITEM });
    return route.fulfill({ json: [] });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Start a new brand review' }).click();
  await expect(page.locator('#txt-content-text')).toBeVisible();
});

test('untouched intake exits normally; Back and Cancel preserve edited copy until discard', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Leave with unsaved changes?' });
  await page.getByRole('button', { name: 'Cancel and return home', exact: false }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Start a new brand review' }).click();
  await page.locator('#txt-title').fill('Private intake title');
  await page.locator('#txt-content-text').fill('Unsubmitted campaign 😀\nKeep this exact copy.  ');
  await page.goBack();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(page.locator('#txt-title')).toHaveValue('Private intake title');
  await expect(page.locator('#txt-content-text')).toHaveValue('Unsubmitted campaign 😀\nKeep this exact copy.  ');
  await page.getByRole('button', { name: 'Cancel and return home', exact: false }).click();
  await dialog.getByRole('button', { name: 'Discard edits and leave', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
});

test('context and consent edits also count, and reverting a field clears the warning', async ({ page }) => {
  const field = page.getByLabel('Channel', { exact: false });
  const original = await field.inputValue();
  await field.selectOption('social');
  await page.getByRole('link', { name: 'Campaigns', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Leave with unsaved changes?' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await field.selectOption(original);
  await page.locator('#chk-consent').check();
  await page.getByRole('link', { name: 'Campaigns', exact: true }).click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('#chk-consent').uncheck();
  await page.getByRole('link', { name: 'Campaigns', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(dialog).toHaveCount(0);
});

test('pending creation stays protected, failed creation preserves copy, and saved recovery needs no discard', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let creates = 0;
  await page.route('**/api/v1/content', async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    creates++;
    if (creates === 1) {
      await gate;
      return route.fulfill({ status: 503, json: { code: 'unavailable', message: 'Campaign store unavailable', details: {}, request_id: 'test' } });
    }
    return route.fulfill({ status: 201, json: FIXTURE_CONTENT_ITEM });
  });
  await page.route('**/api/v1/revisions/*/analysis', route => route.fulfill({ status: 503, json: { code: 'unavailable', message: 'Queue unavailable', details: {}, request_id: 'test' } }));
  await page.locator('#txt-content-text').fill('My pending campaign copy.');
  const started = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/content'));
  await page.locator('#btn-submit-review').click();
  await started;
  await expect(page.locator('#txt-content-text')).toBeDisabled();
  await expect(page.locator('#txt-title')).toBeDisabled();
  await expect(page.locator('#chk-consent')).toBeDisabled();
  await page.getByRole('link', { name: 'Campaigns', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Leave with unsaved changes?' });
  await expect(dialog.getByRole('button', { name: 'Discard edits and leave' })).toBeDisabled();
  release();
  await expect(dialog.getByRole('button', { name: 'Discard edits and leave' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(page.locator('#txt-content-text')).toBeEnabled();
  await expect(page.getByRole('alert')).toContainText('Campaign store unavailable');
  await expect(page.locator('#txt-content-text')).toHaveValue('My pending campaign copy.');
  await page.locator('#btn-submit-review').click();
  await expect(page).toHaveURL(new RegExp(`/content/${FIXTURE_CONTENT_ITEM.id}$`));
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.draft-notice')).toContainText('Your campaign is saved, but analysis could not start');
  expect(creates).toBe(2);
});

test('successful creation opens the saved campaign even if navigation was attempted while waiting', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/content', async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    await gate;
    await route.fulfill({ status: 201, json: FIXTURE_CONTENT_ITEM });
  });
  await page.route('**/api/v1/revisions/*/analysis', route => route.fulfill({ status: 503, json: { code: 'unavailable', message: 'Queue unavailable', details: {}, request_id: 'test' } }));
  await page.locator('#txt-title').fill('Saved while waiting');
  const started = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/content'));
  await page.locator('#btn-submit-review').click();
  await started;
  await page.getByRole('link', { name: 'Campaigns', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Leave with unsaved changes?' });
  await expect(dialog.getByRole('button', { name: 'Discard edits and leave' })).toBeDisabled();
  release();
  await expect(page).toHaveURL(new RegExp(`/content/${FIXTURE_CONTENT_ITEM.id}$`));
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.draft-notice')).toContainText('Your campaign is saved, but analysis could not start');
});
