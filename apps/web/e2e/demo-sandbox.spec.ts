import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const members = [
  { membership_id: 'm-creator', role: 'creator', label: 'Creator', email: 'creator@demo.test' },
  { membership_id: 'm-reviewer', role: 'reviewer', label: 'Reviewer', email: 'reviewer@demo.test' },
  { membership_id: 'm-manager', role: 'manager', label: 'Manager', email: 'manager@demo.test' },
  { membership_id: 'm-lead', role: 'manager', label: 'Brand lead', email: 'lead@demo.test' },
  { membership_id: 'm-admin', role: 'admin', label: 'Admin', email: 'admin@demo.test' },
];
const expires = new Date(Date.now() + 47.6 * 3_600_000).toISOString();

test('a judge starts a private demo from sign-in and switches roles from the top bar', async ({ page }) => {
  let current: (typeof members)[number] | null = null;
  const switched: string[] = [];
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const sandbox = () => ({ org_id: 'org-demo', role: current!.role, membership_id: current!.membership_id, csrf_token: 'csrf', expires_at: expires, members });
    if (path.endsWith('/demo/sandboxes')) { current = members[0]; return route.fulfill({ status: 201, json: sandbox() }); }
    if (path.endsWith('/demo/switch')) {
      const id = route.request().postDataJSON().membership_id;
      switched.push(id);
      current = members.find(m => m.membership_id === id)!;
      return route.fulfill({ json: sandbox() });
    }
    if (path.endsWith('/demo/members')) return route.fulfill({ json: members });
    if (path.endsWith('/me')) {
      if (!current) return route.fulfill({ status: 401, json: { code: 'unauthenticated', message: 'Sign in', request_id: 't', details: {} } });
      return route.fulfill({ json: { user_id: 'u', org_id: 'org-demo', membership_id: current.membership_id, role: current.role, label: current.label, is_demo: true, demo_expires_at: expires, csrf_token: 'csrf' } });
    }
    if (path.endsWith('/content')) return route.fulfill({ json: { items: [], next_cursor: null } });
    return route.fulfill({ json: [] });
  });
  await page.goto('/login');
  await expect(page.getByRole('button', { name: /Try a private demo/ })).toBeVisible();
  const scan = await new AxeBuilder({ page }).analyze();
  expect(scan.violations.filter(v => ['serious', 'critical'].includes(v.impact ?? ''))).toEqual([]);
  await page.getByRole('button', { name: /Try a private demo/ }).click();
  const role = page.getByLabel(/viewing as/);
  await expect(role).toHaveValue('m-creator');
  await expect(page.getByText(/48 h left/)).toBeVisible();
  await role.selectOption({ label: 'Reviewer' });
  await expect(role).toHaveValue('m-reviewer');
  expect(switched).toEqual(['m-reviewer']);
});

test('ordinary accounts do not see the role switcher', async ({ page }) => {
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/me')) return route.fulfill({ json: { user_id: 'u', org_id: 'o', membership_id: 'm', role: 'creator', csrf_token: 'c' } });
    if (path.endsWith('/content')) return route.fulfill({ json: { items: [], next_cursor: null } });
    return route.fulfill({ json: [] });
  });
  await page.goto('/');
  await expect(page.locator('.topnav__role-badge')).toHaveText('creator');
  await expect(page.locator('#sel-demo-role')).toHaveCount(0);
});
