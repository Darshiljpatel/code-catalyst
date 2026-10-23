import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';

async function expectReflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test('fictional sample correction works with the keyboard without signing in', async ({ page }) => {
  await page.goto('/login');
  await page.keyboard.press('Tab'); // Skip-to-content link
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Email', { exact: true })).toBeFocused();
  const apply = page.getByRole('button', { name: 'Apply fix' });
  await apply.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: '14-day free trial' })).toBeVisible();
  await expect(page.getByText('The draft now matches the approved source.')).toBeVisible();
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(page.getByRole('button', { name: '30-day free trial' })).toBeVisible();
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue('');
  for (const width of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expectReflow(page);
  }
  await page.screenshot({ path: '/tmp/brandguard-studio-login.png', fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.getByLabel('Email', { exact: true })).toBeInViewport();
  await page.screenshot({ path: '/tmp/brandguard-studio-login-mobile.png', fullPage: true });
  const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(audit.violations).toEqual([]);
});

test('campaign studio reflows and cancelling an edit restores the reviewed document', async ({ page }) => {
  const fixture = JSON.parse(fs.readFileSync(process.env.BROWSER_FIXTURE_PATH || '/tmp/brandguard-browser-fixture.json', 'utf8'));
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(fixture.emails.creator);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByLabel('Workspace ID').fill(fixture.org_id);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.locator('.campaign-title').first()).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: '/tmp/brandguard-studio-dashboard.png', fullPage: true });
  for (const width of [375, 768, 1024]) {
    await page.setViewportSize({ width, height: 1000 });
    await expectReflow(page);
  }
  const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(audit.violations).toEqual([]);

  // Use a new draft in the existing disposable browser-test workspace.
  await page.getByRole('button', { name: 'Start a new brand review' }).click();
  await page.locator('#txt-title').fill('Studio visual review');
  await page.locator('#txt-content-text').fill('LumaDesk offers a 30-day free trial.');
  await page.locator('#btn-submit-review').click();
  await expect(page).toHaveURL(/\/content\//);
  await expect(page.locator('.finding-card').first()).toBeVisible({ timeout: 25000 });
  const original = await page.locator('#document-preview-container').innerText();
  await page.getByRole('button', { name: 'Edit Copy / Save Revision' }).click();
  await page.getByLabel('Copy Text', { exact: true }).fill('An unsaved change.');
  const originalChannel = await page.getByLabel('Channel', { exact: true }).inputValue();
  await page.getByLabel('Channel', { exact: true }).fill('unsaved channel');
  await page.getByRole('button', { name: 'Cancel Edit', exact: true }).click();
  await expect(page.locator('#document-preview-container')).toHaveText(original);
  await page.getByRole('button', { name: 'Edit Copy / Save Revision' }).click();
  await expect(page.getByLabel('Channel', { exact: true })).toHaveValue(originalChannel);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.locator('.located-finding').first().click();
  await expect(page.getByRole('dialog', { name: 'Source evidence' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  for (const width of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expectReflow(page);
  }
  await page.screenshot({ path: '/tmp/brandguard-studio-workspace.png', fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: '/tmp/brandguard-studio-workspace-mobile.png', fullPage: true });
  const workspaceAudit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(workspaceAudit.violations).toEqual([]);
});
