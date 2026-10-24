import { expect, test, type Page } from '@playwright/test';
import savedPlan from '../src/lib/rivet/fixtures/sourced-rover-obstacle-v1.json';
import { watchPageErrors } from './helpers';

// GATE-H30 (#41): both saved examples open offline (fixture mode, no API, no keys) and each
// carries its honest label. The engine-sourced snapshot is a "Saved demo build" stamped with
// its capture time (created_at, written by scripts/capture_saved_example.py); the synthetic
// starter stays labeled synthetic.
const SOURCED_TITLE = 'Indoor obstacle rover';
const SYNTHETIC_TITLE = 'Synthetic starter rover (NOT SOURCED)';
const CAPTURED = `Captured ${savedPlan.created_at.slice(0, 10)} ${savedPlan.created_at.slice(11, 16)} UTC`;

async function openSavedExample(page: Page, title: string) {
  const intake = page.locator('[data-rivet="build-intake"]');
  if (!(await intake.isVisible())) await page.getByTestId('header-toggle-intake').click();
  await page.getByRole('button', { name: `Open ${title}` }).click();
  await expect(page.getByTestId('studio-build-title')).toHaveText(title);
}

/** Banner text including reasons, expanding a Details toggle if the banner has one. */
async function bannerText(page: Page): Promise<string> {
  const banner = page.getByTestId('provenance-trust-banner');
  const toggle = banner.getByTestId('trust-banner-details-toggle');
  if ((await toggle.count()) > 0 && (await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  return (await banner.textContent()) ?? '';
}

test('both saved examples open offline with honest labels and the demo build shows its capture time', async ({ page }) => {
  const errors = watchPageErrors(page);
  await page.goto('/studio');
  const banner = page.getByTestId('provenance-trust-banner');

  // Default fixture build: the synthetic starter, labeled synthetic and never "captured".
  await expect(page.getByTestId('studio-build-title')).toHaveText(SYNTHETIC_TITLE);
  await expect(banner).toHaveAttribute('data-trust-label', 'Saved synthetic example');
  await expect(banner).toHaveAttribute('data-synthetic', 'true');
  expect(await bannerText(page)).not.toContain('Captured');

  // Engine-sourced snapshot: Saved demo build, capture time, real catalog parts, not live.
  await openSavedExample(page, SOURCED_TITLE);
  await expect(banner).toHaveAttribute('data-trust-label', 'Saved demo build');
  await expect(banner).toHaveAttribute('data-synthetic', 'false');
  const sourced = await bannerText(page);
  expect(sourced).toContain('Saved demo build');
  expect(sourced).toContain(CAPTURED);
  expect(sourced).toContain('not a live generation');
  expect(sourced).not.toMatch(/synthetic/i);

  // Back to the synthetic starter: the label follows the build that is open.
  await openSavedExample(page, SYNTHETIC_TITLE);
  await expect(banner).toHaveAttribute('data-trust-label', 'Saved synthetic example');
  expect(await bannerText(page)).not.toContain('Captured');

  expect(errors).toEqual([]);
});
