import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { FIXTURE_CONTENT_ITEM, FIXTURE_REVIEW_RUN, FIXTURE_SOURCES } from '../src/api/fixtures';
import type { CheckOut } from '../src/api/types';

test('manual review guides outstanding categories and enforces category-specific evidence', async ({ page }) => {
  const toneSource = { ...FIXTURE_SOURCES[0], id: 'tone-source', title: 'Approved tone guide', rules: [{ id: 'tone', category: 'tone', kind: 'guidance', key: 'voice', value: 'Calm language', evidence_quote: 'Use calm language.' }] };
  const otherSource = { ...toneSource, id: 'term-source', title: 'Product naming', rules: [{ ...toneSource.rules[0], id: 'term', category: 'terminology' }] };
  let checks: CheckOut[] = FIXTURE_REVIEW_RUN.checks.map(c => ({ ...c, status: c.category === 'tone' || c.category === 'messaging' ? 'unavailable' : 'complete' }));
  const run = () => ({ ...FIXTURE_REVIEW_RUN, status: 'incomplete', checks, source_snapshot: [toneSource, otherSource] });
  let fail = true, calls = 0, version = 1;
  let payload: { category: string; source_version_ids: string[]; outcome: string } | undefined;
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/me')) return route.fulfill({ json: { membership_id: FIXTURE_CONTENT_ITEM.reviewer_id, role: 'reviewer' } });
    if (path.endsWith(`/content/${FIXTURE_CONTENT_ITEM.id}`)) return route.fulfill({ json: { ...FIXTURE_CONTENT_ITEM, latest_run_id: FIXTURE_REVIEW_RUN.id, workflow_version: version } });
    if (path.endsWith(`/runs/${FIXTURE_REVIEW_RUN.id}`)) return route.fulfill({ json: run() });
    if (path.endsWith('/review')) return route.fulfill({ json: { evidence: { effective_checks: checks } } });
    if (path.endsWith('/processing-policy')) return route.fulfill({ json: { enabled: false, version: 0 } });
    if (path.endsWith('/sources')) return route.fulfill({ json: [toneSource, otherSource] });
    if (path.endsWith('/manual-checks')) {
      calls++; payload = route.request().postDataJSON();
      if (fail) return route.fulfill({ status: 503, json: { code: 'unavailable', message: 'Could not record this check', details: {}, request_id: 'test' } });
      checks = checks.map(c => c.category === payload?.category ? { ...c, status: payload.outcome as CheckOut['status'] } : c);
      version++;
      return route.fulfill({ status: 201, json: { id: `manual-${calls}` } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto(`/content/${FIXTURE_CONTENT_ITEM.id}`);
  const form = page.getByRole('heading', { name: 'Manual category review' }).locator('..');
  await expect(form.getByText('2 categories remain.', { exact: false })).toBeVisible();
  await expect(form.getByLabel('Category', { exact: true }).locator('option')).toHaveCount(2);
  await expect(form.getByLabel('Outcome').locator('option[value="not_applicable"]')).toBeDisabled();
  await form.getByText('Inspect Approved tone guide', { exact: false }).click();
  await expect(form.getByText('Use calm language.', { exact: false })).toBeVisible();
  const audit = await new AxeBuilder({ page }).include('.manual-check-card').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(audit.violations).toEqual([]);
  await page.setViewportSize({ width: 375, height: 812 });
  await form.screenshot({ path: '/tmp/brandguard-manual-review-mobile.png' });
  await form.getByLabel('Review rationale', { exact: false }).fill('Checked the wording against the approved tone source.');
  await form.getByRole('checkbox', { name: /Product naming/ }).check();
  await expect(form.getByRole('button', { name: 'Record manual check' })).toBeDisabled();
  await form.getByRole('checkbox', { name: /Approved tone guide/ }).check();
  await form.getByRole('button', { name: 'Record manual check' }).click();
  await expect(form.getByRole('alert')).toContainText('Could not record this check');
  await expect(form.getByLabel('Review rationale', { exact: false })).not.toHaveValue('');
  fail = false;
  await form.getByRole('button', { name: 'Record manual check' }).click();
  await expect(form.getByLabel('Category', { exact: true })).toHaveValue('messaging');
  await expect(form.getByLabel('Category', { exact: true }).locator('option')).toHaveCount(1);
  expect(payload?.source_version_ids).toContain('tone-source');
  await form.getByLabel('Outcome').selectOption('not_applicable');
  await form.getByLabel('Review rationale', { exact: false }).fill('No messaging rule applies to this exact text revision.');
  await form.getByRole('button', { name: 'Record manual check' }).click();
  await expect(page.getByRole('heading', { name: 'Manual category review' })).toHaveCount(0);
  expect(payload).toMatchObject({ category: 'messaging', outcome: 'not_applicable', source_version_ids: [] });
  expect(calls).toBe(3);
});
