import { expect, test, type Page } from '@playwright/test';
import { watchPageErrors } from './helpers';

async function open(page: Page, outcome: string) {
  await page.goto(`/studio?resolve=${outcome}`);
  const dialog = page.getByRole('dialog', { name: 'Product match' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('resolve-saved-banner')).toContainText('not a live lookup');
  await expect(dialog.getByTestId('resolve-result')).toHaveAttribute('data-claimed-outcome', outcome);
  return dialog;
}

test('exact match lists parts with labels and a source popover', async ({ page }) => {
  const errors = watchPageErrors(page);
  const d = await open(page, 'exact_match');
  await expect(d.getByTestId('resolve-result')).toHaveAttribute('data-outcome', 'exact_match');
  await expect(d.getByTestId('resolve-headline')).toContainText('We found this product: Example Aero');
  await expect(d.getByTestId('resolve-sku')).toContainText('EA-SCOUT-MINI');
  await expect(d.getByTestId('resolve-part-motor').getByTestId('part-status')).toHaveText('Verified');
  await expect(d.getByTestId('resolve-part-gps').getByTestId('part-status')).toHaveText('Not found');
  await expect(d.getByTestId('no-source-gps')).toBeVisible();
  await expect(d.getByTestId('resolve-typical')).toHaveCount(0);
  // Nothing was over-claimed, so there is no downgrade notice.
  await expect(d.getByTestId('resolve-downgrade-notice')).toHaveCount(0);

  await d.getByTestId('source-toggle-motor').click();
  const pop = d.getByTestId('source-popover-motor');
  await expect(pop.getByRole('link')).toHaveAttribute('href', /saved-example\/shop\/m1103/);
  await expect(pop).toContainText('Distributor');
  await expect(pop).toContainText(/fetched \d{4}-\d{2}-\d{2}/);
  expect(errors).toEqual([]);
});

test('partial match says what could not be confirmed and separates typical parts', async ({ page }) => {
  const errors = watchPageErrors(page);
  const d = await open(page, 'partial_match');
  await expect(d.getByTestId('resolve-headline')).toHaveText(
    'We found the product but could not confirm 4 of 6 parts',
  );
  await expect(d.getByTestId('resolve-part-frame').getByTestId('part-status')).toHaveText('Inferred');
  await expect(d.getByTestId('resolve-part-esc').getByTestId('part-status')).toHaveText('Sources disagree');
  await d.getByTestId('source-toggle-esc').click();
  await expect(d.getByTestId('source-popover-esc').getByRole('link')).toHaveCount(2);
  await d.getByTestId('source-toggle-frame').click();
  await expect(d.getByTestId('source-popover-frame')).toContainText('cannot count as verified');
  const typical = d.getByTestId('resolve-typical');
  await expect(typical).toContainText('What similar products use');
  await expect(typical).toContainText('not parts of your product');
  await expect(d.getByTestId('resolve-parts')).not.toContainText('12 MP');
  expect(errors).toEqual([]);
});

test('a part claimed verified on an out-of-date source is shown as out of date', async ({ page }) => {
  const d = await open(page, 'partial_match');
  const row = d.getByTestId('resolve-part-props');
  await expect(row).toHaveAttribute('data-claimed-status', 'verified');
  await expect(row.getByTestId('part-status')).toHaveText('Out of date');
  await expect(d.getByTestId('resolve-downgrade-props')).toContainText('freshness window');
  await expect(d.getByTestId('resolve-downgrade-notice')).toContainText('1 part claims more than');
});

test('no match shows alternatives and typical parts, never a product', async ({ page }) => {
  const errors = watchPageErrors(page);
  const d = await open(page, 'no_match_with_alternatives');
  await expect(d.getByTestId('resolve-headline')).toHaveText('We could not find this exact product');
  await expect(d.getByTestId('resolve-sku')).toHaveCount(0);
  await expect(d.getByTestId('resolve-parts')).toHaveCount(0);
  await expect(d.getByTestId('resolve-alternatives')).toContainText('Pocket 4 drone');
  await expect(d.getByTestId('resolve-typical')).toContainText('2 of 2 verified comparable drones');
  expect(errors).toEqual([]);
});

test('unsupported explains why and what to upload instead', async ({ page }) => {
  const errors = watchPageErrors(page);
  const d = await open(page, 'unsupported');
  await expect(d.getByTestId('resolve-result')).toContainText('landscape');
  await expect(d.getByTestId('resolve-unsupported-help')).toContainText('What to upload instead');
  await expect(d.getByTestId('resolve-parts')).toHaveCount(0);
  await expect(d.getByTestId('resolve-alternatives')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('product match opens from the header in fixture mode and switches outcome', async ({ page }) => {
  await page.goto('/studio');
  await page.getByTestId('header-open-resolve').click();
  const d = page.getByRole('dialog', { name: 'Product match' });
  await expect(d.getByTestId('resolve-result')).toHaveAttribute('data-outcome', 'exact_match');
  await d.getByTestId('resolve-fixture-select').selectOption('unsupported');
  await expect(d.getByTestId('resolve-result')).toHaveAttribute('data-outcome', 'unsupported');
});
