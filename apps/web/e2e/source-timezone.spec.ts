import { test, expect } from '@playwright/test';
import { FIXTURE_BRAND } from '../src/api/fixtures';

for (const timezoneId of ['Asia/Kolkata', 'America/Los_Angeles', 'UTC']) {
  test.describe(timezoneId, () => {
    test.use({ timezoneId });
    test('new source effective time represents the current instant in local time', async ({ page }) => {
      const instant = '2026-10-23T12:34:00.000Z';
      await page.clock.setFixedTime(new Date(instant));
      let submitted = '';
      await page.route('**/api/v1/**', async route => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/me')) return route.fulfill({ json: { membership_id: 'manager', role: 'manager' } });
        if (path.endsWith(`/brands/${FIXTURE_BRAND.id}`)) return route.fulfill({ json: FIXTURE_BRAND });
        if (path.endsWith('/sources') && route.request().method() === 'POST') {
          submitted = route.request().postDataJSON().valid_from;
          return route.fulfill({ status: 201, json: { id: 'new-source' } });
        }
        return route.fulfill({ json: [] });
      });
      await page.goto(`/brands/${FIXTURE_BRAND.id}`);
      await page.locator('#btn-add-source').click();
      const input = page.locator('#txt-src-from');
      const value = await input.inputValue();
      const parsed = await input.evaluate(el => new Date((el as HTMLInputElement).value).toISOString());
      expect(parsed).toBe(instant);
      if (timezoneId === 'Asia/Kolkata') expect(value).toBe('2026-10-23T18:04');
      if (timezoneId === 'America/Los_Angeles') expect(value).toBe('2026-10-23T05:34');
      await expect(page.getByText('Local time in', { exact: false })).toBeVisible();
      await page.getByRole('button', { name: 'Create Source Draft', exact: true }).click();
      await expect.poll(() => submitted).toBe(instant);
    });
  });
}
