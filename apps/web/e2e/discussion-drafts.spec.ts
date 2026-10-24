import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { FIXTURE_CONTENT_ITEM, FIXTURE_POLICY, FIXTURE_REVIEW_RUN } from '../src/api/fixtures';

test('notes remain on their own revisions, failed posting preserves them, and leaving warns until all are posted or cleared', async ({ page }) => {
  const first = FIXTURE_CONTENT_ITEM.revisions[0], second = { ...first, id: 'draft-notes-rev-two', number: 2 };
  const item = { ...FIXTURE_CONTENT_ITEM, current_revision: 2, revisions: [first, second] };
  const posts: { revision: string; text: string }[] = [];
  let fail = true;
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/me')) return route.fulfill({ json: { membership_id: item.creator_id, role: 'creator' } });
    if (path.endsWith(`/content/${item.id}`)) return route.fulfill({ json: item });
    if (path.endsWith('/processing-policy')) return route.fulfill({ json: FIXTURE_POLICY });
    if (path.endsWith('/comments') && route.request().method() === 'POST') {
      const revision = path.split('/').at(-2)!;
      const body = route.request().postDataJSON();
      posts.push({ revision, text: body.text });
      if (fail) return route.fulfill({ status: 503, json: { code: 'unavailable', message: 'Try posting again', details: {}, request_id: 'test' } });
      return route.fulfill({ status: 201, json: { ...body, id: 'posted-one', revision_id: revision, author_id: item.creator_id, created_at: '2026-10-24T03:00:00Z' } });
    }
    if (path.endsWith('/content')) return route.fulfill({ json: { items: [], total: 0, offset: 0, limit: 20 } });
    return route.fulfill({ json: [] });
  });
  await page.goto(`/content/${item.id}`);
  const input = page.getByRole('textbox', { name: 'Add a discussion note' });
  const textTwo = 'Private draft note for revision two. 😀';
  await input.fill(textTwo);
  await page.getByRole('button', { name: 'Rev #1', exact: true }).click();
  await expect(input).toHaveValue('');
  await input.fill('Note for revision one.  ');
  await page.getByRole('button', { name: 'Rev #2 (Current)', exact: true }).click();
  await expect(input).toHaveValue(textTwo);
  expect(posts).toHaveLength(0);
  await page.getByRole('link', { name: 'Campaigns', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Leave with unsaved changes?' });
  await expect(dialog).toContainText('discussion notes have not been posted');
  await dialog.getByRole('button', { name: 'Keep editing', exact: true }).click();
  const audit = await new AxeBuilder({ page }).include('[aria-label="Unsent discussion notes"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(audit.violations).toEqual([]);
  expect(await page.evaluate(text => [...Object.values(localStorage), ...Object.values(sessionStorage)].some(value => value.includes(text)), textTwo)).toBe(false);
  await page.getByRole('button', { name: 'Open note on Rev #1', exact: true }).click();
  await expect(input).toHaveValue('Note for revision one.  ');
  await page.getByRole('button', { name: 'Post Comment', exact: true }).click();
  await expect(page.locator('.comments-section').getByRole('alert')).toContainText('Try posting again');
  await expect(input).toHaveValue('Note for revision one.  ');
  fail = false;
  await page.getByRole('button', { name: 'Post Comment', exact: true }).click();
  await expect(input).toHaveValue('');
  expect(posts).toEqual([{ revision: first.id, text: 'Note for revision one.' }, { revision: first.id, text: 'Note for revision one.' }]);
  await page.getByRole('button', { name: 'Open note on Rev #2', exact: true }).click();
  await expect(input).toHaveValue(textTwo);
  await input.fill('');
  await expect(page.getByRole('complementary', { name: 'Unsent discussion notes' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Campaigns', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(dialog).toHaveCount(0);
});

test('creating a new revision retains the unsent note on its original revision and pending posting blocks exit', async ({ page }) => {
  const first = FIXTURE_CONTENT_ITEM.revisions[0];
  let item = FIXTURE_CONTENT_ITEM;
  let revisionWrites = 0, noteWrites = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/me')) return route.fulfill({ json: { membership_id: item.creator_id, role: 'creator' } });
    if (path.endsWith(`/content/${item.id}`)) return route.fulfill({ json: item });
    if (path.endsWith('/processing-policy')) return route.fulfill({ json: FIXTURE_POLICY });
    if (path.endsWith('/revisions') && route.request().method() === 'POST') {
      revisionWrites++;
      const body = route.request().postDataJSON();
      item = { ...item, current_revision: 2, revisions: [first, { ...first, text: body.text, id: 'new-note-revision', number: 2 }] };
      return route.fulfill({ status: 201, json: item });
    }
    if (path.endsWith('/analysis')) return route.fulfill({ status: 503, json: { code: 'unavailable', message: 'Queue unavailable', details: {}, request_id: 'test' } });
    if (path.endsWith('/comments') && route.request().method() === 'POST') {
      noteWrites++;
      await gate;
      return route.fulfill({ status: 201, json: { ...route.request().postDataJSON(), id: 'posted-note', revision_id: first.id, author_id: item.creator_id, created_at: '2026-10-24T03:00:00Z' } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto(`/content/${item.id}`);
  const input = page.getByRole('textbox', { name: 'Add a discussion note' });
  await input.fill('An unsent note about the first revision.');
  await page.getByRole('button', { name: 'Edit draft', exact: true }).click();
  await page.getByLabel('Copy Text', { exact: true }).fill('A new campaign revision.');
  await page.getByRole('button', { name: 'Save all & recheck', exact: true }).click();
  await expect(page.getByRole('button', { name: /Rev #2/ })).toBeVisible();
  await expect(input).toHaveValue('');
  await page.getByRole('button', { name: 'Open note on Rev #1', exact: true }).click();
  await expect(input).toHaveValue('An unsent note about the first revision.');
  const started = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/comments'));
  await page.getByRole('button', { name: 'Post Comment', exact: true }).click();
  await started;
  await expect(input).toBeDisabled();
  await expect(page.getByRole('button', { name: /Rev #2/ }).first()).toBeDisabled();
  await page.getByRole('link', { name: 'Campaigns', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Leave with unsaved changes?' });
  await expect(dialog.getByRole('status')).toContainText('Posting your discussion note');
  await expect(dialog.getByRole('button', { name: 'Discard edits and leave' })).toBeDisabled();
  release();
  const finished = page.getByRole('dialog', { name: 'Leave this view?' });
  await expect(finished).toContainText('No unsaved work remains');
  await finished.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(input).toHaveValue('');
  await expect(input).toBeEnabled();
  await expect(page.getByRole('complementary', { name: 'Unsent discussion notes' })).toHaveCount(0);
  expect(revisionWrites).toBe(1);
  expect(noteWrites).toBe(1);
});

test('a note posting through a workspace refresh clears its cache and refreshes the remounted discussion', async ({ page }) => {
  const item = { ...FIXTURE_CONTENT_ITEM, latest_run_id: FIXTURE_REVIEW_RUN.id };
  let checks = FIXTURE_REVIEW_RUN.checks.map(check => ({ ...check, status: check.category === 'tone' ? 'unavailable' : 'complete' }));
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const text = 'A note retained during the category review refresh.';
  let posted = false;
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/me')) return route.fulfill({ json: { membership_id: item.reviewer_id, role: 'reviewer' } });
    if (path.endsWith(`/content/${item.id}`)) return route.fulfill({ json: item });
    if (path.includes('/runs/')) {
      if (path.endsWith('/manual-checks')) {
        checks = checks.map(check => ({ ...check, status: 'complete' }));
        return route.fulfill({ status: 201, json: {} });
      }
      return route.fulfill({ json: { ...FIXTURE_REVIEW_RUN, status: 'incomplete', checks } });
    }
    if (path.endsWith('/review')) return route.fulfill({ json: { evidence: { effective_checks: checks } } });
    if (path.endsWith('/processing-policy')) return route.fulfill({ json: FIXTURE_POLICY });
    const comment = { id: 'refreshed-comment', text, finding_id: null, revision_id: item.revisions[0].id, author_id: item.reviewer_id, created_at: '2026-10-24T03:00:00Z' };
    if (path.endsWith('/comments')) {
      if (route.request().method() === 'POST') {
        await gate; posted = true;
        return route.fulfill({ status: 201, json: comment });
      }
      return route.fulfill({ json: posted ? [comment] : [] });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto(`/content/${item.id}`);
  const input = page.getByRole('textbox', { name: 'Add a discussion note' });
  await input.fill(text);
  await page.getByRole('button', { name: 'Post Comment', exact: true }).click();
  await page.locator('.manual-check-card').getByRole('checkbox', { name: /relevant to this category/ }).first().check();
  await page.locator('#manual-rationale').fill('Inspected this revision against the approved tone guidance.');
  await page.getByRole('button', { name: 'Record manual check', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Manual category review' })).toHaveCount(0);
  await expect(input).toBeDisabled();
  await expect(input).toHaveValue(text);
  release();
  await expect(page.locator('.comments-section').getByText(text, { exact: true })).toBeVisible();
  await expect(input).toHaveValue('');
  await expect(input).toBeEnabled();
  await expect(page.getByRole('complementary', { name: 'Unsent discussion notes' })).toHaveCount(0);
});
