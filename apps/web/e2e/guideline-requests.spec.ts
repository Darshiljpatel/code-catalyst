import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { FIXTURE_BRAND } from '../src/api/fixtures';

const rule = { id: 'T01', category: 'terminology', kind: 'terminology', key: 'product_name', value: 'LumaDesk', evidence_quote: 'Write LumaDesk.' };
const base = { id: 'src-1', brand_id: FIXTURE_BRAND.id, source_key: 'brand_guide', version: 1, owner_id: 'manager', title: 'LumaDesk guide',
  text: 'Write LumaDesk.', text_hash: 'h', rules: [rule], valid_from: '2026-10-01T00:00:00Z', valid_until: null, state: 'active',
  created_at: '2026-10-01T00:00:00Z', activated_by: 'manager', activated_at: '2026-10-01T00:00:00Z' };
const gates = { has_draft: false, comparison_current: false, comparison_run_id: null, approval_current: false, regressions: 0, base_changed: false, can_activate: false };

function requestBody(stage: number, me: string) {
  const draft = stage >= 1 ? { ...base, id: 'src-2', version: 2, state: 'draft', owner_id: 'manager', rules: [{ ...rule, allowed_variants: ['LUMADESK'] }] } : null;
  const comparison = stage >= 2 ? [{ id: 'cmp-1', request_id: 'req-1', proposed_source_id: 'src-2', proposed_hash: 'd', example_set_id: 'set-1', status: 'complete', current: true,
    created_by: 'manager', created_at: '2026-10-28T00:00:00Z', summary: {
      counts: { fixed: 3, regressed: 0, unchanged: 1, unstable: 0, changed: 0, not_run: 0 }, verdict: 'Fixes 3 examples, 0 regressions, 0 unstable cases.',
      live_metrics: { true_positives: 1, false_positives: 3, false_negatives: 0, precision: 0.25, recall: 1 },
      proposed_metrics: { true_positives: 1, false_positives: 0, false_negatives: 0, precision: 1, recall: 1 },
      ai: { status: 'not_run', reason: 'AI comparison is not enabled; local checks only, so results are repeatable.' },
      cases: [{ case_id: 'c1', label: 'Dispute: LUMADESK', text: 'LUMADESK. Your desk, sorted.', expectations: [{ source_key: 'brand_guide', rule_id: 'T01', expected: 'no_flag' }],
        live: [{ rule_id: 'T01', category: 'terminology', severity: 'blocker', start: 0, end: 8, quote: 'LUMADESK' }], proposed: [], verdict: 'fixed' }] } }] : [];
  return { id: 'req-1', brand_id: FIXTURE_BRAND.id, source_key: 'brand_guide', rule_id: 'T01', title: 'All-caps brand name in headlines', status: stage >= 3 ? 'approved' : 'open',
    created_by: 'manager', assignee_id: null, created_at: '2026-10-28T00:00:00Z', updated_at: '2026-10-28T00:00:00Z', example_count: 1,
    problem: '3 campaigns disputed this rule in the last 30 days.', base_source_id: 'src-1', draft_source_id: draft?.id ?? null, draft_hash: draft ? 'd' : null,
    change_id: null, version: stage + 1, signals: {}, base_source: base, draft_source: draft,
    examples: [{ id: 'ex-1', item_id: 'item-1', revision_id: 'rev-1', finding_id: 'f-1', kind: 'dispute', excerpt: 'LUMADESK',
      dispute: { actor_id: 'creator', action: 'request_dismissal', rationale: 'Headline style uses capitals.' }, expected: stage >= 1 ? 'no_flag' : 'unsure', labelled_by: null }],
    diff: draft ? { added: [], removed: [], unchanged: 0, modified: [{ rule_id: 'T01', before: rule, after: draft.rules[0], fields: ['allowed_variants'] }],
      from_source: { id: 'src-1', version: 1, title: 'LumaDesk guide', text: 'Write LumaDesk.' }, to_source: { id: 'src-2', version: 2, title: 'LumaDesk guide', text: 'Write LumaDesk.' }, retired_sources: [] } : null,
    comparisons: comparison,
    reviews: stage >= 3 ? [{ id: 'rv-1', reviewer_id: 'lead', decision: 'approved', rationale: 'Checked the comparison carefully.', draft_hash: 'd', comparison_run_id: 'cmp-1', current: true, created_at: '2026-10-28T00:00:00Z' }] : [],
    activity: [{ action: 'guideline_request.created', actor_id: 'manager', created_at: '2026-10-28T00:00:00Z', details: {} }],
    gates: { ...gates, has_draft: stage >= 1, comparison_current: stage >= 2, comparison_run_id: stage >= 2 ? 'cmp-1' : null, approval_current: stage >= 3, can_activate: stage >= 3 && me !== 'x' } };
}

