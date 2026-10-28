import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { FIXTURE_ME_CREATOR, FIXTURE_POLICY } from '../src/api/fixtures';

test('an admin sets how long inactive campaigns are kept from Processing policy', async ({ page }) => {
  let saved: Record<string, unknown> = {};
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/me')) return route.fulfill({ json: { ...FIXTURE_ME_CREATOR, role: 'admin' } });
    if (path.endsWith('/processing-policy')) return route.fulfill({ json: FIXTURE_POLICY });
    if (path.endsWith('/retention') && route.request().method() === 'PUT') {
      saved = route.request().postDataJSON();
      return route.fulfill({ json: { retention_days: saved.retention_days, purged_campaigns: 0, last_purge_at: null } });
    }
    if (path.endsWith('/retention')) return route.fulfill({ json: { retention_days: null, purged_campaigns: 2, last_purge_at: null } });
    return route.fulfill({ json: [] });
  });
  await page.goto('/verify');
  await page.getByRole('button', { name: 'Processing policy' }).click();
  const retention = page.getByRole('group', { name: 'Data retention' });
  await expect(retention).toContainText('2 campaigns deleted so far');
  await retention.getByLabel('Keep inactive campaigns for (days)').fill('90');
  const save = retention.getByRole('button', { name: 'Save retention' });
  await expect(save).toBeDisabled();
  await retention.getByLabel('Reason for the change').fill('Agency contract keeps drafts for 90 days.');
  await save.click();
  await expect(retention.getByRole('status')).toContainText('inactive for 90 days will be deleted hourly');
  expect(saved).toEqual({ retention_days: 90, rationale: 'Agency contract keeps drafts for 90 days.' });
  const axe = await new AxeBuilder({ page }).include('.retention-settings').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(axe.violations).toEqual([]);
});

test('the Processing policy dialog shows how the AI provider behaved in the last 24 hours', async ({ page }) => {
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/me')) return route.fulfill({ json: { ...FIXTURE_ME_CREATOR, role: 'admin' } });
    if (path.endsWith('/processing-policy')) return route.fulfill({ json: FIXTURE_POLICY });
    if (path.endsWith('/provider-status')) return route.fulfill({ json: { model: 'Qwen/Qwen3-235B-A22B-Instruct-2507', runs_24h: 12,
      errors_24h: 1, error_rate_24h: 0.083, p95_latency_ms_24h: 8400, last_success_at: '2026-10-28T05:00:00Z' } });
    if (path.endsWith('/retention')) return route.fulfill({ json: { retention_days: null, purged_campaigns: 0, last_purge_at: null } });
    return route.fulfill({ json: [] });
  });
  await page.goto('/verify');
  await page.getByRole('button', { name: 'Processing policy' }).click();
  const card = page.getByRole('region', { name: 'AI provider status' });
  await expect(card).toContainText('12');
  await expect(card).toContainText('1 (8%)');
  await expect(card).toContainText('8.4 s');
});
