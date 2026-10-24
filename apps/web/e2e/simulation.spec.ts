import { expect, test } from '@playwright/test';
import { watchPageErrors } from './helpers';

test('simulation runs the obstacle scenario and is labeled as a simplified approximation', async ({
  page,
}) => {
  const errors = watchPageErrors(page);
  await page.goto('/studio');

  await page.getByTestId('studio-mode-simulate').click();
  await expect(page.getByTestId('sim-view-container')).toBeVisible();
  await expect(page.getByTestId('sim-disclaimer')).toContainText(
    'Simplified kinematic simulation; not a guarantee of real-world performance',
  );
  await expect(page.getByTestId('sim-limitations')).toContainText(/kinematic|Simplified/i);

  // Canonical wall scenario at 2x speed: rover drives forward until the
  // deterministic FORWARD → STOP transition near x = 0.85 m.
  await page.getByTestId('sim-scenario-select').selectOption('wall-ahead');
  await page.getByTestId('sim-speed-select').selectOption('2');

  await expect(page.getByTestId('sim-control-play')).toHaveText('Play');
  await page.getByTestId('sim-control-play').click();
  await expect(page.getByTestId('sim-controls-status')).toContainText('Running');

  // The FSM transition log is the persistent, deterministic signal that the
  // obstacle-avoidance behavior ran (STOP is transient and re-enters FORWARD).
  await expect(page.getByTestId('sim-transitions-log')).toContainText('FORWARD → STOP', {
    timeout: 30_000,
  });
  await expect(page.getByTestId('sim-readout-state')).toHaveText(/FORWARD|STOP|TURN/);
  await expect(page.getByTestId('sim-readout-pose')).not.toHaveText(/^0\.00 m, 0\.00 m/);

  // DISABLE is the documented safety stop.
  await page.getByTestId('sim-control-disable').click();
  await expect(page.getByTestId('sim-readout-state')).toHaveText('DISABLED');
  await expect(page.getByTestId('sim-controls-status')).toContainText('Motors disabled');

  expect(errors).toEqual([]);
});
