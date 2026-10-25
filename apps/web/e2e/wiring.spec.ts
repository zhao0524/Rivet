import { expect, test } from '@playwright/test';
import { expectUrl, seedExample, SOURCED_PLAN, watchPageErrors } from './helpers';

const PIN_MAP = Object.entries(SOURCED_PLAN.firmware.pin_map);
const CONNECTION_IDS = new Set(SOURCED_PLAN.connections.map((c) => c.connection_id));

test.describe('Wiring & firmware', () => {
  test('rows highlight wires on hover and pin on click; the firmware tab shows the pin map and an honest download', async ({
    page,
  }) => {
    const errors = watchPageErrors(page);
    const record = await seedExample(page, { furthestStep: 'wiring' });
    await page.goto(`/p/${record.id}/wiring`);
    await expect(page.getByTestId('wiring-step')).toBeVisible();
    await expect(page.getByTestId('wiring-tab-wiring')).toHaveAttribute('aria-selected', 'true');

    const list = page.getByTestId('wiring-list');
    await expect(list).toBeVisible();
    const rows = list.locator('[data-testid^="wiring-row-"]');
    expect(await rows.count()).toBeGreaterThan(0);
    for (const testId of await rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')))) {
      expect(CONNECTION_IDS.has(testId!.replace('wiring-row-', ''))).toBe(true);
    }
    await expect(page.getByTestId('wiring-panel')).toContainText(/\d+ of \d+ connections drawn/);

    const sda = page.getByTestId('wiring-row-wire-i2c-sda');
    await expect(sda).toContainText('I2C');
    // Each row leads with what the wire does; the pin names stay in the secondary line.
    await expect(sda).toContainText('Reads distance from the distance sensor');
    await expect(sda).toContainText('gpio21');
    await expect(sda).toHaveAttribute('aria-pressed', 'false');
    await sda.hover();
    await expect(sda).toHaveClass(/p1-wire--active/);
    await page.mouse.move(0, 0);
    await expect(sda).not.toHaveClass(/p1-wire--active/);
    await sda.click();
    await expect(sda).toHaveAttribute('aria-pressed', 'true');
    await expect(sda).toHaveClass(/p1-wire--active/);
    await sda.click();
    await expect(sda).toHaveAttribute('aria-pressed', 'false');

    // Starter code tab.
    await page.getByTestId('wiring-tab-firmware').click();
    await expect(page.getByTestId('wiring-tab-firmware')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('wiring-panel')).toHaveCount(0);
    const firmware = page.getByTestId('wiring-firmware');
    await expect(firmware).toBeVisible();
    await expect(firmware).toContainText(SOURCED_PLAN.firmware.target);
    await expect(firmware).toContainText(SOURCED_PLAN.firmware.profile_id!);
    await expect(page.getByTestId('firmware-compile-status')).toHaveText('Not checked yet. It gets built when you copy it onto the board in Build.');
    const pinRows = page.getByTestId('firmware-pinmap').locator('tbody tr');
    await expect(pinRows).toHaveCount(PIN_MAP.length);
    for (const [signal, pin] of PIN_MAP) {
      const row = page.getByTestId(`firmware-pin-${signal}`);
      await expect(row).toBeVisible();
      await expect(row.locator('td').first()).toContainText(signal);
      await expect(row.locator('td').last()).toHaveText(String(pin));
    }
    // Offline there is no package to fetch, and the button says why instead of faking a file.
    await expect(page.getByTestId('firmware-download')).toBeDisabled();
    await expect(page.getByTestId('firmware-download-reason')).toContainText("need Rivet's live engine");

    await page.getByTestId('wiring-tab-wiring').click();
    await expect(page.getByTestId('wiring-panel')).toBeVisible();

    // Simulation is optional, labelled approximate, and runs on request only.
    await page.getByTestId('wiring-open-sim').click();
    const sim = page.getByTestId('sim-modal');
    await expect(sim).toBeVisible();
    await expect(page.getByTestId('sim-approximate')).toHaveText('Approximate');
    await expect(page.getByTestId('sim-limits')).toContainText(SOURCED_PLAN.simulation!.limitations[0]!);
    await page.getByTestId('sim-run').click();
    await expect(page.getByTestId('sim-run')).toHaveText('Run again');
    await page.keyboard.press('Escape');
    await expect(sim).toHaveCount(0);

    await page.getByTestId('wiring-primary').click();
    await expectUrl(page, `/p/${record.id}/buy`);
    expect(errors).toEqual([]);
  });
});
