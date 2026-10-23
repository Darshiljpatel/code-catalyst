import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { FIXTURE_BRAND, FIXTURE_SOURCES } from '../src/api/fixtures';

test('source rule editor is labelled, keyboard-contained and fits a narrow screen', async ({ page }) => {
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/me')) return route.fulfill({ json: { membership_id: 'manager', role: 'manager' } });
    if (path.endsWith(`/brands/${FIXTURE_BRAND.id}`)) return route.fulfill({ json: FIXTURE_BRAND });
    return route.fulfill({ json: [] });
  });
  await page.goto(`/brands/${FIXTURE_BRAND.id}`);
  const trigger = page.locator('#btn-add-source');
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Add Brand Guideline Source Draft' });
  await expect(dialog.getByLabel('Rule 1 category')).toHaveValue('facts_claims');
  await dialog.getByRole('button', { name: 'Add Rule', exact: false }).click();
  await dialog.getByRole('button', { name: 'Add Rule', exact: false }).click();
  await dialog.getByRole('button', { name: 'Remove rule 2', exact: true }).click();
  await dialog.getByRole('button', { name: 'Add Rule', exact: false }).click();
  const ids = await dialog.locator('input[aria-label$=" ID"]').evaluateAll(elements => elements.map(element => (element as HTMLInputElement).value));
  expect(new Set(ids).size).toBe(ids.length);
  const audit = await new AxeBuilder({ page }).include('.source-authoring-dialog').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(audit.violations).toEqual([]);
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  for (let i = 0; i < 28; i++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('activation requires explicit review and rationale, locks during submission', async ({ page }) => {
  const source = { ...FIXTURE_SOURCES[0], state: 'draft' };
  let payload: { verified: boolean; rationale: string; expected_epoch: number } | undefined;
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/me')) return route.fulfill({ json: { membership_id: 'manager', role: 'manager' } });
    if (path.endsWith(`/brands/${FIXTURE_BRAND.id}`)) return route.fulfill({ json: FIXTURE_BRAND });
    if (path.endsWith('/sources')) return route.fulfill({ json: [source] });
    if (path.endsWith('/activate')) {
      payload = route.request().postDataJSON();
      await new Promise(resolve => setTimeout(resolve, 500));
      return route.fulfill({ json: { ...source, state: 'active' } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto(`/brands/${FIXTURE_BRAND.id}`);
  await page.getByRole('button', { name: /Activate/ }).first().click();
  const dialog = page.getByRole('dialog', { name: /Activate Guideline Source/ });
  const submit = dialog.getByRole('button', { name: 'Activate & Advance Epoch' });
  const verified = dialog.getByRole('checkbox', { name: /I reviewed this source/ });
  await expect(verified).not.toBeChecked();
  await expect(submit).toBeDisabled();
  await verified.check();
  await expect(submit).toBeDisabled();
  await dialog.getByLabel('Activation Audit Rationale', { exact: false }).fill('Reviewed the exact source against the active guideline set.');
  await submit.click();
  await expect(dialog.getByRole('button', { name: 'Activating…' })).toBeDisabled();
  await expect(verified).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCount(0);
  expect(payload).toMatchObject({ verified: true, expected_epoch: FIXTURE_BRAND.source_epoch });
});

test('source creation preserves whitespace around literal rule evidence', async ({ page }) => {
  const text = '  The trial lasts 14 days. No credit card is required.  \n';
  let submitted = '';
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/me')) return route.fulfill({ json: { membership_id: 'manager', role: 'manager' } });
    if (path.endsWith(`/brands/${FIXTURE_BRAND.id}`)) return route.fulfill({ json: FIXTURE_BRAND });
    if (path.endsWith('/sources') && route.request().method() === 'POST') {
      submitted = route.request().postDataJSON().text;
      return route.fulfill({ status: 201, json: { id: 'new-source' } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto(`/brands/${FIXTURE_BRAND.id}`);
  await page.locator('#btn-add-source').click();
  await page.locator('#txt-src-text').fill(text);
  await page.getByRole('button', { name: 'Create Source Draft' }).click();
  await expect.poll(() => submitted).toBe(text);
});
