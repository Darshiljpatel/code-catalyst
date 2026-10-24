import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { FIXTURE_CONTENT_ITEM, FIXTURE_EXPORT } from '../src/api/fixtures';

test('export retry, truthful clipboard feedback and exact Unicode text download', async ({ page }) => {
  const text = '✨ Approved café copy.\nSecond line.  ';
  const data = { ...FIXTURE_EXPORT, text, text_hash: crypto.createHash('sha256').update(text).digest('hex') };
  let fail = true;
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/me')) return route.fulfill({ json: { user_id: 'user', membership_id: FIXTURE_CONTENT_ITEM.creator_id, role: 'creator', org_id: 'org' } });
    if (path.endsWith(`/content/${FIXTURE_CONTENT_ITEM.id}`)) return route.fulfill({ json: { ...FIXTURE_CONTENT_ITEM, state: 'approved', approval_stale: false } });
    if (path.endsWith('/processing-policy')) return route.fulfill({ json: { enabled: false, version: 0 } });
    if (path.endsWith('/export')) {
      if (fail) return route.fulfill({ status: 503, json: { code: 'unavailable', message: 'Export temporarily unavailable', request_id: 'test', details: {} } });
      return route.fulfill({ json: data });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto(`/content/${FIXTURE_CONTENT_ITEM.id}`);
  await page.locator('#btn-export-certificate').click();
  const dialog = page.getByRole('dialog', { name: 'Approved Revision Export' });
  await expect(dialog.getByRole('alert')).toContainText('Export temporarily unavailable');
  await expect(dialog.getByRole('button', { name: 'Copy approved text' })).toHaveCount(0);
  fail = false;
  await dialog.getByRole('button', { name: 'Retry export' }).click();
  await expect(dialog.getByText('Approved text checksum', { exact: true })).toBeVisible();
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('Permission denied'); } } }));
  await dialog.getByRole('button', { name: 'Copy approved text' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Clipboard access was denied');
  await expect(dialog.getByText('✓ Copied to clipboard!', { exact: true })).toHaveCount(0);
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => { Object.assign(window, { copiedText: value }); } } }));
  await dialog.getByRole('button', { name: 'Copy approved text' }).click();
  await expect(dialog.getByRole('status')).toContainText('Approved text copied');
  expect(await page.evaluate(() => (window as Window & { copiedText: string }).copiedText)).toBe(text);
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download approved text (.txt)' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.txt$/);
  expect(fs.readFileSync((await file.path())!, 'utf8')).toBe(text);
  const auditDownload = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download Audit Record', exact: false }).click();
  const audit = JSON.parse(fs.readFileSync((await (await auditDownload).path())!, 'utf8'));
  expect(audit).toEqual(data);
});

test('closing and reopening export ignores a late request from the previous dialog', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/me')) return route.fulfill({ json: { membership_id: FIXTURE_CONTENT_ITEM.creator_id, role: 'creator' } });
    if (path.endsWith(`/content/${FIXTURE_CONTENT_ITEM.id}`)) return route.fulfill({ json: { ...FIXTURE_CONTENT_ITEM, state: 'approved' } });
    if (path.endsWith('/processing-policy')) return route.fulfill({ json: { enabled: false, version: 0 } });
    if (path.endsWith('/export')) {
      const first = ++requests === 1;
      if (first) await new Promise(resolve => setTimeout(resolve, 1000));
      return route.fulfill({ json: { ...FIXTURE_EXPORT, text: first ? 'Obsolete response' : 'Current approved response' } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto(`/content/${FIXTURE_CONTENT_ITEM.id}`);
  await page.locator('#btn-export-certificate').click();
  const dialog = page.getByRole('dialog', { name: 'Approved Revision Export' });
  await expect.poll(() => requests).toBe(1);
  await dialog.getByRole('button', { name: 'Close export modal' }).click();
  await page.locator('#btn-export-certificate').click();
  await expect(dialog.getByText('Current approved response', { exact: true })).toBeVisible();
  await page.waitForTimeout(1200); // Wait for the deliberately late first response.
  await expect(dialog.getByText('Current approved response', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Obsolete response', { exact: true })).toHaveCount(0);
});
