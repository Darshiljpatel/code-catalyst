import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import path from 'node:path';
import { FIXTURE_BRAND } from '../src/api/fixtures';

const sample = fs.readFileSync(path.join(process.cwd(), 'public/samples/lumadesk-social-ad.png'));
const image = { asset_id: 'asset-1', sha256: 'a'.repeat(64), original_sha256: 'b'.repeat(64), mime: 'image/png', width: 1080, height: 1080,
  intake: { channel: 'social', audience: 'Small teams', purpose: 'Launch ad' }, ocr_status: 'complete', ocr_result_id: 'ocr-1' };
const lines = [
  { id: 'r1', text: 'LUMADESK', confidence: 0.95, box: { x: 0.05, y: 0.03, w: 0.3, h: 0.07 } },
  { id: 'r2', text: 'Start your 3O-day free trial', confidence: 0.61, box: { x: 0.05, y: 0.43, w: 0.7, h: 0.06 } },
];
const base = { id: 'item-1', brand_id: FIXTURE_BRAND.id, title: 'LumaDesk social ad', creator_id: 'creator', reviewer_id: null,
  current_revision: 0, workflow_version: 2, approval_stale: false, latest_run_id: null, recheck: null, image };
const regionMap = [
  { region_id: 'r1', box: lines[0].box, ocr_text: 'LUMADESK', final_text: 'LUMADESK', confidence: 0.95, origin: 'ocr', start: 0, end: 8 },
  { region_id: 'r2', box: lines[1].box, ocr_text: 'Start your 3O-day free trial', final_text: 'Start your 30-day free trial', confidence: 0.61, origin: 'corrected', start: 9, end: 37 },
];
const revision = { id: 'rev-1', item_id: 'item-1', number: 1, author_id: 'creator', text: 'LUMADESK\nStart your 30-day free trial', text_hash: 'h',
  channel: 'social', audience: 'Small teams', purpose: 'Launch ad', created_at: '2026-10-28T00:00:00Z', asset_id: 'asset-1', asset_sha256: 'a'.repeat(64), region_map: regionMap };

test('an image campaign is uploaded, its uncertain line confirmed and corrected, and findings light up their region', async ({ page }) => {
  let confirmed: { regions: { region_id: string; text: string; origin: string; confirmed: boolean }[]; deleted_line_ids: string[] } | undefined;
  let state: 'text_check' | 'draft' = 'text_check';
  let uploaded = false;
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    if (p.endsWith('/me')) return route.fulfill({ json: { membership_id: 'creator', role: 'creator' } });
    if (p.endsWith('/brands')) return route.fulfill({ json: [FIXTURE_BRAND] });
    if (p.endsWith('/content/image')) {
      uploaded = (route.request().postDataBuffer()?.length ?? 0) > sample.length;
      return route.fulfill({ status: 202, json: { ...base, state: 'ocr_pending', revisions: [], image: { ...image, ocr_status: 'queued' } } });
    }
    if (p.endsWith('/assets/asset-1/ocr')) return route.fulfill({ json: { id: 'ocr-1', asset_id: 'asset-1', status: 'complete', engine: 'tesseract',
      engine_version: 'tesseract 5.3.4', params: {}, lines, mean_confidence: 0.78, error_code: null, low_confidence_threshold: 0.8,
      created_at: '2026-10-28T00:00:00Z', completed_at: '2026-10-28T00:00:01Z' } });
    if (p.endsWith('/assets/asset-1')) return route.fulfill({ body: sample, contentType: 'image/png' });
    if (p.endsWith('/content/item-1/image-revisions')) {
      confirmed = route.request().postDataJSON();
      state = 'draft';
      return route.fulfill({ status: 201, json: { ...base, state, current_revision: 1, revisions: [revision] } });
    }
    if (p.endsWith('/content/item-1')) {
      if (state === 'text_check') return route.fulfill({ json: { ...base, state, revisions: [] } });
      return route.fulfill({ json: { ...base, state: 'needs_changes', current_revision: 1, latest_run_id: 'run-1', revisions: [revision] } });
    }
    if (p.endsWith('/runs/run-1')) return route.fulfill({ json: { id: 'run-1', revision_id: 'rev-1', source_epoch: 1, source_snapshot: [], status: 'complete',
      created_at: '2026-10-28T00:00:00Z', stale: false, processing_snapshot: { enabled: false }, engine_metadata: {},
      checks: [{ category: 'facts_claims', status: 'complete', reason: 'ok' }],
      findings: [{ id: 'f-1', revision_id: 'rev-1', run_id: 'run-1', category: 'facts_claims', severity: 'blocker', evidence_status: 'contradicted',
        origin: 'deterministic', source_version_id: 's1', rule_id: 'F01', evidence_quote: 'The free trial lasts 14 days.',
        location: { block_id: 'text', start: 20, end: 26, quote: '30-day', regions: ['r2'] }, rationale: 'The approved trial is 14 days.', suggested_edit: '14-day', resolution: 'unresolved' }] } });
    if (p.endsWith('/review')) return route.fulfill({ json: { run_id: 'run-1', workflow_version: 3, stale: false, decisions: [],
      evidence: { effective_checks: [{ category: 'facts_claims', status: 'complete', reason: 'ok', origin: 'automated' }] } } });
    return route.fulfill({ json: [] });
  });
  await page.goto('/review/new');
  await page.getByRole('button', { name: 'Image campaign' }).click();
  await page.getByRole('button', { name: 'Try the sample ad' }).click();
  await expect(page.getByAltText('Preview of the chosen campaign image')).toBeVisible();
  await page.getByRole('button', { name: 'Upload and read text →' }).click();
  await expect(page).toHaveURL(/\/content\/item-1$/);
  expect(uploaded).toBe(true);
  const editor = page.getByRole('region', { name: 'Check extracted text' });
  await expect(editor.getByRole('button', { name: /Region 2: “Start your 3O-day free trial”, ⚠ Check this line/ })).toBeVisible();
  const confirm = editor.getByRole('button', { name: 'Confirm 1 highlighted line first' });
  await expect(confirm).toBeDisabled();
  const audit = await new AxeBuilder({ page }).include('.ocr-editor').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(audit.violations.filter(v => ['serious', 'critical'].includes(v.impact || ''))).toEqual([]);
  // Keyboard: arrow keys move between regions, Enter edits the line.
  await editor.getByRole('button', { name: /Region 1:/ }).focus();
  await page.keyboard.press('ArrowDown');
  await expect(editor.getByRole('button', { name: /Region 2:/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(editor.getByLabel('Text of region 2')).toBeFocused();
  await editor.getByLabel('Text of region 2').fill('Start your 30-day free trial');
  await expect(editor.getByText('Read as “Start your 3O-day free trial”')).toBeVisible();
  await editor.getByRole('button', { name: 'Confirm text' }).click();
  await expect(page.locator('.image-pane')).toBeVisible();
  expect(confirmed?.regions.map(r => [r.region_id, r.text, r.origin, r.confirmed])).toEqual([
    ['r1', 'LUMADESK', 'ocr', true], ['r2', 'Start your 30-day free trial', 'corrected', true]]);
  await page.reload();
  await page.getByRole('button', { name: /Claims: 30-day/ }).first().click();
  await expect(page.locator('.image-pane .ocr-box--active')).toHaveCount(1);
  await expect(page.locator('.image-pane .ocr-box--active')).toHaveAttribute('aria-label', /Start your 30-day free trial/);
});