test('a likely unclear rule becomes a request, gets a clearer draft, a comparison and stays gated until a second person approves', async ({ page }) => {
  let stage = 0;
  let me = 'manager';
  const calls: string[] = [];
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (path.endsWith('/me')) return route.fulfill({ json: { membership_id: me, role: 'manager' } });
    if (path.endsWith('/guideline-health')) return route.fulfill({ json: { brand_id: FIXTURE_BRAND.id, window_days: 30, unclear_threshold: 3,
      dispute_definition: 'Counted once per campaign.', open_requests: [], rules: [{ source_id: 'src-1', source_key: 'brand_guide', source_title: 'LumaDesk guide',
        rule_id: 'T01', category: 'terminology', kind: 'terminology', value: 'LumaDesk', flagged_items: 3, confirmed_items: 0, disputed_items: 3,
        ambiguity_reports: 1, dispute_rate: 1, likely_unclear: true, open_request_id: null }] } });
    if (path.endsWith(`/brands/${FIXTURE_BRAND.id}`)) return route.fulfill({ json: FIXTURE_BRAND });
    if (path.endsWith('/example-sets')) return route.fulfill({ json: [{ id: 'set-1', brand_id: FIXTURE_BRAND.id, name: 'Saved examples', cases: [] }] });
    if (path.endsWith('/guideline-requests') && method === 'POST') { calls.push('create'); return route.fulfill({ status: 201, json: requestBody(stage, me) }); }
    if (path.endsWith('/guideline-requests/req-1/draft')) { calls.push('draft'); stage = 1; return route.fulfill({ json: requestBody(stage, me) }); }
    if (path.endsWith('/guideline-requests/req-1/comparisons')) { calls.push('compare'); stage = 2; return route.fulfill({ status: 201, json: requestBody(stage, me).comparisons[0] }); }
    if (path.endsWith('/guideline-requests/req-1/reviews')) { calls.push('review'); stage = 3; return route.fulfill({ status: 201, json: requestBody(stage, me) }); }
    if (path.endsWith('/guideline-requests/req-1')) return route.fulfill({ json: requestBody(stage, me) });
    return route.fulfill({ json: [] });
  });
  await page.goto(`/brands/${FIXTURE_BRAND.id}/health`);
  await expect(page.locator('.impact-badge').filter({ hasText: 'Likely unclear' })).toBeVisible();
  const audit = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(audit.violations.filter(v => ['serious', 'critical'].includes(v.impact || ''))).toEqual([]);
  await page.getByRole('button', { name: 'Create improvement request for rule T01' }).click();
  await expect(page).toHaveURL(/\/requests\/req-1$/);
  await expect(page.getByText('Headline style uses capitals.')).toBeVisible();
  await page.getByLabel('Also allowed (exact spellings, comma separated)').fill('LUMADESK');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.locator('.rule-diff__table')).toContainText('LUMADESK');
  await expect(page.getByText('You drafted this rule, so a different manager or an admin must approve it.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publish clearer guideline' })).toBeDisabled();
  await page.getByRole('button', { name: 'Run comparison' }).click();
  await expect(page.getByText('Fixes 3 examples, 0 regressions, 0 unstable cases.')).toBeVisible();
  await expect(page.locator('.recheck-table').last()).toContainText('Fixed');
  // The brand lead (a second manager) reviews.
  me = 'lead';
  await page.reload();
  await page.getByLabel('Your rationale').fill('Checked the comparison and the allowed variant.');
  await page.getByRole('button', { name: 'Approve this draft' }).click();
  await expect(page.getByRole('button', { name: 'Publish clearer guideline' })).toBeEnabled();
  expect(calls).toEqual(['create', 'draft', 'compare', 'review']);
});
