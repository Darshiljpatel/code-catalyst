import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import crypto from 'node:crypto';
const fixture = JSON.parse(fs.readFileSync(process.env.BROWSER_FIXTURE_PATH || '/tmp/brandguard-browser-fixture.json', 'utf8'));
async function login(page: Page, role: string) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(fixture.emails[role]);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByLabel('Workspace ID').fill(fixture.org_id);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
}

test('real creator → worker → manual reviewer → approval → exact export, including reload', async ({ browser }) => {
  const creatorContext = await browser.newContext();
  const reviewerContext = await browser.newContext();
  const creator = await creatorContext.newPage();
  const reviewer = await reviewerContext.newPage();
  await login(creator, 'creator');
  await creator.goto('/review/new');
  await expect(creator.locator('#txt-title')).toBeVisible();
  await creator.locator('#txt-title').fill('Browser verified campaign');
  await creator.locator('#txt-reviewer').selectOption({ label: fixture.emails.reviewer });
  await creator.locator('#txt-content-text').fill('✨ Lumadesk offers a 30-day free trial.');
  await creator.locator('#btn-submit-review').click();
  await expect(creator).toHaveURL(/\/content\//);
  const url = creator.url();
  await expect(creator.locator('.finding-card')).not.toHaveCount(0, { timeout: 25000 });
  await creator.getByRole('button', { name: 'Evidence ↗' }).first().click();
  await expect(creator.getByRole('dialog')).toContainText('LumaDesk synthetic brand rules');
  for (let i = 0; i < 8; i++) {
    await creator.keyboard.press('Tab');
    expect(await creator.getByRole('dialog').evaluate(el => el.contains(document.activeElement))).toBe(true);
  }
  await creator.keyboard.press('Escape');
  await expect(creator.getByRole('dialog')).toHaveCount(0);
  await creator.getByRole('button', { name: 'Edit draft' }).click();
  const corrected = '✨ LumaDesk offers a 14-day free trial.  ';
  await creator.getByLabel('Copy Text', { exact: true }).fill(corrected);
  await creator.getByRole('button', { name: 'Save all & recheck' }).click();
  await expect(creator.getByText('No findings were returned. Review coverage is incomplete;', { exact: false })).toBeVisible({ timeout: 25000 });
  await login(reviewer, 'reviewer');
  await reviewer.goto(url);
  await expect(reviewer.getByRole('heading', { name: 'Manual category review' })).toBeVisible();
  // In local mode semantic categories explicitly require human review.
  for (const category of ['tone', 'messaging', 'facts_claims']) {
    await reviewer.locator('#manual-category').selectOption(category);
    await reviewer.locator('#manual-outcome').selectOption(category === 'messaging' ? 'not_applicable' : 'complete');
    if (category !== 'messaging') await reviewer.getByRole('checkbox', { name: /LumaDesk synthetic/ }).check();
    await reviewer.locator('#manual-rationale').fill('Inspected this exact revision against the fictional approved source.');
    const saved = reviewer.waitForResponse(r => r.url().endsWith('/manual-checks') && r.request().method() === 'POST');
    await reviewer.getByRole('button', { name: 'Record manual check' }).click();
    expect((await saved).status()).toBe(201);
    await expect(reviewer.locator('#manual-rationale')).toHaveValue('').catch(async () => {
      await expect(reviewer.getByRole('heading', { name: 'Manual category review' })).toHaveCount(0);
    });
  }
  await creator.reload(); // restores CSRF from the authenticated session
  await creator.locator('#btn-submit-review').click();
  await creator.getByRole('button', { name: 'Confirm Submission' }).click();
  await expect(creator.getByText('IN_REVIEW', { exact: true })).toBeVisible();
  await reviewer.reload();
  await reviewer.locator('#btn-approve-revision').click();
  await reviewer.locator('#decision-rationale').fill('too short');
  await expect(reviewer.getByRole('button', { name: 'Confirm Approval' })).toBeDisabled();
  await reviewer.locator('#decision-rationale').fill('Verified the exact corrected revision and approved source evidence.');
  await reviewer.getByRole('button', { name: 'Confirm Approval' }).click();
  await expect(reviewer.getByText('APPROVED', { exact: true })).toBeVisible();
  await reviewer.locator('#btn-export-certificate').click();
  const downloadPromise = reviewer.waitForEvent('download');
  await reviewer.getByRole('button', { name: /Download Audit Record/ }).click();
  const download = await downloadPromise;
  const data = JSON.parse(fs.readFileSync((await download.path())!, 'utf8'));
  expect(data.text).toBe(corrected);
  expect(data.text_hash).toBe(crypto.createHash('sha256').update(corrected).digest('hex'));
  expect(data.decision.kind).toBe('approved');
  expect(data.evidence_record.manual_checks.length).toBeGreaterThan(0);
  await reviewer.keyboard.press('Escape');
  const audit = await new AxeBuilder({ page: reviewer }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(audit.violations).toEqual([]);
  await reviewer.setViewportSize({ width: 375, height: 812 });
  expect(await reviewer.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await reviewer.screenshot({ path: '/tmp/brandguard-integrated-mobile.png', fullPage: true });
  await creatorContext.close(); await reviewerContext.close();
});

test('login accessibility and narrow viewport reflow', async ({ page }) => {
  await page.goto('/login');
  // Inspect mid-entrance instead of waiting for an opacity fade to hide defects.
  await page.evaluate(() => document.getAnimations().forEach(animation => { animation.pause(); animation.currentTime = 100; }));
  await expect(page.locator('.login-card')).toHaveCSS('opacity', '1');
  await expect(page.locator('.review-sample')).toHaveCSS('opacity', '1');
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(results.violations).toEqual([]);
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('Unicode suggestion offsets preserve emoji, whitespace and repeated quotes', async () => {
  const { replaceLocatedText } = await import('../src/api/textEdits');
  const original = '👨‍💻 café Lumadesk and Lumadesk  ';
  const points = Array.from(original);
  const start = Array.from('👨‍💻 café Lumadesk and ').length;
  expect(replaceLocatedText(original, original, start, start + 8, 'LumaDesk')).toBe('👨‍💻 café Lumadesk and LumaDesk  ');
  expect(() => replaceLocatedText(original + 'changed', original, start, start + 8, 'x')).toThrow();
  expect(() => replaceLocatedText(original, original, 0, points.length + 1, 'x')).toThrow();
});

test('manager sees live insights and records guideline ambiguity', async ({ page }) => {
  await login(page, 'manager');
  await page.goto(`/brands/${fixture.brand_id}`);
  await page.locator('#btn-brand-insights').click();
  await expect(page.getByRole('dialog')).toContainText('Denominator Definition');
  await expect(page.getByRole('dialog')).not.toContainText('Failed to load');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Report Ambiguity', exact: false }).first().click();
  await page.getByRole('dialog').locator('textarea').fill('Please clarify how the calm-language rule applies to product launch headlines.');
  const response = page.waitForResponse(r => r.url().endsWith('/ambiguity-reports') && r.request().method() === 'POST');
  await page.getByRole('dialog').locator('button[type=submit]').click();
  expect((await response).status()).toBe(201);
});
