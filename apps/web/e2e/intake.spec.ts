import { expect, test } from '@playwright/test';
import { watchPageErrors } from './helpers';

const SOURCED_TITLE = 'Indoor obstacle rover';
const SYNTHETIC_TITLE = 'Synthetic starter rover (NOT SOURCED)';

test('home page loads the studio with the default saved build and intake opens', async ({ page }) => {
  const errors = watchPageErrors(page);
  await page.goto('/');

  await expect(page.getByTestId('home-page')).toBeVisible();
  await expect(page.getByTestId('home-scope-strip')).toBeVisible();
  await expect(page.getByTestId('family-badge-supported')).toBeVisible();

  // Fixture mode loads the synthetic starter build immediately.
  await expect(page.getByTestId('studio-build-title')).toHaveText(SYNTHETIC_TITLE);
  await expect(page.getByTestId('studio-build-identity')).toContainText('rivet-synthetic-rover-fixture');
  await expect(page.getByTestId('datasource-mode-fixture')).toHaveAttribute('aria-pressed', 'true');

  // Open intake and launch the engine-sourced saved example.
  await page.getByTestId('header-toggle-intake').click();
  await expect(page.locator('[data-rivet="build-intake"]')).toBeVisible();
  await page.getByRole('button', { name: `Open ${SOURCED_TITLE}` }).click();

  await expect(page.getByTestId('saved-example-loaded')).toContainText(`Showing ${SOURCED_TITLE}`);
  await expect(page.getByTestId('saved-example-loaded')).toContainText('not supplier verified');
  await expect(page.getByTestId('studio-build-title')).toHaveText(SOURCED_TITLE);
  await expect(page.getByTestId('studio-build-identity')).toContainText('rivet-intent-rover-001');

  expect(errors).toEqual([]);
});

test('prompt generation completes through the fixture job path and loads the plan', async ({ page }) => {
  const errors = watchPageErrors(page);
  await page.goto('/studio');

  await page.getByTestId('header-toggle-intake').click();
  await page.getByLabel(/What should it do/).fill('Build a small rover that avoids obstacles');
  await page.getByRole('button', { name: 'Generate', exact: true }).click();

  // Fixture mode returns an already-complete saved job with one honest system event.
  const status = page.locator('[data-rivet="generation-status"]');
  await expect(status).toBeVisible();
  await expect(status).toContainText('rivet-synthetic-rover-fixture');
  await expect(status).toContainText('is ready');
  await expect(status).toContainText('loaded from checked-in fixture; no live generation ran');

  await expect(page.getByTestId('studio-build-title')).toHaveText(SYNTHETIC_TITLE);

  expect(errors).toEqual([]);
});
