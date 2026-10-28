import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { decodeDraftFile, MAX_DRAFT_FILE_BYTES } from '../src/api/importDraft';
import { FIXTURE_BRAND, FIXTURE_CONTENT_ITEM } from '../src/api/fixtures';

test('text decoder preserves content and rejects unsupported, empty, binary and oversized inputs', () => {
  const text = '✨ café\r\n  Draft\tcopy.  ';
  expect(decodeDraftFile('draft.TXT', new TextEncoder().encode(text))).toBe(text);
  expect(decodeDraftFile('draft.md', new TextEncoder().encode('# Heading\nDraft'))).toBe('# Heading\nDraft');
  for (const [name, bytes] of [
    ['file.rtf', new Uint8Array([65])], ['empty.txt', new Uint8Array()],
    ['blank.txt', new TextEncoder().encode(' \n\t')], ['binary.txt', new Uint8Array([0, 65])],
    ['invalid.txt', new Uint8Array([255, 254])],
    ['large.txt', new Uint8Array(MAX_DRAFT_FILE_BYTES + 1)],
    ['long.txt', new TextEncoder().encode('a'.repeat(100001))],
  ] as const) expect(() => decodeDraftFile(name, bytes)).toThrow();
});

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/me')) return route.fulfill({ json: { membership_id: FIXTURE_CONTENT_ITEM.creator_id, role: 'creator' } });
    if (path.endsWith('/brands')) return route.fulfill({ json: [FIXTURE_BRAND] });
    if (path.endsWith('/processing-policy')) return route.fulfill({ json: { enabled: false, version: 0 } });
    if (path.endsWith(`/content/${FIXTURE_CONTENT_ITEM.id}`)) return route.fulfill({ json: FIXTURE_CONTENT_ITEM });
    return route.fulfill({ json: [] });
  });
});

test('local preview requires confirmation and submission preserves imported text', async ({ page }) => {
  let creates = 0, payloadText = '';
  await page.route('**/api/v1/content', route => {
    creates++; payloadText = route.request().postDataJSON().text;
    return route.fulfill({ status: 201, json: FIXTURE_CONTENT_ITEM });
  });
  await page.goto('/review/new');
  const current = page.locator('#txt-content-text');
  const original = await current.inputValue();
  const file = page.getByLabel('Choose draft file');
  const text = '✨ Café launch.\n<script>window.importExecuted = true</script>  ';
  await file.setInputFiles({ name: 'campaign.md', mimeType: 'text/markdown', buffer: Buffer.from(text) });
  await expect(page.getByLabel('Imported draft preview')).toHaveValue(text);
  await expect(current).toHaveValue(original);
  expect(creates).toBe(0);
  await page.getByRole('button', { name: 'Cancel import' }).click();
  await expect(page.getByLabel('Imported draft preview')).toHaveCount(0);
  await expect(current).toHaveValue(original);
  await file.setInputFiles({ name: 'campaign.md', mimeType: 'text/markdown', buffer: Buffer.from(text) });
  await page.getByRole('button', { name: 'Replace draft with imported text' }).click();
  await expect(current).toHaveValue(text);
  expect(creates).toBe(0);
  expect(await page.evaluate(() => 'importExecuted' in window)).toBe(false);
  const audit = await new AxeBuilder({ page }).include('.draft-import').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(audit.violations).toEqual([]);
  await page.locator('#btn-submit-review').click();
  await expect.poll(() => creates).toBe(1);
  expect(payloadText).toBe(text);
});

