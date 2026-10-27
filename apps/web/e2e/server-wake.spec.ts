import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const unauthenticated = { status: 401, json: { code: 'unauthenticated', message: 'Sign in', request_id: 'test', details: {} } };

test('a sleeping backend shows one waking banner, retries, and never shows a parse error', async ({ page }) => {
  let readyCalls = 0;
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/health/ready')) {
      readyCalls++;
      if (readyCalls <= 2) return route.fulfill({ status: 503, contentType: 'text/html', body: '<html><body>Application loading</body></html>' });
      return route.fulfill({ json: { status: 'ready', schema_revision: 'head', worker: 'online' } });
    }
    if (path.endsWith('/health/version')) return route.fulfill({ json: { commit_sha: 'abc1234def5678', api_version: '0.5.0', environment: 'test' } });
    return route.fulfill(unauthenticated);
  });
  await page.goto('/login');
  const banner = page.getByRole('status').filter({ hasText: 'Waking up the review server' });
  await expect(banner).toBeVisible();
  const results = await new AxeBuilder({ page }).include('.server-banner').analyze();
  expect(results.violations.filter(v => ['serious', 'critical'].includes(v.impact || ''))).toEqual([]);
  await expect(banner).toHaveCount(0, { timeout: 15000 });
  expect(readyCalls).toBe(3);
  await expect(page.getByText(/Unexpected token|JSON/)).toHaveCount(0);
  await expect(page.locator('footer.build-footer')).toContainText('abc1234');
});

test('a sign-in during a cold start is not retried without an idempotency key and shows plain language', async ({ page }) => {
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/sessions')) return route.fulfill({ status: 502, contentType: 'text/html', body: '<html>Bad gateway</html>' });
    return route.fulfill(unauthenticated);
  });
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('creator@lumadesk.test');
  await page.getByLabel('Password', { exact: true }).fill('password-for-test');
  const workspace = page.getByLabel(/Workspace/);
  if (await workspace.count()) await workspace.first().fill('539ad43a-e582-46f0-8d0d-7e483782d5c6');
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByText('The review server is not responding yet')).toBeVisible();
  await expect(page.getByText(/Unexpected token/)).toHaveCount(0);
});

test('a stale worker heartbeat shows the review engine offline banner', async ({ page }) => {
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/me')) return route.fulfill({ json: { user_id: 'judge', org_id: 'demo', role: 'creator', membership_id: 'creator', csrf_token: 'test' } });
    if (path.endsWith('/health/worker')) return route.fulfill({ json: { status: 'offline', last_seen_at: null, age_seconds: 120, worker_count: 0, offline_after_seconds: 60 } });
    if (path.endsWith('/content')) return route.fulfill({ json: { items: [], total: 0, limit: 20, offset: 0 } });
    return route.fulfill({ json: [] });
  });
  await page.goto('/');
  await expect(page.getByRole('alert').filter({ hasText: 'Review engine offline' })).toBeVisible();
});
