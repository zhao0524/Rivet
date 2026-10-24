import { expect, test } from '@playwright/test';
import { watchPageErrors } from './helpers';

test('exploded view toggles and the spread slider follows', async ({ page }) => {
  const errors = watchPageErrors(page);
  await page.goto('/studio');

  const explode = page.getByTestId('toolbar-toggle-explode');
  const slider = page.getByTestId('toolbar-explode-slider');
  await expect(explode).toHaveAttribute('aria-pressed', 'false');
  await expect(explode).toHaveText('Explode');

  await explode.click();
  await expect(explode).toHaveAttribute('aria-pressed', 'true');
  await expect(explode).toContainText('Exploded');
  await expect(slider).toHaveValue('0.75');

  await explode.click();
  await expect(explode).toHaveAttribute('aria-pressed', 'false');
  // Spread is only offered while exploded.
  await expect(slider).toHaveCount(0);

  expect(errors).toEqual([]);
});

test('timeline scrubbing steps through assembly and links step parts to the inspector', async ({
  page,
}) => {
  const errors = watchPageErrors(page);
  await page.goto('/studio');
  // The timeline is only shown in Assemble mode.
  await page.getByTestId('studio-mode-assemble').click();

  const step1 = page.getByTestId('timeline-step-pill-1');
  await step1.click();
  await expect(step1).toHaveAttribute('aria-pressed', 'true');
  const details = page.getByTestId('timeline-active-step-details');
  await expect(details).toContainText('Step 1: Mount the chassis');
  await expect(page.getByTestId('timeline-step-instance-chassis-1')).toBeVisible();

  const step2 = page.getByTestId('timeline-step-pill-2');
  await step2.click();
  await expect(step2).toHaveAttribute('aria-pressed', 'true');
  await expect(step1).toHaveAttribute('aria-pressed', 'false');
  await expect(details).toContainText('Step 2: Attach the motors');
  await expect(page.getByTestId('timeline-step-instance-motor-left-1')).toBeVisible();
  await expect(page.getByTestId('timeline-step-instance-motor-right-1')).toBeVisible();

  // Step parts jump straight to the selected part in the inspector.
  await page.getByTestId('timeline-step-instance-motor-left-1').click();
  await expect(page.getByTestId('tree-item-motor-left-1')).toHaveCSS('background-color', 'rgb(30, 58, 138)');
  await page.getByTestId('studio-mode-design').click();
  await expect(page.getByTestId('inspector-instance-id')).toHaveText('motor-left-1');
  await page.getByTestId('studio-mode-assemble').click();

  // Scrubbing back to position 0 (prep) clears the active step details.
  await page.getByTestId('timeline-step-pill-0').click();
  await expect(page.getByTestId('timeline-active-step-details')).toHaveCount(0);

  expect(errors).toEqual([]);
});
