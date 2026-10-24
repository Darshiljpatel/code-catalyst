import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { FIXTURE_CONTENT_ITEM, FIXTURE_ME_CREATOR, FIXTURE_POLICY, FIXTURE_REVIEW_RUN } from '../src/api/fixtures';
import type { RunOut } from '../src/api/types';

test('failed or missing coverage never looks like a clean zero-finding review', async ({ page }) => {
  let run: RunOut = {
    ...FIXTURE_REVIEW_RUN, status: 'failed', findings: [],
    checks: FIXTURE_REVIEW_RUN.checks.map(check => ({ ...check, status: 'failed', reason: 'input_budget_exceeded' })),
  };
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/me')) return route.fulfill({ json: { ...FIXTURE_ME_CREATOR, membership_id: FIXTURE_CONTENT_ITEM.creator_id } });
    if (path.endsWith('/processing-policy')) return route.fulfill({ json: FIXTURE_POLICY });
    if (path.endsWith(`/content/${FIXTURE_CONTENT_ITEM.id}`)) return route.fulfill({ json: { ...FIXTURE_CONTENT_ITEM, latest_run_id: run.id } });
    if (path.includes('/runs/')) return route.fulfill({ json: run });
    if (path.endsWith('/review')) return route.fulfill({ json: { evidence: { effective_checks: run.checks } } });
    return route.fulfill({ json: [] });
  });
  const reload = async () => {
    await page.goto(`/content/${FIXTURE_CONTENT_ITEM.id}`);
    await expect(page.getByRole('heading', { name: 'Compliance Findings', exact: false })).toBeVisible();
  };
  await reload();
  const notice = page.getByRole('region', { name: 'Incomplete check coverage' });
  await expect(notice).toContainText('Shorten the draft');
  await expect(notice.getByText('The full external request', { exact: false })).toHaveCount(1);
  await expect(notice).toContainText('Ask the assigned reviewer');
  await expect(page.getByText('this is not a clean compliance result', { exact: false })).toBeVisible();
  await expect(page.getByText('No compliance violations detected', { exact: false })).toHaveCount(0);
  const axe = await new AxeBuilder({ page }).include('[aria-label="Incomplete check coverage"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(axe.violations).toEqual([]);

  run = {
    ...run, status: 'incomplete', processing_snapshot: { enabled: false, consent: false, provider: 'nebius' },
    checks: FIXTURE_REVIEW_RUN.checks.map(check => ['tone', 'messaging', 'facts_claims'].includes(check.category)
      ? { ...check, status: 'unavailable', reason: 'external_processing_not_authorised' }
      : { ...check, status: 'complete' }),
  };
  await reload();
  await expect(notice).toContainText('Nebius was not called for this run');
  await expect(notice).toContainText('Processing policy');
  await expect(notice).toContainText('For the next check: include external semantic review');
  await expect(notice).not.toContainText('Some checks could not establish coverage');
  await expect(page.getByText('Local processing only', { exact: true })).toBeVisible();

  run = { ...run, checks: [{ category: 'tone', status: 'failed', reason: 'future_reason' }] };
  await reload();
  await expect(notice).toContainText('Terminology, Tone, Messaging, Claims, Visual, Accessibility');
  await expect(notice).toContainText('Some checks could not establish coverage');
  await expect(notice).not.toContainText('future_reason');

  run = { ...run, status: 'running' };
  await reload();
  await expect(notice).toHaveCount(0);
  await expect(page.getByText('Analysis is pending.', { exact: true })).toBeVisible();

  run = { ...run, status: 'complete', checks: FIXTURE_REVIEW_RUN.checks.map(check => ({ ...check, status: 'complete' })) };
  await reload();
  await expect(notice).toHaveCount(0);
  await expect(page.getByText('No compliance violations detected in completed checks.', { exact: false })).toBeVisible();
});
