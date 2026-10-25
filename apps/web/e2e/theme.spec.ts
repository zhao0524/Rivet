import { expect, test } from '@playwright/test';
import { seedExample, THEME_KEY, watchPageErrors } from './helpers';

test.describe('Theme', () => {
  test.use({ colorScheme: 'light' });

  test('the toggle sets data-theme, survives a reload and follows into the app', async ({ page }) => {
    const errors = watchPageErrors(page);
    const record = await seedExample(page);
    const html = page.locator('html');

    await page.goto('/');
    await expect(html).toHaveAttribute('data-theme', 'light');
    const toggle = page.getByTestId('theme-toggle');
    await expect(toggle).toHaveAttribute('aria-label', 'Switch to dark theme');

    await toggle.click();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await expect(toggle).toHaveAttribute('aria-label', 'Switch to light theme');
    expect(await page.evaluate((k) => window.localStorage.getItem(k), THEME_KEY)).toBe('dark');

    // The boot script applies the stored choice before first paint.
    await page.reload();
    await expect(html).toHaveAttribute('data-theme', 'dark');

    // Same choice on the app screens, and the scene follows it.
    await page.goto(`/p/${record.id}/review`);
    await expect(page.getByTestId('review-step')).toBeVisible();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await page.getByTestId('theme-toggle').click();
    await expect(html).toHaveAttribute('data-theme', 'light');
    expect(await page.evaluate((k) => window.localStorage.getItem(k), THEME_KEY)).toBe('light');

    expect(errors).toEqual([]);
  });
});
