import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { FIXTURE_ME_CREATOR } from '../src/api/fixtures';

test('a downloaded audit record is verified and tampering is named in plain language', async ({ page }) => {
  let sent: Record<string, unknown> = {};
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/me')) return route.fulfill({ json: FIXTURE_ME_CREATOR });
    if (path.endsWith('/verify/approval-record')) {
      sent = route.request().postDataJSON();
      const tampered = String(sent.text).includes('50% off');
      return route.fulfill({ json: { verified: !tampered, still_current: !tampered, decision_id: 'd1', content_id: 'c1', checks: [
        { code: 'decision_found', passed: true, message: 'This workspace recorded this decision.' },
        { code: 'text_unchanged', passed: !tampered, message: tampered ? 'The text differs from the approved text, even if only slightly.' : 'The text is exactly the text that was approved.' },
      ] } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto('/verify');
  await expect(page.getByRole('heading', { name: 'Verify an approval record' })).toBeVisible();
  await page.getByLabel('Or paste the record').fill('not json');
  await page.getByRole('button', { name: 'Verify record' }).click();
  await expect(page.getByRole('alert')).toContainText('This is not a BrandGuard audit record');
  const record = { revision_id: 'r1', text: 'Try LumaDesk.', text_hash: 'h', decision: { id: 'd1' }, evidence_record: {} };
  await page.getByLabel('Audit record file (.json)').setInputFiles({ name: 'record.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(record)) });
  await expect(page.getByLabel('Or paste the record')).toHaveValue(JSON.stringify(record));
  await page.getByRole('button', { name: 'Verify record' }).click();
  const result = page.getByRole('region', { name: 'Verification result' });
  await expect(result).toContainText('Verified: this is the approved text and evidence');
  expect(sent.revision_id).toBe('r1');
  const axe = await new AxeBuilder({ page }).include('#main-content').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(axe.violations).toEqual([]);
  await page.getByLabel('Or paste the record').fill(JSON.stringify({ ...record, text: 'Try LumaDesk. Now 50% off!' }));
  await page.getByRole('button', { name: 'Verify record' }).click();
  await expect(result).toContainText('Not verified');
  await expect(result).toContainText('The text differs from the approved text');
});
