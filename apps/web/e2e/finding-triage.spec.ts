import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { filterFindings, ALL_FINDINGS, unresolvedBlockers } from '../src/api/findingFilters';
import { FIXTURE_FINDINGS, FIXTURE_CONTENT_ITEM, FIXTURE_REVIEW_RUN } from '../src/api/fixtures';

test('finding filters combine without changing the global unresolved blocker gate', () => {
  const findings = FIXTURE_FINDINGS.map((finding, index) => ({ ...finding, resolution: ['open', 'dismissed', 'exception', 'confirmed', 'exception_requested'][index] }));
  expect(unresolvedBlockers(findings).map(f => f.id)).toEqual([findings[0].id]);
  expect(filterFindings(findings, { ...ALL_FINDINGS, severity: 'blocker', disposition: 'unresolved' }).map(f => f.id)).toEqual([findings[0].id]);
  expect(filterFindings(findings, { ...ALL_FINDINGS, disposition: 'requested' }).map(f => f.id)).toEqual([findings[4].id]);
  expect(filterFindings(findings, { category: 'tone', severity: 'blocker', disposition: 'all' })).toEqual([]);
  expect(filterFindings(findings, ALL_FINDINGS)).toEqual(findings);
  expect(unresolvedBlockers(findings).length).toBe(1);
});

test('triage keeps hidden blockers visible and batch fixes apply only to visible findings', async ({ page }) => {
  const text = 'Lumadesk offers a 30-day trial. BUY NOW!';
  const term = { ...FIXTURE_FINDINGS[0], location: { start: 0, end: 8, quote: 'Lumadesk' } };
  const factStart = text.indexOf('30-day');
  const claim = { ...FIXTURE_FINDINGS[1], resolution: 'exception', location: { start: factStart, end: factStart + 6, quote: '30-day' } };
  const tone = { ...FIXTURE_FINDINGS[3], suggested_edit: 'Explore the trial.', location: { start: text.indexOf('BUY NOW!'), end: text.length, quote: 'BUY NOW!' } };
  const findings = [term, claim, tone];
  const item = { ...FIXTURE_CONTENT_ITEM, latest_run_id: FIXTURE_REVIEW_RUN.id, revisions: [{ ...FIXTURE_CONTENT_ITEM.revisions[0], text }] };
  const run = { ...FIXTURE_REVIEW_RUN, status: 'complete', findings };
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/me')) return route.fulfill({ json: { membership_id: item.creator_id, role: 'creator' } });
    if (path.endsWith(`/content/${item.id}`)) return route.fulfill({ json: item });
    if (path.endsWith(`/runs/${run.id}`)) return route.fulfill({ json: run });
    if (path.endsWith('/review')) return route.fulfill({ json: { evidence: { effective_checks: run.checks } } });
    if (path.endsWith('/processing-policy')) return route.fulfill({ json: { enabled: false, version: 0 } });
    if (path.endsWith('/analysis')) return route.fulfill({ status: 202, json: { ...run, id: 'rerun', findings: findings.map(f => ({ ...f, run_id: 'rerun' })) } });
    return route.fulfill({ json: [] });
  });
  await page.goto(`/content/${item.id}`);
  const filters = page.locator('.finding-filters');
  await expect(filters.getByRole('status')).toHaveText('Showing 3 of 3 findings. 1 unresolved blocker across this run.');
  await page.getByLabel('Finding category', { exact: true }).selectOption('tone');
  await expect(page.locator('.finding-card')).toHaveCount(1);
  await expect(filters.getByRole('status')).toContainText('1 unresolved blocker across this run');
  await page.getByLabel('Finding severity', { exact: true }).selectOption('blocker');
  await expect(page.locator('.finding-card')).toHaveCount(0);
  await expect(page.getByText('No findings match these filters.', { exact: false })).toBeVisible();
  await filters.getByRole('button', { name: 'Show unresolved blockers' }).click();
  await expect(page.locator('.finding-card')).toHaveCount(1);
  await expect(page.locator('.finding-card')).toHaveAttribute('data-finding-category', 'terminology');
  await filters.getByRole('button', { name: 'Clear finding filters' }).click();
  await page.getByLabel('Finding category', { exact: true }).selectOption('tone');
  const audit = await new AxeBuilder({ page }).include('.finding-filters').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(audit.violations).toEqual([]);
  await page.getByRole('button', { name: 'Apply visible fixes', exact: true }).click();
  await expect(page.locator('#document-preview-container')).toHaveText('Lumadesk offers a 30-day trial. Explore the trial.');
  await expect(filters.getByRole('status')).toContainText('1 unresolved blocker across this run');
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await page.getByRole('button', { name: 'Run Compliance Check', exact: true }).click();
  await expect(page.getByLabel('Finding category', { exact: true })).toHaveValue('all');
  await expect(page.locator('.finding-card')).toHaveCount(3);
});
