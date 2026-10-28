import { test, expect } from '@playwright/test';

test('sign-in works without a workspace ID and explains when one is needed', async ({ page }) => {
  const payloads: Record<string, unknown>[] = [];
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/sessions') && route.request().method() === 'POST') {
      payloads.push(route.request().postDataJSON());
      return route.fulfill({ status: 422, json: { code: 'workspace_required', request_id: 'r', details: {},
        message: 'This account belongs to more than one workspace. Enter the workspace ID.' } });
    }
    return route.fulfill({ status: 401, json: { code: 'unauthenticated', message: 'Sign in', request_id: 'r', details: {} } });
  });
  await page.goto('/login');
  await page.getByLabel('Email').fill('creator@lumadesk.test');
  await page.getByLabel('Password').fill('a-password');
  const submit = page.locator('#btn-login-submit');
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByText('Enter the workspace ID.')).toBeVisible();
  expect(payloads[0]).not.toHaveProperty('org_id');
  await expect(page.getByLabel('Workspace ID')).toHaveAccessibleDescription('Only needed if your account belongs to more than one workspace.');
});
