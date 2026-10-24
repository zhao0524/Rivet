import { expect, test } from '@playwright/test';
import { watchPageErrors } from './helpers';

test('selecting a part in PartsPanel shows its catalog data and matching BOM row', async ({ page }) => {
  const errors = watchPageErrors(page);
  await page.goto('/studio');

  await expect(page.getByTestId('parts-panel')).toBeVisible();
  await page.getByTestId('tree-select-sensor-1').click();

  const inspector = page.getByTestId('part-inspector');
  await expect(inspector).toBeVisible();
  await expect(page.getByTestId('inspector-title')).toHaveText('Front Range Sensor');
  await expect(page.getByTestId('inspector-instance-id')).toHaveText('sensor-1');
  await expect(page.getByTestId('inspector-role')).toHaveText('distance_sensor');
  await expect(page.getByTestId('inspector-catalog-id')).toHaveText('demo.range');
  // Synthetic fixture: price and purchase link stay honestly unknown.
  await expect(page.getByTestId('inspector-price')).toContainText('Unknown');
  await expect(page.getByTestId('inspector-link-status')).toHaveAttribute('data-link-status', 'not_available');
  await expect(page.getByTestId('inspector-bom-quantity')).toContainText('1');

  // Inspect mode shows the same catalog row the inspector reported.
  await page.getByTestId('studio-mode-inspect').click();
  await expect(page.getByTestId('bom-panel')).toBeVisible();
  await expect(page.getByTestId('bom-row-demo.range')).toBeVisible();
  await expect(page.getByTestId('bom-qty-demo.range')).toHaveText('1');
  await expect(page.getByTestId('bom-instance-sensor-1')).toBeVisible();
  await expect(page.getByTestId('bom-link-status-demo.range')).toContainText('No link available');

  expect(errors).toEqual([]);
});