test('rejected files and late reads never overwrite the current draft or newer preview', async ({ page }) => {
  await page.goto('/review/new');
  const file = page.getByLabel('Choose draft file');
  const current = page.locator('#txt-content-text');
  await current.fill('My unsaved campaign copy.');
  for (const upload of [
    { name: 'not-text.rtf', mimeType: 'application/rtf', buffer: Buffer.from('document') },
    { name: 'bad.txt', mimeType: 'text/plain', buffer: Buffer.from([255, 254]) },
    { name: 'large.txt', mimeType: 'text/plain', buffer: Buffer.alloc(MAX_DRAFT_FILE_BYTES + 1) },
  ]) {
    await file.setInputFiles(upload);
    await expect(page.locator('.draft-import').getByRole('alert')).toBeVisible();
    await expect(current).toHaveValue('My unsaved campaign copy.');
    await expect(page.getByLabel('Imported draft preview')).toHaveCount(0);
  }
  await page.evaluate(() => {
    const original = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = async function () {
      if (this.name === 'slow.txt') await new Promise(resolve => setTimeout(resolve, 700));
      return original.call(this);
    };
  });
  await file.setInputFiles({ name: 'slow.txt', mimeType: 'text/plain', buffer: Buffer.from('Obsolete import') });
  await file.setInputFiles({ name: 'new.txt', mimeType: 'text/plain', buffer: Buffer.from('New preview') });
  await expect(page.getByLabel('Imported draft preview')).toHaveValue('New preview');
  await page.waitForTimeout(900); // Let the delayed obsolete File read finish.
  await expect(page.getByLabel('Imported draft preview')).toHaveValue('New preview');
  await expect(current).toHaveValue('My unsaved campaign copy.');
});

test('PDF and Word drafts are extracted on the server, previewed with warnings and linked to the campaign', async ({ page }) => {
  let createPayload: Record<string, unknown> = {};
  await page.route('**/api/v1/imports/document', route => {
    if (route.request().postDataBuffer()?.includes('scan.pdf')) {
      return route.fulfill({ status: 422, json: { code: 'no_text_layer', message: 'No text was found. Scanned PDFs need OCR.', request_id: 'r', details: {} } });
    }
    return route.fulfill({ status: 201, json: {
      id: 'import-1', filename: 'Spring launch.pdf', media_type: 'application/pdf', size_bytes: 900,
      original_sha256: 'ab'.repeat(32), text: 'LumaDesk spring launch\n\nCalm tools for small teams', text_hash: 'cd'.repeat(32),
      pages: 3, blocks: [{ page: 1, paragraph: 1, start: 0, end: 22 }, { page: 3, paragraph: 1, start: 24, end: 50 }],
      warnings: ['1 page had no text layer and was skipped.'], created_at: '2026-10-28T05:00:00Z' } });
  });
  await page.route('**/api/v1/content', route => {
    createPayload = route.request().postDataJSON();
    return route.fulfill({ status: 201, json: FIXTURE_CONTENT_ITEM });
  });
  await page.goto('/review/new');
  const file = page.getByLabel('Choose draft file');
  const current = page.locator('#txt-content-text');
  await current.fill('Unsaved copy.');
  await file.setInputFiles({ name: 'scan.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 scan') });
  await expect(page.locator('.draft-import').getByRole('alert')).toContainText('Scanned PDFs need OCR');
  await expect(current).toHaveValue('Unsaved copy.');
  await file.setInputFiles({ name: 'Spring launch.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 text') });
  await expect(page.getByLabel('Imported draft preview')).toHaveValue('LumaDesk spring launch\n\nCalm tools for small teams');
  await expect(page.locator('.draft-import')).toContainText('3 pages, 2 paragraphs found');
  await expect(page.locator('.draft-import')).toContainText('1 page had no text layer');
  await page.getByRole('button', { name: 'Replace draft with imported text' }).click();
  await expect(current).toHaveValue('LumaDesk spring launch\n\nCalm tools for small teams');
  await page.locator('#btn-submit-review').click();
  await expect.poll(() => createPayload.document_import_id).toBe('import-1');
});

test('a scanned PDF without a text layer can be checked as an image campaign', async ({ page }) => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await page.route('**/api/v1/imports/document', route => route.fulfill({ status: 422,
    json: { code: 'no_text_layer', message: 'No text was found. Scanned PDFs need OCR.', request_id: 'r', details: {} } }));
  await page.route('**/api/v1/imports/scanned-page', route => route.fulfill({ status: 200, contentType: 'image/png',
    headers: { 'x-scanned-page': '1' }, body: png }));
  await page.goto('/review/new');
  await page.getByLabel('Choose draft file').setInputFiles({ name: 'flyer.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 scan') });
  await expect(page.locator('.draft-import').getByRole('alert')).toContainText('Scanned PDFs need OCR');
  await page.getByRole('button', { name: 'Check this scan as an image campaign' }).click();
  await expect(page.getByRole('button', { name: 'Image campaign' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByAltText('Preview of the chosen campaign image')).toBeVisible();
});
