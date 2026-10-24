import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';

test.skip(process.env.LIVE_NEBIUS !== '1', 'Opt in with LIVE_NEBIUS=1; sends fictional data to the paid provider.');
const fixture = JSON.parse(fs.readFileSync(process.env.BROWSER_FIXTURE_PATH || '/tmp/brandguard-browser-fixture.json', 'utf8'));
async function login(page: Page, role: string) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(fixture.emails[role]);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByLabel('Workspace ID').fill(fixture.org_id);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
}

test('browser consent → real worker → live Nebius semantic coverage', async ({ browser }) => {
  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  await login(admin, 'admin');
  await admin.locator('#btn-nav-policy').click();
  await admin.locator('#chk-policy-enabled').check();
  await admin.locator('#txt-policy-notice').fill('Fictional test copy and approved fictional guideline passages will be sent to Nebius for semantic review.');
  await admin.locator('#txt-policy-rationale').fill('Enable the requested full browser and provider integration test.');
  const save = admin.waitForResponse(r => r.url().endsWith('/processing-policy') && r.request().method() === 'PUT');
  await admin.locator('#btn-save-policy').click();
  expect((await save).status()).toBe(200);
  const creatorContext = await browser.newContext();
  const creator = await creatorContext.newPage();
  await login(creator, 'creator');
  await creator.goto('/review/new');
  await creator.locator('#txt-title').fill('Live Nebius browser verification');
  await creator.locator('#txt-reviewer').selectOption({ label: fixture.emails.reviewer });
  await creator.locator('#txt-content-text').fill('Lumadesk guarantees 10x productivity with a 30-day free trial. BUY NOW!!!');
  await expect(creator.locator('#chk-consent')).toBeChecked();
  const queued = creator.waitForResponse(r => r.url().endsWith('/analysis') && r.request().method() === 'POST');
  await creator.locator('#btn-submit-review').click();
  const run = await (await queued).json();
  await expect.poll(async () => {
    const response = await creator.request.get(`/api/v1/runs/${run.id}`);
    const current = await response.json();
    return current.status;
  }, { timeout: 65000, intervals: [1000, 2000] }).toBe('complete');
  const result = await (await creator.request.get(`/api/v1/runs/${run.id}`)).json();
  expect(result.findings.some((f: { origin: string }) => f.origin === 'model')).toBe(true);
  for (const category of ['tone', 'facts_claims']) {
    expect(result.checks.find((c: { category: string }) => c.category === category)?.status).toBe('complete');
  }
  expect(result.checks.find((c: { category: string }) => c.category === 'messaging')?.status).toBe('not_applicable'); // This fixture has no messaging rule.
  expect(result.processing_snapshot).toMatchObject({ enabled: true, consent: true, provider: 'nebius' });
  await adminContext.close(); await creatorContext.close();
});
