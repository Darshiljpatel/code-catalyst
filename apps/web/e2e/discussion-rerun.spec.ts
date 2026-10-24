import { test, expect } from '@playwright/test';
import { FIXTURE_CONTENT_ITEM, FIXTURE_REVIEW_RUN } from '../src/api/fixtures';

test('rerunning analysis clears obsolete discussion attachments without losing the draft', async ({ page }) => {
  const item = { ...FIXTURE_CONTENT_ITEM, latest_run_id: FIXTURE_REVIEW_RUN.id };
  const run = { ...FIXTURE_REVIEW_RUN, status: 'complete' };
  const nextRun = { ...run, id: 'rerun', findings: run.findings.map(finding => ({ ...finding, id: `new-${finding.id}`, run_id: 'rerun' })) };
  let posted: { finding_id: string | null } | undefined;
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/me')) return route.fulfill({ json: { membership_id: item.creator_id, role: 'creator' } });
    if (path.endsWith(`/content/${item.id}`)) return route.fulfill({ json: item });
    if (path.endsWith(`/runs/${run.id}`)) return route.fulfill({ json: run });
    if (path.endsWith('/analysis') && route.request().method() === 'POST') return route.fulfill({ status: 201, json: nextRun });
    if (path.endsWith('/review')) return route.fulfill({ json: { evidence: { effective_checks: run.checks } } });
    if (path.endsWith('/processing-policy')) return route.fulfill({ json: { enabled: false, version: 0 } });
    if (path.endsWith('/comments') && route.request().method() === 'POST') {
      posted = route.request().postDataJSON();
      return route.fulfill({ status: 201, json: { ...posted, id: 'new-note', created_at: '2026-10-23T12:00:00Z', author_id: item.creator_id } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto(`/content/${item.id}`);
  const discussion = page.locator('.comments-section');
  await discussion.getByLabel('Finding for discussion').selectOption(run.findings[0].id);
  await discussion.getByLabel('Attach this note to finding', { exact: false }).check();
  const input = discussion.getByRole('textbox', { name: 'Add a discussion note' });
  await input.fill('Keep this draft after rechecking the same revision.');
  await page.getByRole('button', { name: 'Run Compliance Check' }).click();
  await expect(discussion.getByLabel('Finding for discussion').locator(`option[value="${nextRun.findings[0].id}"]`)).toHaveCount(1);
  await expect(discussion.getByLabel('Finding for discussion')).toHaveValue('');
  await expect(discussion.getByLabel('Attach this note to finding', { exact: false })).toHaveCount(0);
  await expect(input).toHaveValue('Keep this draft after rechecking the same revision.');
  await discussion.getByRole('button', { name: 'Post Comment' }).click();
  await expect(input).toHaveValue('');
  expect(posted?.finding_id).toBeNull();
});
