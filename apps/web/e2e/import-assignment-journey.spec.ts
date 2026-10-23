import { test, expect, type Page } from '@playwright/test';
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

test('real imported draft → later manager assignment → manual review → approval → text and audit export', async ({ browser }) => {
  const creatorContext = await browser.newContext(), managerContext = await browser.newContext(), reviewerContext = await browser.newContext();
  const creator = await creatorContext.newPage(), manager = await managerContext.newPage(), reviewer = await reviewerContext.newPage();
  const text = '✨ LumaDesk offers a 14-day free trial.\nCalm workspace guidance.  ';
  let creations = 0;
  creator.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/content') creations++; });
  await login(creator, 'creator');
  await creator.goto('/review/new');
  await creator.locator('#txt-title').fill('Real imported campaign with later assignment');
  await expect(creator.locator('#txt-reviewer')).toHaveValue('');
  await creator.getByLabel('Choose draft file').setInputFiles({ name: 'fictional-campaign.txt', mimeType: 'text/plain', buffer: Buffer.from(text) });
  await expect(creator.getByLabel('Imported draft preview')).toHaveValue(text);
  expect(creations).toBe(0);
  await creator.getByRole('button', { name: 'Replace draft with imported text' }).click();
  await creator.locator('#btn-submit-review').click();
  await expect(creator).toHaveURL(/\/content\//);
  await expect(creator.getByText('No findings were returned. Review coverage is incomplete;', { exact: false })).toBeVisible({ timeout: 25000 });
  await expect(creator.getByRole('region', { name: 'Incomplete check coverage' })).toContainText('Tone, Messaging, Claims');
  const url = creator.url();
  expect(creations).toBe(1);

  await login(manager, 'manager');
  await manager.goto(url);
  await manager.getByRole('button', { name: 'Assign reviewer', exact: true }).click();
  const assignment = manager.getByRole('dialog', { name: 'Assign a reviewer', exact: true });
  await assignment.getByLabel('Authorized reviewer', { exact: true }).selectOption({ label: fixture.emails.reviewer });
  await assignment.getByLabel('Assignment rationale', { exact: false }).fill('Assigning this fictional campaign to an independent reviewer for manual category checks.');
  const assigned = manager.waitForResponse(response => response.url().endsWith('/reviewer') && response.request().method() === 'PUT');
  await assignment.getByRole('button', { name: 'Save reviewer assignment' }).click();
  expect((await assigned).status()).toBe(200);
  await expect(manager.locator('.draft-notice')).toContainText(fixture.emails.reviewer);

  await login(reviewer, 'reviewer');
  await reviewer.goto(url);
  for (const category of ['tone', 'messaging', 'facts_claims']) {
    await reviewer.locator('#manual-category').selectOption(category);
    await reviewer.locator('#manual-outcome').selectOption(category === 'messaging' ? 'not_applicable' : 'complete');
    if (category !== 'messaging') await reviewer.getByRole('checkbox', { name: /LumaDesk synthetic/ }).check();
    await reviewer.locator('#manual-rationale').fill('Inspected the imported fictional copy against this revision and the approved synthetic guidelines.');
    const saved = reviewer.waitForResponse(response => response.url().endsWith('/manual-checks') && response.request().method() === 'POST');
    await reviewer.getByRole('button', { name: 'Record manual check', exact: true }).click();
    expect((await saved).status()).toBe(201);
    if (category !== 'facts_claims') await expect(reviewer.locator('#manual-rationale')).toHaveValue('');
  }
  await expect(reviewer.getByRole('heading', { name: 'Manual category review' })).toHaveCount(0);
  await creator.reload();
  await creator.locator('#btn-submit-review').click();
  await creator.getByRole('button', { name: 'Confirm Submission', exact: false }).click();
  await expect(creator.getByText('IN_REVIEW', { exact: true })).toBeVisible();
  await reviewer.reload();
  await reviewer.locator('#btn-approve-revision').click();
  await reviewer.locator('#decision-rationale').fill('Approved the exact imported revision after all required manual checks and source inspection.');
  await reviewer.getByRole('button', { name: 'Confirm Approval', exact: false }).click();
  await expect(reviewer.getByText('APPROVED', { exact: true })).toBeVisible();
  await reviewer.locator('#btn-export-certificate').click();
  const textDownload = reviewer.waitForEvent('download');
  await reviewer.getByRole('button', { name: 'Download approved text (.txt)', exact: true }).click();
  expect(fs.readFileSync((await (await textDownload).path())!, 'utf8')).toBe(text);
  const auditDownload = reviewer.waitForEvent('download');
  await reviewer.getByRole('button', { name: 'Download Audit Record', exact: false }).click();
  const audit = JSON.parse(fs.readFileSync((await (await auditDownload).path())!, 'utf8'));
  expect(audit.text).toBe(text);
  expect(audit.text_hash).toBe(crypto.createHash('sha256').update(text).digest('hex'));
  expect(audit.decision.kind).toBe('approved');
  expect(audit.evidence_record.manual_checks).toHaveLength(3);
  expect(creations).toBe(1);
  await creatorContext.close(); await managerContext.close(); await reviewerContext.close();
});
