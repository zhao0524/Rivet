import { expect, test, type Page } from '@playwright/test';
import { watchPageErrors } from './helpers';

const HONESTY = /as of the check time and may have changed\. Rivet does not sell parts\./;

async function openExample(page: Page, fixture: string) {
  await page.goto(`/studio?offers=${fixture}`);
  const dialog = page.getByRole('dialog', { name: 'Offers example' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('offers-saved-banner')).toContainText('not a live lookup');
  await expect(dialog.getByTestId('offers-dialog-body')).toHaveAttribute('data-fixture', fixture);
  return dialog;
}

test('selecting a synthetic demo part shows the refused offers state, not a fabricated link', async ({ page }) => {
  const errors = watchPageErrors(page);
  await page.goto('/studio');
  await expect(page.getByTestId('parts-panel')).toBeVisible();
  await page.getByTestId('tree-select-sensor-1').click();

  const section = page.getByTestId('inspector-offers-section');
  await expect(section).toBeVisible();
  await expect(section).toHaveAttribute('data-catalog-id', 'demo.range');
  const panel = section.getByTestId('offers-panel');
  await expect(panel).toHaveAttribute('data-state', 'refused');
  await expect(panel.getByTestId('offers-refused')).toContainText('synthetic placeholder');
  await expect(panel.getByTestId('offer-open-vendor')).toHaveCount(0);
  await expect(panel.getByTestId('offers-honesty-footer')).toContainText(HONESTY);

  // Inspect mode: the BOM row carries the same refusal in its "Where to buy" cell.
  await page.getByTestId('studio-mode-inspect').click();
  await expect(page.getByTestId('bom-panel')).toBeVisible();
  await expect(page.getByTestId('bom-offers-demo.range')).toHaveAttribute('data-state', 'refused');

  expect(errors).toEqual([]);
});

test('the multivendor example renders ranked offers, sorts, filters and safe vendor links', async ({ page }) => {
  const errors = watchPageErrors(page);
  const d = await openExample(page, 'synthetic-multivendor');
  const panel = d.getByTestId('offers-panel');
  await expect(panel).toHaveAttribute('data-state', 'ready');
  await expect(panel.getByTestId('offers-banner')).toContainText('SYNTHETIC TEST-ONLY offers');
  await expect(panel.getByTestId('offers-banner')).toContainText('Not a live lookup');

  const ranked = panel.getByTestId('offers-list-offers');
  await expect(ranked.locator('> li')).toHaveCount(8);
  await expect(ranked.locator('> li').first()).toHaveAttribute('data-offer-id', 'dist-one:e4c8a313d8534aef');
  await expect(panel.getByTestId('offers-possible-matches')).toContainText('never ranked with them');
  await expect(panel.getByTestId('offers-alternatives')).toBeVisible();

  // Unknown price and no rating are stated, never 0.
  const noPrice = panel.getByTestId('offer-card-dist-two:2f1bc3376bcf7531');
  await expect(noPrice.getByTestId('offer-price')).toHaveText('Price not stated');
  await expect(noPrice.getByTestId('offer-rating')).toHaveText('No rating on vendor page');
  await expect(panel.getByTestId('offer-card-dist-one:e4e5560d62dc624a').getByTestId('offer-pack')).toHaveText(
    '3-pack, price per pack (4.00 each)',
  );
  await expect(panel.getByTestId('offer-card-dist-two:cfa9b01d78023178').getByTestId('offer-status-label')).toContainText('Stale');
  await expect(panel.getByTestId('offer-card-bargain-bay:877c148882e83900').getByTestId('offer-status-label')).toContainText('Demoted');

  // Sort by price: the cheapest USD offer leads, the unpriced one is last.
  await panel.getByTestId('offers-sort').selectOption('price_asc');
  await expect(ranked.locator('> li').first()).toHaveAttribute('data-offer-id', 'bargain-bay:877c148882e83900');
  await expect(ranked.locator('> li').last()).toHaveAttribute('data-offer-id', 'dist-two:2f1bc3376bcf7531');

  // Filter to in-stock manufacturer offers, then to an empty result.
  await panel.getByTestId('offers-in-stock').check();
  await panel.getByTestId('offers-tier-manufacturer').click();
  await expect(ranked.locator('> li')).toHaveCount(1);
  await expect(ranked.locator('> li').first()).toHaveAttribute('data-vendor-tier', 'manufacturer');
  await panel.getByTestId('offers-min-rating').selectOption('4');
  await expect(panel.getByTestId('offers-empty-after-filter')).toContainText('No offer matches the current filters');
  await expect(panel.getByTestId('offers-possible-matches')).toBeVisible();
  await panel.getByTestId('offers-clear-filters').click();
  await expect(ranked.locator('> li')).toHaveCount(8);

  // Every vendor link is https, opens in a new tab and carries noopener noreferrer.
  const links = panel.getByTestId('offer-open-vendor');
  await expect(links.first()).toBeVisible();
  for (const link of await links.all()) {
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(link).toHaveAttribute('href', /^https:\/\//);
  }

  // Reliability tooltip appears on hover and lists the factors.
  const badge = panel.getByTestId('offer-reliability-bargain-bay:877c148882e83900');
  const tip = panel.getByTestId('offer-reliability-tooltip-bargain-bay:877c148882e83900');
  await expect(tip).toBeHidden();
  await badge.hover();
  await expect(tip).toBeVisible();
  await expect(tip).toContainText('78% below the 4.50 median');

  await expect(panel.getByTestId('offers-honesty-footer')).toContainText(HONESTY);
  expect(errors).toEqual([]);
});

test('not found and refused examples show no link and explain why', async ({ page }) => {
  const errors = watchPageErrors(page);
  const d = await openExample(page, 'not-found-9999999');
  await expect(d.getByTestId('offers-not-found')).toContainText('no link is shown because none was verified');
  await expect(d.getByTestId('offer-open-vendor')).toHaveCount(0);

  await d.getByTestId('offers-fixture-select').selectOption('refused-synthetic-demo-part');
  await expect(d.getByTestId('offers-panel')).toHaveAttribute('data-state', 'refused');
  await expect(d.getByTestId('offers-refused')).toContainText('nothing to buy');

  await d.getByTestId('offers-fixture-select').selectOption('sparkfun-rob-13301');
  await expect(d.getByTestId('offer-availability')).toHaveText('Stock not stated');
  await expect(d.getByTestId('offers-banner')).toContainText('Not a live lookup');
  expect(errors).toEqual([]);
});

test('the offers example opens from the header in fixture mode', async ({ page }) => {
  await page.goto('/studio');
  await page.getByTestId('header-open-offers').click();
  const d = page.getByRole('dialog', { name: 'Offers example' });
  await expect(d.getByTestId('offers-dialog-body')).toHaveAttribute('data-fixture', 'synthetic-multivendor');
});
