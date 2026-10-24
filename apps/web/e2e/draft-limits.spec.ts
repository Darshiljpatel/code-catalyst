import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import { DRAFT_LIMITS, draftFieldLength, validateDraft } from '../src/api/draftValidation';
import { FIXTURE_BRAND, FIXTURE_CONTENT_ITEM, FIXTURE_ME_CREATOR, FIXTURE_POLICY } from '../src/api/fixtures';

test('draft preflight matches the published contract and counts saved Unicode characters', () => {
  const contract = JSON.parse(fs.readFileSync(new URL('../../../contracts/openapi.json', import.meta.url), 'utf8'));
  for (const [field, limit] of Object.entries(DRAFT_LIMITS)) {
    expect(contract.components.schemas.ContentInput.properties[field].maxLength).toBe(limit);
    if (field !== 'title') expect(contract.components.schemas.NewRevisionInput.properties[field].maxLength).toBe(limit);
  }
  const values = { title: '😀'.repeat(200), text: '😀'.repeat(100000), channel: ' email ', audience: 'A'.repeat(300), purpose: 'P'.repeat(500) };
  expect(validateDraft(values)).toEqual([]);
  expect(draftFieldLength('text', ' 😀\n ')).toBe(4);
  expect(draftFieldLength('audience', '  😀  ')).toBe(1);
  for (const field of ['title', 'text', 'channel', 'audience', 'purpose'] as const) {
    expect(validateDraft({ ...values, [field]: 'X'.repeat(DRAFT_LIMITS[field] + 1) })).toHaveLength(1);
    expect(validateDraft({ ...values, [field]: '   ' })[0]).toContain('is required');
  }
});

test('intake explains limits without truncation or a request, then accepts the exact boundary', async ({ page }) => {
  let creates = 0;
  let sentText = '';
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/me')) return route.fulfill({ json: FIXTURE_ME_CREATOR });
    if (path.endsWith('/brands')) return route.fulfill({ json: [FIXTURE_BRAND] });
    if (path.endsWith('/processing-policy')) return route.fulfill({ json: FIXTURE_POLICY });
    if (path.endsWith('/content') && route.request().method() === 'POST') {
      creates++; sentText = route.request().postDataJSON().text;
      return route.fulfill({ status: 201, json: FIXTURE_CONTENT_ITEM });
    }
    if (path.endsWith(`/content/${FIXTURE_CONTENT_ITEM.id}`)) return route.fulfill({ json: FIXTURE_CONTENT_ITEM });
    if (path.endsWith('/analysis')) return route.fulfill({ status: 503, json: { code: 'unavailable', message: 'Queue unavailable', details: {}, request_id: 'test' } });
    return route.fulfill({ json: [] });
  });
  await page.goto('/review/new');
  await page.locator('#txt-purpose').fill('   ');
  await expect(page.locator('#txt-purpose')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#new-purpose-count')).toContainText('required');
  await page.locator('#txt-purpose').fill('Awareness');
  const oversized = '😀'.repeat(100001);
  await page.locator('#txt-content-text').fill(oversized);
  await page.locator('#txt-title').fill('😀'.repeat(201));
  await page.locator('#txt-audience').fill('A'.repeat(301));
  await expect(page.locator('#new-copy-count')).toHaveText('100,001 / 100,000 characters - 1 over');
  await expect(page.locator('#txt-content-text')).toHaveAttribute('aria-invalid', 'true');
  await page.locator('#btn-submit-review').click();
  await expect(page.getByRole('alert')).toContainText('Campaign copy exceeds its 100,000-character limit by 1');
  await expect(page.getByRole('alert')).toContainText('Campaign title exceeds');
  expect(creates).toBe(0);
  expect(await page.locator('#txt-content-text').inputValue() === oversized).toBe(true);
  const accessibility = await new AxeBuilder({ page }).include('form').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(accessibility.violations).toEqual([]);
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#txt-title').fill('😀'.repeat(200));
  await page.locator('#txt-audience').fill('A'.repeat(300));
  const atLimit = '😀'.repeat(100000);
  await page.locator('#txt-content-text').fill(atLimit);
  await expect(page.locator('#new-copy-count')).toHaveText('100,000 / 100,000 characters');
  await expect(page.locator('#txt-content-text')).toHaveAttribute('aria-invalid', 'false');
  await page.locator('#btn-submit-review').click();
  await expect(page).toHaveURL(new RegExp(`/content/${FIXTURE_CONTENT_ITEM.id}$`));
  expect(creates).toBe(1);
  expect(sentText === atLimit).toBe(true);
});

test('saved draft preflight blocks overlong context and uses server-normalized context after saving', async ({ page }) => {
  let writes = 0;
  let item = FIXTURE_CONTENT_ITEM;
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/me')) return route.fulfill({ json: { ...FIXTURE_ME_CREATOR, membership_id: item.creator_id } });
    if (path.endsWith('/processing-policy')) return route.fulfill({ json: FIXTURE_POLICY });
    if (path.endsWith(`/content/${item.id}`)) return route.fulfill({ json: item });
    if (path.endsWith('/revisions') && route.request().method() === 'POST') {
      writes++;
      const body = route.request().postDataJSON();
      item = { ...item, current_revision: 2, revisions: [...item.revisions, { ...item.revisions[0], text: body.text, channel: body.channel, audience: body.audience, purpose: body.purpose, id: 'saved-limit-revision', number: 2 }] };
      return route.fulfill({ status: 201, json: item });
    }
    if (path.endsWith('/analysis')) return route.fulfill({ status: 503, json: { code: 'unavailable', message: 'Queue unavailable', details: {}, request_id: 'test' } });
    return route.fulfill({ json: [] });
  });
  await page.goto(`/content/${item.id}`);
  await page.getByRole('button', { name: 'Edit draft', exact: true }).click();
  await page.locator('#edit-channel').fill('C'.repeat(101));
  await page.locator('#edit-purpose').fill('P'.repeat(501));
  await page.getByRole('button', { name: 'Save all & recheck', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Channel exceeds its 100-character limit by 1');
  await expect(page.locator('#edit-purpose')).toHaveAttribute('aria-invalid', 'true');
  expect(writes).toBe(0);
  await page.locator('#edit-channel').fill('  email  ');
  await page.locator('#edit-purpose').fill('  Awareness  ');
  await expect(page.locator('#edit-channel-count')).toHaveText('5 / 100 characters');
  await page.getByRole('button', { name: 'Save all & recheck', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Your changes are saved as revision #2');
  await expect(page.getByRole('complementary', { name: 'Working draft actions' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Run Compliance Check', exact: true })).toBeEnabled();
  expect(writes).toBe(1);
});
