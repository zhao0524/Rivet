import { expect, test } from '@playwright/test';
import { watchPageErrors } from './helpers';

const SOURCED_TITLE = 'Indoor obstacle rover';
const SYNTHETIC_TITLE = 'Synthetic starter rover (NOT SOURCED)';

test('landing page starts a build in one click and the intake opens on that input', async ({ page }) => {
  const errors = watchPageErrors(page);
  await page.goto('/');

  await expect(page.getByTestId('home-page')).toBeVisible();
  await expect(page.getByTestId('family-badge-supported')).toBeVisible();
  await expect(page.locator('[data-rivet="studio-shell"]')).toHaveCount(0);

  await page.getByTestId('home-start-describe').click();
  await expect(page).toHaveURL(/\/studio\?start=describe$/);
  const dialog = page.getByRole('dialog', { name: 'New build' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel(/What should it do/)).toBeFocused();

  expect(errors).toEqual([]);
});

test('saved example opens from the intake and closes into the studio', async ({ page }) => {
  const errors = watchPageErrors(page);
  await page.goto('/studio?dev=1');

  // Fixture mode loads the synthetic starter build immediately.
  await expect(page.getByTestId('studio-build-title')).toHaveText(SYNTHETIC_TITLE);
  await expect(page.getByTestId('studio-build-identity')).toContainText('rivet-synthetic-rover-fixture');
  await page.getByTestId('developer-menu').click();
  await expect(page.getByTestId('datasource-mode-fixture')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');

  await page.getByTestId('header-toggle-intake').click();
  const dialog = page.getByRole('dialog', { name: 'New build' });
  await expect(dialog.getByTestId('saved-example-card-rivet-intent-rover-001')).toContainText('not supplier verified');
  await dialog.getByRole('button', { name: `Open ${SOURCED_TITLE}` }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('studio-build-title')).toHaveText(SOURCED_TITLE);
  await expect(page.getByTestId('studio-build-identity')).toContainText('rivet-intent-rover-001');

  expect(errors).toEqual([]);
});

test('developer controls and raw ids are hidden without ?dev=1', async ({ page }) => {
  await page.goto('/studio');
  await expect(page.getByTestId('studio-status-chip')).toHaveText('Needs review');
  await expect(page.getByTestId('studio-build-identity')).toHaveCount(0);
  await expect(page.getByTestId('developer-menu')).toHaveCount(0);
});

test('prompt generation completes through the fixture job path and closes into the studio', async ({ page }) => {
  const errors = watchPageErrors(page);
  await page.goto('/studio');

  await page.getByTestId('header-toggle-intake').click();
  const dialog = page.getByRole('dialog', { name: 'New build' });
  await dialog.getByLabel(/What should it do/).fill('Build a small rover that avoids obstacles');
  await dialog.getByRole('button', { name: 'Review interpretation', exact: true }).click();
  await expect(dialog.getByTestId('interpretation-card')).toContainText('does not read your image');
  await dialog.getByRole('button', { name: 'Confirm and build', exact: true }).click();

  // Fixture mode returns an already-complete saved job; the intake closes once that build is on screen,
  // and the trust banner keeps saying it is a saved example.
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('studio-build-title')).toHaveText(SYNTHETIC_TITLE);
  await expect(page.getByTestId('provenance-trust-banner')).toHaveAttribute('data-trust-label', 'Saved synthetic example');

  expect(errors).toEqual([]);
});
