import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { FIXTURE_BRAND, FIXTURE_SOURCES } from '../src/api/fixtures';

const rule = (days: string) => ({ id: 'F01', category: 'facts_claims', kind: 'fact', key: 'trial_duration', value: `${days} days`, evidence_quote: `The free trial lasts ${days} days.` });
const diff = {
  added: [], removed: [], unchanged: 1,
  modified: [{ rule_id: 'F01', before: rule('14'), after: rule('30'), fields: ['value', 'evidence_quote'] }],
  from_source: { id: 'src-1', version: 1, title: 'LumaDesk guide', text: 'The free trial lasts 14 days.' },
  to_source: { id: 'src-2', version: 2, title: 'LumaDesk guide', text: 'The free trial lasts 30 days.' },
  retired_sources: [],
};
const counts = { confirmed: 1, likely: 1, possible: 1, total: 3, not_affected: 3, on_hold: 1, keep_approval: 1, brand_campaigns: 6 };
const assignment = (id: string, title: string, level: string, status: string, version = 2) => ({
  id, change_id: 'chg-1', item_id: `item-${id}`, title, item_state: status === 'resolved' ? 'approved' : 'in_review', creator_id: 'creator',
  revision_id: `rev-${id}`, prior_run_id: `run-${id}`, prior_decision_id: null, state_before: 'approved', impact_level: level,
  reasons: [{ code: 'local_findings_change', detail: 'Local checks give 0 new and 1 cleared findings under the new rules.' }],
  recheck_run_id: `recheck-${id}`, recheck_status: 'complete', findings_delta: { added: [], removed: [{ rule_id: 'F01', category: 'facts_claims', severity: 'blocker', start: 0, end: 5 }], unchanged: 2, new_blockers: 0 },
  reviewer_id: null, status, resolved_decision_id: null, superseded_by: null, version,
  created_at: '2026-10-28T00:00:00Z', updated_at: '2026-10-28T00:00:00Z', resolved_at: null,
});

test('publishing previews the impact, then the inbox shows the rule diff, bulk assignment and progress', async ({ page }) => {
  const source = { ...FIXTURE_SOURCES[0], state: 'draft' };
  let assigned: unknown;
  let resolved = false;
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path.endsWith('/me')) return route.fulfill({ json: { membership_id: 'manager', role: 'manager' } });
    if (path.endsWith(`/brands/${FIXTURE_BRAND.id}`)) return route.fulfill({ json: FIXTURE_BRAND });
    if (path.endsWith('/sources')) return route.fulfill({ json: [source] });
    if (path.endsWith('/impact-preview')) return route.fulfill({ json: {
      source_id: source.id, brand_id: FIXTURE_BRAND.id, expected_epoch: FIXTURE_BRAND.source_epoch, retired_source_ids: ['src-1'], diff, counts,
      entries: [
        { item_id: 'item-a', title: 'Spring trial email', state: 'approved', creator_id: 'c', reviewer_id: 'r', revision_id: 'x', prior_run_id: 'y', impact_level: 'confirmed', reasons: [], local_delta: null },
        { item_id: 'item-b', title: 'Free trial banner', state: 'ready_for_review', creator_id: 'c', reviewer_id: null, revision_id: 'x', prior_run_id: 'y', impact_level: 'likely', reasons: [], local_delta: null },
        { item_id: 'item-c', title: 'Desk tidy post', state: 'approved', creator_id: 'c', reviewer_id: 'r', revision_id: 'x', prior_run_id: 'y', impact_level: 'possible', reasons: [], local_delta: null, routing: 'keep' },
      ] } });
    if (path.endsWith('/activate')) return route.fulfill({ json: { ...source, state: 'active', change_id: 'chg-1', impact_counts: counts } });
    if (path.endsWith('/reviewers')) return route.fulfill({ json: [{ id: 'reviewer-1', user_id: 'u', email: 'reviewer@lumadesk.test' }] });
    if (path.endsWith('/recheck-assignments/reviewer')) {
      assigned = route.request().postDataJSON();
      resolved = true;
      return route.fulfill({ json: [] });
    }
    if (path.endsWith('/guideline-changes/chg-1')) {
      const kept = { ...assignment('c', 'Desk tidy post', 'possible', 'resolved'), routing: 'keep', outcome: 'kept_approval',
        reasons: [{ code: 'category_checked', detail: "The last review checked this guideline's categories." }],
        findings_delta: { added: [], removed: [], unchanged: 1, new_blockers: 0 }, resolved_decision_id: 'kept-decision' };
      const rows = [assignment('a', 'Spring trial email', 'confirmed', resolved ? 'resolved' : 'awaiting_reviewer'), assignment('b', 'Free trial banner', 'likely', 'awaiting_reviewer'), kept];
      return route.fulfill({ json: { id: 'chg-1', brand_id: FIXTURE_BRAND.id, source_key: 'brand_guide', from_source_id: 'src-1', to_source_id: 'src-2',
        title: 'LumaDesk guide', from_version: 1, to_version: 2, status: 'open', impact_counts: counts, resolved: resolved ? 2 : 1, total: 3,
        created_by: 'manager', created_at: '2026-10-28T00:00:00Z', closed_at: null, diff, assignments: rows } });
    }
    if (path.endsWith('/guideline-changes')) return route.fulfill({ json: [] });
    return route.fulfill({ json: [] });
  });
  await page.goto(`/brands/${FIXTURE_BRAND.id}`);
  await page.getByRole('button', { name: /Activate/ }).first().click();
  const dialog = page.getByRole('dialog', { name: /Publish guideline update/ });
  await expect(dialog).toContainText('3 campaigns used this guideline: 1 will need re-review, 1 will keep approval.');
  await expect(dialog).toContainText('Spring trial email');
  await expect(dialog).toContainText('Desk tidy post (approved, keeps approval if unchanged)');
  await dialog.getByRole('checkbox', { name: /I reviewed this source/ }).check();
  await dialog.getByLabel('Reason for this update', { exact: false }).fill('The trial was extended to 30 days by marketing.');
  await dialog.getByRole('button', { name: 'Publish guideline update' }).click();
  await expect(page).toHaveURL(/\/rechecks\/chg-1$/);
  await expect(page.getByRole('heading', { name: /LumaDesk guide: v1 → v2/ })).toBeVisible();
  const diffTable = page.locator('.rule-diff__table');
  await expect(diffTable).toContainText('14 days');
  await expect(diffTable).toContainText('30 days');
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '33');
  // The possible-level campaign was rechecked with unchanged findings and kept its approval, visibly.
  const keptRow = page.locator('.recheck-table tbody tr', { hasText: 'Desk tidy post' });
  await expect(keptRow).toContainText('Kept approval: no change found');
  await expect(keptRow.getByRole('checkbox')).toBeDisabled();
  await expect(page.locator('.rechecks-page__lede')).toContainText('1 needed re-review; 1 could keep approval and 1 kept it after a recheck found no change.');
  const audit = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(audit.violations.filter(v => ['serious', 'critical'].includes(v.impact || ''))).toEqual([]);
  await page.getByRole('checkbox', { name: 'Select all open rechecks shown' }).check();
  await page.getByLabel('Assign selected to').selectOption('reviewer-1');
  await page.getByRole('button', { name: 'Assign 2 selected' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Assigned 2 rechecks' })).toBeVisible();
  expect(assigned).toEqual({ assignment_ids: ['a', 'b'], reviewer_id: 'reviewer-1', expected_versions: { a: 2, b: 2 } });
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '67');
  await page.getByRole('button', { name: 'Likely (1)' }).click();
  await expect(page.locator('.recheck-table tbody tr')).toHaveCount(1);
});

