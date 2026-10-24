import { test, expect } from '@playwright/test';
import { FIXTURE_CONTENT_ITEM, FIXTURE_REVIEW_RUN, FIXTURE_SOURCES } from '../src/api/fixtures';

const FIXTURE_REVISION_2 = { ...FIXTURE_CONTENT_ITEM.revisions[0], id: 'revision-two', number: 2 };

test('discussion filters do not attach notes implicitly, failed posts preserve text, revisions isolate drafts', async ({ page }) => {
  const item = { ...FIXTURE_CONTENT_ITEM, latest_run_id: FIXTURE_REVIEW_RUN.id, current_revision: 2, revisions: [...FIXTURE_CONTENT_ITEM.revisions, FIXTURE_REVISION_2] };
  const run = { ...FIXTURE_REVIEW_RUN, revision_id: FIXTURE_REVISION_2.id, status: 'complete' };
  let loadFailed = true;
  let postFailed = true;
  let posted: { text: string; finding_id: string | null } | undefined;
  const notes = [{ id: 'existing', revision_id: FIXTURE_REVISION_2.id, author_id: 'reviewer', finding_id: null, text: 'A general revision note.', created_at: '2026-10-22T12:00:00Z' }];
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/me')) return route.fulfill({ json: { user_id: 'creator', membership_id: item.creator_id, role: 'creator', org_id: 'org' } });
    if (path.endsWith(`/content/${item.id}`)) return route.fulfill({ json: item });
    if (path.endsWith(`/runs/${run.id}`)) return route.fulfill({ json: run });
    if (path.endsWith('/review')) return route.fulfill({ json: { evidence: { effective_checks: run.checks } } });
    if (path.endsWith('/sources')) return route.fulfill({ json: FIXTURE_SOURCES });
    if (path.endsWith('/processing-policy')) return route.fulfill({ json: { enabled: false, version: 0 } });
    if (path.endsWith('/comments')) {
      if (route.request().method() === 'POST') {
        posted = route.request().postDataJSON();
        if (postFailed) return route.fulfill({ status: 503, json: { code: 'unavailable', message: 'Try posting again', details: {}, request_id: 'test' } });
        return route.fulfill({ status: 201, json: { ...notes[0], ...posted, id: 'new' } });
      }
      if (loadFailed) return route.fulfill({ status: 503, json: {} });
      return route.fulfill({ json: path.includes(FIXTURE_REVISION_2.id) ? notes : [] });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto(`/content/${item.id}`);
  const discussion = page.locator('.comments-section');
  await expect(discussion.getByRole('alert')).toContainText('Discussion could not be loaded');
  await expect(discussion.getByRole('button', { name: 'Post Comment' })).toBeDisabled();
  loadFailed = false;
  await discussion.getByRole('button', { name: 'Retry discussion' }).click();
  await expect(discussion.getByText(notes[0].text)).toBeVisible();
  await discussion.getByLabel('Finding for discussion').selectOption(run.findings[0].id);
  await discussion.getByLabel('Show only comments for selected finding').check();
  await expect(discussion.getByText('No notes for the selected finding.', { exact: false })).toBeVisible();
  const input = discussion.getByRole('textbox', { name: 'Add a discussion note' });
  await input.fill('A revision note despite the active filter.');
  await discussion.getByRole('button', { name: 'Post Comment' }).click();
  await expect(discussion.getByRole('alert')).toContainText('Try posting again');
  expect(posted?.finding_id).toBeNull();
  await expect(input).toHaveValue('A revision note despite the active filter.');
  postFailed = false;
  await discussion.getByLabel('Attach this note to finding', { exact: false }).check();
  await discussion.getByRole('button', { name: 'Post Comment' }).click();
  await expect(discussion.getByRole('status')).toContainText('Note posted to the selected finding');
  expect(posted?.finding_id).toBe(run.findings[0].id);
  await expect(input).toHaveValue('');
  await input.fill('Unsaved note for revision two');
  await page.getByRole('button', { name: /Rev #1/ }).click();
  await expect(discussion.getByRole('textbox')).toHaveValue('');
  await expect(discussion.getByText(notes[0].text)).toHaveCount(0);
});
