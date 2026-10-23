import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { FIXTURE_CONTENT_ITEM } from '../src/api/fixtures';

test('manager assigns a real reviewer and recovers from concurrent workflow changes', async ({ page }) => {
  let role = 'manager', version = 1, assigned: string | null = null, failList = true, calls = 0;
  const payloads: { reviewer_id: string; expected_item_version: number; rationale: string }[] = [];
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/me')) return route.fulfill({ json: { membership_id: role === 'creator' ? FIXTURE_CONTENT_ITEM.creator_id : 'manager', role } });
    if (path.endsWith(`/content/${FIXTURE_CONTENT_ITEM.id}`)) return route.fulfill({ json: { ...FIXTURE_CONTENT_ITEM, workflow_version: version, reviewer_id: assigned } });
    if (path.endsWith('/processing-policy')) return route.fulfill({ json: { enabled: false, version: 0 } });
    if (path.endsWith('/reviewers')) {
      if (failList) return route.fulfill({ status: 503, json: {} });
      return route.fulfill({ json: [{ id: 'reviewer-one', user_id: 'review-user', email: 'reviewer@example.test' }] });
    }
    if (path.endsWith('/reviewer')) {
      calls++; payloads.push(route.request().postDataJSON());
      if (calls === 1) {
        version = 2;
        return route.fulfill({ status: 409, json: { code: 'workflow_changed', message: 'Review changed. Reload before continuing.', request_id: 'test', details: {} } });
      }
      assigned = 'reviewer-one'; version++;
      return route.fulfill({ json: { ...FIXTURE_CONTENT_ITEM, reviewer_id: assigned, workflow_version: version } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto(`/content/${FIXTURE_CONTENT_ITEM.id}`);
  await page.getByRole('button', { name: 'Assign reviewer', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Assign a reviewer', exact: true });
  await expect(dialog.getByRole('alert')).toContainText('Authorized reviewers could not be loaded');
  await expect(dialog.getByRole('button', { name: 'Save reviewer assignment' })).toBeDisabled();
  failList = false;
  await dialog.getByRole('button', { name: 'Refresh reviewer list' }).click();
  await dialog.getByLabel('Authorized reviewer', { exact: true }).selectOption('reviewer-one');
  await expect(dialog.getByRole('button', { name: 'Save reviewer assignment' })).toBeDisabled();
  await dialog.getByLabel('Assignment rationale', { exact: false }).fill('Assigning the campaign to a separate authorized reviewer.');
  const audit = await new AxeBuilder({ page }).include('[aria-labelledby="assignment-title"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(audit.violations).toEqual([]);
  await dialog.getByRole('button', { name: 'Save reviewer assignment' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Review changed');
  await expect(dialog.getByRole('button', { name: 'Save reviewer assignment' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Reload review' }).click();
  await page.getByRole('button', { name: 'Assign reviewer', exact: true }).click();
  await dialog.getByLabel('Authorized reviewer', { exact: true }).selectOption('reviewer-one');
  await dialog.getByLabel('Assignment rationale', { exact: false }).fill('Confirmed assignment after reloading the latest workflow version.');
  await dialog.getByRole('button', { name: 'Save reviewer assignment' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Change reviewer', exact: true })).toBeVisible();
  await expect(page.locator('.draft-notice')).toContainText('Reviewer assigned: reviewer@example.test');
  expect(payloads.map(payload => payload.expected_item_version)).toEqual([1, 2]);
  expect(payloads[1].reviewer_id).toBe('reviewer-one');
  // The creator's view exposes no manager-only reassignment control.
  role = 'creator';
  await page.reload();
  await expect(page.getByRole('button', { name: 'Change reviewer', exact: true })).toHaveCount(0);
});