test('a creator sees why a recheck is needed and what to do next', async ({ page }) => {
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/me')) return route.fulfill({ json: { membership_id: 'creator', role: 'creator' } });
    if (path.endsWith('/content/item-a')) return route.fulfill({ json: {
      id: 'item-a', brand_id: FIXTURE_BRAND.id, title: 'Spring trial email', creator_id: 'creator', reviewer_id: 'reviewer', current_revision: 1,
      workflow_version: 4, approval_stale: false, state: 'in_review', latest_run_id: null,
      revisions: [{ id: 'rev-a', item_id: 'item-a', number: 1, author_id: 'creator', text: 'Start a 30-day free trial.', text_hash: 'h', channel: 'email', audience: 'all', purpose: 'promo', created_at: '2026-10-28T00:00:00Z' }],
      recheck: { assignment_id: 'a', change_id: 'chg-1', status: 'awaiting_reviewer', impact_level: 'confirmed', state_before: 'approved',
        reasons: [{ code: 'finding_cites_changed_rule', detail: 'The last review flagged rule F01, which changed.' }],
        findings_delta: { added: [], removed: [{ rule_id: 'F01', category: 'facts_claims', severity: 'blocker', start: 0, end: 5 }], unchanged: 0, new_blockers: 0 },
        guideline_title: 'LumaDesk guide', from_version: 1, to_version: 2, changed_rules: 1, changed_at: '2026-10-28T00:00:00Z' } } });
    return route.fulfill({ json: [] });
  });
  await page.goto('/content/item-a');
  const banner = page.getByRole('region', { name: /Recheck required/ });
  await expect(banner).toContainText('The last review flagged rule F01, which changed.');
  await expect(banner).toContainText('cannot be exported until it is re-approved');
  await expect(banner).toContainText('Nothing to change: your copy still passes.');
  await expect(banner).toContainText('1 cleared');
});

test('a campaign that keeps its approval says so while it is rechecked', async ({ page }) => {
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/me')) return route.fulfill({ json: { membership_id: 'creator', role: 'creator' } });
    if (path.endsWith('/content/item-c')) return route.fulfill({ json: {
      id: 'item-c', brand_id: FIXTURE_BRAND.id, title: 'Desk tidy post', creator_id: 'creator', reviewer_id: 'reviewer', current_revision: 1,
      workflow_version: 4, approval_stale: false, state: 'approved', latest_run_id: null,
      revisions: [{ id: 'rev-c', item_id: 'item-c', number: 1, author_id: 'creator', text: 'LumaDesk keeps your desk tidy.', text_hash: 'h', channel: 'email', audience: 'all', purpose: 'promo', created_at: '2026-10-28T00:00:00Z' }],
      recheck: { assignment_id: 'c', change_id: 'chg-1', status: 'recheck_queued', impact_level: 'possible', state_before: 'approved', routing: 'keep',
        reasons: [{ code: 'category_checked', detail: "The last review checked this guideline's categories." }], findings_delta: null,
        guideline_title: 'LumaDesk guide', from_version: 1, to_version: 2, changed_rules: 1, changed_at: '2026-10-28T00:00:00Z' } } });
    return route.fulfill({ json: [] });
  });
  await page.goto('/content/item-c');
  const banner = page.getByRole('region', { name: /Rechecking/ });
  await expect(banner).toContainText('keeps its approval while BrandGuard rechecks it');
  await expect(banner).toContainText('goes back to the reviewer only if the recheck finds a change');
  await expect(banner).toContainText('Nothing to do.');
  await expect(banner).not.toContainText('on hold');
});
