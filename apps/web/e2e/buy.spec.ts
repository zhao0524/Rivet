import { expect, test } from '@playwright/test';
import { buyLines, formatMoney } from '../src/lib/flow/derive';
import type { CatalogComponent } from '../src/lib/rivet/types';
import rawCatalog from '../src/lib/rivet/fixtures/sourced-seed-components.json';
import { expectUrl, readProject, seedExample, SOURCED_PLAN, watchPageErrors } from './helpers';

const CATALOG = rawCatalog as unknown as CatalogComponent[];
const LINES = buyLines(SOURCED_PLAN, CATALOG).filter((line) => !line.included);
const CURRENCY = SOURCED_PLAN.bom.currency;
const POWER_BANK = 'power.adafruit_usb_power_bank_5000_4288';
const CASTER = 'caster.sparkfun_shadow_nub';

function total(ownedIds: readonly string[] = []): number {
  return LINES.filter((l) => !ownedIds.includes(l.catalogId) && l.unitPrice !== null).reduce(
    (sum, l) => sum + l.unitPrice! * l.quantity,
    0,
  );
}

test.describe('Buy', () => {
  test('totals from known prices, "I own this" persists, and the cart links only verified product pages', async ({ page }) => {
    const errors = watchPageErrors(page);
    const record = await seedExample(page, { furthestStep: 'buy' });
    await page.goto(`/p/${record.id}/buy`);
    await expect(page.getByTestId('buy-step')).toBeVisible();

    const amount = page.getByTestId('buy-total-amount');
    await expect(amount).toHaveText(formatMoney(total(), CURRENCY));
    await expect(page.getByTestId('buy-total')).toContainText(`${LINES.length} parts to buy`);
    await expect(page.getByTestId('buy-unknown-prices')).toHaveCount(0);
    await expect(page.getByTestId('buy-region')).toContainText(`United States · ${CURRENCY}`);

    // The kit caster remains visible without becoming a separate purchase.
    await expect(page.getByTestId('buy-vendor-Adafruit')).toBeVisible();
    await expect(page.getByTestId('buy-vendor-SparkFun')).toBeVisible();
    await expect(page.getByTestId('buy-vendor-No verified vendor')).toHaveCount(0);
    await expect(page.getByTestId('buy-included')).toContainText('Shadow Chassis nub caster');
    await expect(page.getByTestId(`buy-line-${CASTER}`)).toHaveCount(0);

    // The out-of-stock ESP32 is listed plainly, without an invented alternative.
    const oos = page.getByTestId('buy-out-of-stock');
    await expect(oos).toContainText('ESP32-DevKitC');
    await expect(oos).toContainText('Out of stock when checked');
    await expect(oos).toContainText('Check the vendor for current availability');
    await expect(oos).toContainText('You will need this part or a compatible replacement');

    // Own the power bank: it leaves the total and the cart.
    await page.getByTestId('buy-vendor-Adafruit').getByRole('button').first().click();
    const bank = page.getByTestId(`buy-line-${POWER_BANK}`);
    await expect(bank).toContainText(formatMoney(26.95, CURRENCY));
    await expect(bank).toContainText('In stock');
    await bank.getByTestId(`buy-own-${POWER_BANK}`).check();
    await expect(amount).toHaveText(formatMoney(total([POWER_BANK]), CURRENCY));
    await expect(page.getByTestId('buy-total')).toContainText(`${LINES.length - 1} parts to buy, 1 owned`);
    expect((await readProject(page, record.id)).ownedCatalogIds).toEqual([POWER_BANK]);

    await page.reload();
    await expect(amount).toHaveText(formatMoney(total([POWER_BANK]), CURRENCY));

    await page.getByTestId('buy-primary').click();
    const cart = page.getByTestId('buy-cart');
    await expect(cart).toBeVisible();
    await expect(cart.getByTestId('buy-cart-vendor-Adafruit')).toBeVisible();
    await expect(cart.getByTestId('buy-cart-vendor-SparkFun')).toBeVisible();
    for (const line of LINES) {
      const link = cart.getByTestId(`buy-cart-link-${line.catalogId}`);
      if (line.catalogId === POWER_BANK) {
        await expect(link).toHaveCount(0);
      } else if (line.url) {
        await expect(link).toHaveAttribute('href', line.url);
        await expect(link).toHaveAttribute('target', '_blank');
        await expect(link).toContainText(formatMoney(line.unitPrice! * line.quantity, CURRENCY));
      } else {
        await expect(link).toHaveCount(0);
        await expect(cart.getByTestId('buy-cart-no-vendor')).toContainText(line.name);
      }
    }
    await page.getByTestId('buy-cart-continue').click();
    await expectUrl(page, `/p/${record.id}/build`);
    await expect(page.getByTestId('build-step')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('owning everything turns the CTA into "Start building"', async ({ page }) => {
    const errors = watchPageErrors(page);
    const record = await seedExample(page, { furthestStep: 'buy', ownedCatalogIds: LINES.map((l) => l.catalogId) });
    await page.goto(`/p/${record.id}/buy`);
    await expect(page.getByTestId('buy-total-amount')).toHaveText(formatMoney(0, CURRENCY));
    await expect(page.getByTestId('buy-total')).toContainText('You own everything on the list');
    await expect(page.getByTestId('buy-primary')).toHaveText('Start building');
    await page.getByTestId('buy-primary').click();
    await expectUrl(page, `/p/${record.id}/build`);
    expect(errors).toEqual([]);
  });
});
