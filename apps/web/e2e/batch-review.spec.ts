import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
const fixture = JSON.parse(fs.readFileSync(process.env.BROWSER_FIXTURE_PATH || '/tmp/brandguard-browser-fixture.json', 'utf8'));
const example = 'lumadeks is providing free trial for users for 9000 days , OH MY GOD THIS IS INSANE!!!';

async function login(page: Page, role: string) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(fixture.emails[role]);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByLabel('Workspace ID').fill(fixture.org_id);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
}

test('creator stages multiple fixes and manual edits, saves one revision, then submits once after coverage', async ({ browser }) => {
  const creatorContext = await browser.newContext();
  const reviewerContext = await browser.newContext();
  const creator = await creatorContext.newPage();
  const reviewer = await reviewerContext.newPage();
  let revisionWrites = 0, submissions = 0;
  creator.on('request', request => {
    if (request.method() === 'POST' && /\/content\/[^/]+\/revisions$/.test(request.url())) revisionWrites++;
    if (request.method() === 'POST' && /\/revisions\/[^/]+\/submit$/.test(request.url())) submissions++;
  });
  await login(creator, 'creator');
  await creator.goto('/review/new');
  await creator.locator('#txt-title').fill('Creator batch-fix regression');
  await creator.locator('#txt-reviewer').selectOption({ label: fixture.emails.reviewer });
  await creator.locator('#txt-content-text').fill(example);
  await creator.locator('#btn-submit-review').click();
  await expect(creator).toHaveURL(/\/content\//);
  const url = creator.url();
  const term = creator.locator('[data-finding-category="terminology"]');
  const fact = creator.locator('[data-finding-category="facts_claims"]');
  await expect(term).toContainText('Possible misspelling', { timeout: 25000 });
  await expect(fact).toContainText('9000 days');
  await expect(creator.locator('#btn-run-analysis')).toBeEnabled({ timeout: 25000 });
  await term.getByRole('button', { name: 'Apply fix', exact: true }).click();
  await expect(creator.locator('#document-preview-container')).toContainText('LumaDesk');
  await expect(fact.getByRole('button', { name: 'Customize fix' })).toBeEnabled();
  await fact.getByRole('button', { name: 'Customize fix' }).click();
  const dialog = creator.getByRole('dialog', { name: 'Review Proposed Edit' });
  await expect(dialog).toContainText('9000 days'); // The draft quote, not the source quote.
  await dialog.getByLabel('PROPOSED REPLACEMENT (EDITABLE)').fill('14 days');
  await dialog.getByRole('button', { name: 'Add to working draft' }).click();
  await expect(creator.locator('#document-preview-container')).toContainText('14 days');
  await expect(term.getByRole('button', { name: 'Added to draft' })).toBeDisabled();
  expect(revisionWrites).toBe(0);

  await creator.getByRole('button', { name: 'Edit draft', exact: true }).click();
  const copy = creator.getByLabel('Copy Text', { exact: true });
  const corrected = 'LumaDesk is providing free trial for users for 14 days , Explore your next workspace.';
  await copy.fill(corrected);
  await creator.getByRole('button', { name: 'Preview draft' }).click();
  await expect(creator.getByLabel('Working draft actions')).toContainText('2 suggested fixes staged');
  await creator.getByRole('button', { name: 'Undo last change' }).click();
  await expect(creator.locator('#document-preview-container')).toContainText('OH MY GOD');
  await creator.getByRole('button', { name: 'Edit draft', exact: true }).click();
  await creator.getByLabel('Copy Text', { exact: true }).fill(corrected);
  await creator.getByRole('button', { name: 'Preview draft' }).click();
  await creator.setViewportSize({ width: 375, height: 812 });
  expect(await creator.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const audit = await new AxeBuilder({ page: creator }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(audit.violations).toEqual([]);
  await creator.setViewportSize({ width: 1440, height: 1000 });
  await creator.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await creator.screenshot({ path: '/tmp/brandguard-batch-draft.png' });
  await creator.getByRole('button', { name: 'Save all & recheck', exact: true }).click();
  await expect(creator.getByText('No findings were returned. Review coverage is incomplete;', { exact: false })).toBeVisible({ timeout: 25000 });
  expect(revisionWrites).toBe(1);
  await expect(creator.getByRole('button', { name: 'Rev #2 (Current)' })).toBeVisible();
  await expect(creator.locator('#document-preview-container')).toHaveText(corrected);
  await creator.locator('#btn-submit-review').click();
  await expect(creator.getByRole('dialog')).toContainText('Not ready to submit yet');
  await expect(creator.getByRole('button', { name: 'Confirm Submission', exact: false })).toBeDisabled();
  expect(submissions).toBe(0);
  await creator.keyboard.press('Escape');

  // Local mode honestly requires semantic category coverage by the assigned human.
  await login(reviewer, 'reviewer');
  await reviewer.goto(url);
  for (const category of ['tone', 'messaging', 'facts_claims']) {
    await reviewer.locator('#manual-category').selectOption(category);
    await reviewer.locator('#manual-outcome').selectOption(category === 'messaging' ? 'not_applicable' : 'complete');
    if (category !== 'messaging') await reviewer.getByRole('checkbox', { name: /LumaDesk synthetic/ }).check();
    await reviewer.locator('#manual-rationale').fill('Inspected the combined fixes against the approved fictional source for this exact revision.');
    const saved = reviewer.waitForResponse(response => response.url().endsWith('/manual-checks') && response.request().method() === 'POST');
    await reviewer.getByRole('button', { name: 'Record manual check' }).click();
    expect((await saved).status()).toBe(201);
    await expect(reviewer.locator('#manual-rationale')).toHaveValue('').catch(async () => {
      await expect(reviewer.getByRole('heading', { name: 'Manual category review' })).toHaveCount(0);
    });
  }
  await creator.reload();
  await creator.locator('#btn-submit-review').click();
  await creator.getByRole('button', { name: 'Confirm Submission', exact: false }).click();
  await expect(creator.getByText('IN_REVIEW', { exact: true })).toBeVisible();
  expect(revisionWrites).toBe(1);
  expect(submissions).toBe(1);
  await creatorContext.close(); await reviewerContext.close();
});

test('save-and-submit retries a failed recheck without saving duplicate revisions', async ({ page }) => {
  await login(page, 'creator');
  await page.goto('/review/new');
  await page.locator('#txt-title').fill('Batch recheck recovery');
  await page.locator('#txt-reviewer').selectOption({ label: fixture.emails.reviewer });
  await page.locator('#txt-content-text').fill(example);
  await page.locator('#btn-submit-review').click();
  await expect(page.locator('[data-finding-category="terminology"]')).toBeVisible({ timeout: 25000 });
  await expect(page.locator('#btn-run-analysis')).toBeEnabled({ timeout: 25000 });
  let revisions = 0, submissions = 0;
  page.on('request', request => {
    if (request.method() === 'POST' && /\/content\/[^/]+\/revisions$/.test(request.url())) revisions++;
    if (request.method() === 'POST' && /\/revisions\/[^/]+\/submit$/.test(request.url())) submissions++;
  });
  await page.getByRole('button', { name: 'Apply available fixes' }).click();
  await expect(page.getByLabel('Working draft actions')).toContainText('2 suggested fixes staged');
  await page.route('**/revisions/*/analysis', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'unavailable', message: 'Test-only outage', request_id: 'test', details: {} }) }));
  await page.getByLabel('Working draft actions').getByRole('button', { name: 'Save all & submit', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Your changes are saved as revision #2');
  expect(revisions).toBe(1);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('Working draft actions')).toHaveCount(0);
  await page.unroute('**/revisions/*/analysis');
  // The same action resumes analysis of the saved revision, then opens preflight.
  await page.locator('#btn-submit-review').click();
  await expect(page.getByRole('dialog')).toContainText('Not ready to submit yet', { timeout: 25000 });
  await expect(page.getByRole('button', { name: 'Confirm Submission', exact: false })).toBeDisabled();
  expect(revisions).toBe(1);
  expect(submissions).toBe(0);
});
