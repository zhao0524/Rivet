import { expect, test } from '@playwright/test';
import { watchPageErrors } from './helpers';

test('studio mounts the 3D stage, or the documented WebGL fallback when unavailable', async ({ page }) => {
  const errors = watchPageErrors(page);
  await page.goto('/studio');

  await expect(page.getByTestId('rover-scene')).toBeVisible();
  const stage = page.locator('[data-rivet-stage]');
  await expect(stage).toBeVisible();

  const canvas = stage.locator('canvas').first();
  const fallback = page.locator('[data-stage-fallback]');
  await expect(canvas.or(fallback)).toBeVisible();

  if ((await fallback.count()) > 0) {
    // Documented fallback: 3D unavailable but the rest of the studio still works.
    await expect(fallback).toContainText(/3D view unavailable/i);
    await expect(page.getByTestId('parts-panel')).toBeVisible();
  } else {
    await expect(canvas).toBeVisible();
    await expect(page.locator('[data-stage-context-lost]')).toHaveCount(0);
  }

  expect(errors).toEqual([]);
});
