import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/**', route => route.fulfill({ status: 401, json: { code: 'unauthenticated', message: 'Sign in', request_id: 'test', details: {} } }));
});

test('logged-out judges can hover, choose roles, copy exact credentials, and recover from clipboard denial', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async (value: string) => { (window as unknown as { copiedValue: string }).copiedValue = value; },
    } });
  });
  await page.goto('/login');
  const trigger = page.getByRole('button', { name: 'Judge guide', exact: true });
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await trigger.hover();
  const guide = page.getByRole('complementary', { name: 'Your judging companion.' });
  await expect(guide).toBeVisible();
  await expect(guide).toContainText('creator@lumadesk.test');
  await guide.getByRole('button', { name: 'Copy email', exact: true }).click();
  await expect(guide.getByRole('status')).toHaveText('Email copied.');
  expect(await page.evaluate(() => (window as unknown as { copiedValue: string }).copiedValue)).toBe('creator@lumadesk.test');
  await guide.getByRole('button', { name: 'Reviewer', exact: true }).click();
  await expect(guide).toContainText('reviewer@lumadesk.test');
  await guide.getByRole('button', { name: 'Manager', exact: true }).click();
  await expect(guide).toContainText('manager@lumadesk.test');
  await guide.getByRole('button', { name: 'Admin', exact: true }).click();
  await expect(guide).toContainText('admin@lumadesk.test');
  await guide.getByRole('button', { name: 'Copy password', exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { copiedValue: string }).copiedValue)).toBe('BrandGuardAdmin2026!');
  await guide.getByRole('button', { name: 'Copy workspace id', exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { copiedValue: string }).copiedValue)).toBe('539ad43a-e582-46f0-8d0d-7e483782d5c6');
  await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { throw new Error('denied'); } } }); });
  await guide.getByRole('button', { name: 'Copy email', exact: true }).click();
  await expect(guide.getByRole('status')).toContainText('Select the text and copy it manually');
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue('');
  await page.keyboard.press('Escape');
  await expect(guide).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Close judge guide' })).toBeFocused();
  await page.screenshot({ path: '/tmp/brandguard-judge-guide-desktop.png', fullPage: true });
});

test('the same guide remains available through sign-in, route changes and sign-out', async ({ page }) => {
  let signedIn = false;
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/sessions') && route.request().method() === 'POST') {
      signedIn = true;
      return route.fulfill({ json: { csrf_token: 'test', org_id: 'demo', role: 'creator' } });
    }
    if (path.endsWith('/sessions/current')) { signedIn = false; return route.fulfill({ status: 204 }); }
    if (path.endsWith('/me')) return signedIn ? route.fulfill({ json: { user_id: 'judge', org_id: 'demo', role: 'creator', membership_id: 'creator', csrf_token: 'test' } }) : route.fallback();
    if (path.endsWith('/content')) return route.fulfill({ json: { items: [], total: 0, limit: 20, offset: 0 } });
    return route.fulfill({ json: [] });
  });
  await page.goto('/login');
  const trigger = page.getByRole('button', { name: 'Judge guide', exact: true });
  await page.getByLabel('Email', { exact: true }).fill('creator@lumadesk.test');
  await page.getByLabel('Password', { exact: true }).fill('BrandGuardAdmin2026!');
  await page.getByLabel('Workspace ID', { exact: true }).fill('539ad43a-e582-46f0-8d0d-7e483782d5c6');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await trigger.click();
  const guide = page.getByRole('complementary', { name: 'Your judging companion.' });
  await expect(guide).toContainText('Signed in as creator');
  await guide.getByRole('button', { name: 'Walkthrough', exact: false }).click();
  await expect(guide).toContainText('Sign in and start a campaign');
  await guide.getByRole('button', { name: 'Close judge guide' }).click();
  await page.getByRole('button', { name: 'Start a new brand review' }).click();
  await expect(page).toHaveURL(/\/review\/new$/);
  await trigger.click();
  await expect(guide).toContainText('Try the four roles');
  await guide.getByRole('button', { name: 'Close judge guide' }).click();
  await page.locator('#btn-sign-out').click();
  await expect(page).toHaveURL(/\/login$/);
  await trigger.click();
  await expect(guide).toBeVisible();
  await expect(guide).not.toContainText('Signed in as creator');
});

test('touch and keyboard users get a scrollable, accessible guide at narrow widths', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.route('**/api/v1/**', route => route.fulfill({ status: 401, json: {} }));
  await page.goto('/login');
  await page.getByRole('button', { name: 'Judge guide', exact: true }).tap();
  const guide = page.getByRole('complementary', { name: 'Your judging companion.' });
  await expect(guide).toBeVisible();
  const box = (await guide.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(375);
  expect(box.y + box.height).toBeLessThanOrEqual(812);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const audit = await new AxeBuilder({ page }).include('.judge-guide').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(audit.violations).toEqual([]);
  await page.screenshot({ path: '/tmp/brandguard-judge-guide-mobile.png', fullPage: true });
  await guide.getByRole('button', { name: 'Walkthrough', exact: false }).tap();
  await guide.getByRole('button', { name: 'Copy corrected draft' }).scrollIntoViewIfNeeded();
  await expect(guide.getByRole('button', { name: 'Copy corrected draft' })).toBeInViewport();
  await page.screenshot({ path: '/tmp/brandguard-judge-guide-walkthrough.png', fullPage: true });
  await guide.getByRole('button', { name: 'Close judge guide' }).tap();
  await expect(guide).toHaveCount(0);
  await context.close();
});

test('walkthrough leads creator → manager → reviewer → admin with matching credentials and actionable explanations', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Judge guide', exact: true }).click();
  const guide = page.getByRole('complementary', { name: 'Your judging companion.' });
  await guide.getByRole('button', { name: 'Open creator steps', exact: false }).click();
  await expect(guide.getByRole('button', { name: 'Step 1: Creator' })).toHaveAttribute('aria-pressed', 'true');
  await expect(guide).toContainText('Submit for Compliance Review →');
  await expect(guide).toContainText('Save all & recheck');
  await guide.getByRole('button', { name: 'Next: Manager', exact: false }).click();
  await expect(guide.getByRole('button', { name: 'Step 2: Manager' })).toHaveAttribute('aria-pressed', 'true');
  await expect(guide).toContainText('Why were those phrases detected?');
  await expect(guide).toContainText('The approved fact says the free trial lasts 14 days');
  await expect(guide).toContainText('Evidence Quote');
  await guide.getByRole('button', { name: 'View manager credentials' }).click();
  await expect(guide).toContainText('manager@lumadesk.test');
  await guide.getByRole('button', { name: 'Open manager steps', exact: false }).click();
  await expect(guide.getByRole('button', { name: 'Step 2: Manager' })).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: '/tmp/brandguard-judge-manager-chapter.png', fullPage: true });
  await guide.getByRole('button', { name: 'Next: Reviewer', exact: false }).click();
  await expect(guide).toContainText('Record manual check');
  await expect(guide).toContainText('Confirm Submission →');
  await expect(guide).toContainText('✓ Confirm Approval');
  await expect(guide).toContainText('Download Audit Record (.json)');
  await guide.getByRole('button', { name: 'Next: Admin', exact: false }).click();
  await expect(guide.getByRole('button', { name: 'Step 4: Admin' })).toHaveAttribute('aria-pressed', 'true');
  await expect(guide).toContainText('Save Policy Changes');
  await expect(guide).toContainText('does not rerun earlier reviews');
  await expect(guide).toContainText('Finish with external processing enabled');
  const audit = await new AxeBuilder({ page }).include('.judge-guide').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(audit.violations).toEqual([]);
  await guide.getByRole('button', { name: 'Previous role', exact: false }).click();
  await expect(guide.getByRole('button', { name: 'Step 3: Reviewer' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page).toHaveURL(/\/login$/); // Reading the guide never changes the account or page.
});
