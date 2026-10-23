import { test, expect } from '@playwright/test';
import { resolutionActions } from '../src/api/resolutionActions';
import { FIXTURE_CONTENT_ITEM, FIXTURE_ME_CREATOR, FIXTURE_ME_REVIEWER, FIXTURE_FINDINGS, FIXTURE_REVIEW_RUN } from '../src/api/fixtures';

const creator = { ...FIXTURE_ME_CREATOR, membership_id: FIXTURE_CONTENT_ITEM.creator_id };
const reviewer = { ...FIXTURE_ME_REVIEWER, membership_id: FIXTURE_CONTENT_ITEM.reviewer_id! };
const run = { ...FIXTURE_REVIEW_RUN, status: 'complete', stale: false };

test('creator requests and assigned-reviewer decisions are distinct', () => {
  expect(resolutionActions(creator, FIXTURE_CONTENT_ITEM, FIXTURE_FINDINGS[0], run)).toEqual(['request_exception', 'request_dismissal']);
  expect(resolutionActions(reviewer, FIXTURE_CONTENT_ITEM, FIXTURE_FINDINGS[0], run)).toContain('dismiss');
  expect(resolutionActions(reviewer, FIXTURE_CONTENT_ITEM, FIXTURE_FINDINGS[1], run)).not.toContain('dismiss');
  expect(resolutionActions(reviewer, FIXTURE_CONTENT_ITEM, FIXTURE_FINDINGS[1], run)).toContain('grant_exception');
  for (const user of [null, { ...reviewer, membership_id: 'someone-else' }, { ...reviewer, role: 'manager' as const }]) {
    expect(resolutionActions(user, FIXTURE_CONTENT_ITEM, FIXTURE_FINDINGS[0], run)).toEqual([]);
  }
});

test('stale, pending and decided reviews cannot offer disposition actions', () => {
  for (const state of ['approved', 'changes_requested']) expect(resolutionActions(reviewer, { ...FIXTURE_CONTENT_ITEM, state }, FIXTURE_FINDINGS[0], run)).toEqual([]);
  expect(resolutionActions(reviewer, FIXTURE_CONTENT_ITEM, FIXTURE_FINDINGS[0], { ...run, stale: true })).toEqual([]);
  expect(resolutionActions(reviewer, FIXTURE_CONTENT_ITEM, FIXTURE_FINDINGS[0], { ...run, status: 'running' })).toEqual([]);
  expect(resolutionActions(reviewer, FIXTURE_CONTENT_ITEM, { ...FIXTURE_FINDINGS[0], run_id: 'old' }, run)).toEqual([]);
  expect(resolutionActions(reviewer, { ...FIXTURE_CONTENT_ITEM, current_revision: 2 }, FIXTURE_FINDINGS[0], run)).toEqual([]);
});

test('creator disposition dialog offers requests and sends selected action', async ({ page }) => {
  let action = '';
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/me')) return route.fulfill({ json: creator });
    if (path.endsWith(`/content/${FIXTURE_CONTENT_ITEM.id}`)) return route.fulfill({ json: { ...FIXTURE_CONTENT_ITEM, latest_run_id: run.id } });
    if (path.endsWith(`/runs/${run.id}`)) return route.fulfill({ json: run });
    if (path.endsWith('/review')) return route.fulfill({ json: { evidence: { effective_checks: run.checks } } });
    if (path.endsWith('/processing-policy')) return route.fulfill({ json: { enabled: false, version: 0 } });
    if (path.endsWith('/resolutions')) {
      action = route.request().postDataJSON().action;
      return route.fulfill({ status: 201, json: { id: 'resolution' } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto(`/content/${FIXTURE_CONTENT_ITEM.id}`);
  await page.getByRole('button', { name: 'Resolve', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Resolve Finding Disposition' });
  const select = dialog.getByLabel('Disposition Action');
  await expect(select.locator('option')).toHaveCount(2);
  await select.selectOption('request_dismissal');
  await dialog.getByLabel('Audit Rationale', { exact: false }).fill('Please review this finding against the quoted source evidence.');
  await dialog.getByRole('button', { name: 'Record Disposition' }).click();
  await expect(dialog).toHaveCount(0);
  expect(action).toBe('request_dismissal');
});
