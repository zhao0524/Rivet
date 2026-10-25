import { expect, test } from '@playwright/test';

/**
 * v2 geometry-first generation through the normal studio entry point, against the real API
 * (offline rule-based author, real compiler, checks and renders). Screenshots are evidence.
 */
test('prompt to three real candidates, streamed geometry, choice and a targeted revision', async ({ page }, info) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE-ERROR', m.text().slice(0, 300)); });
  page.on('pageerror', (e) => console.log('PAGE-ERROR', e.message.slice(0, 300)));
  await page.goto('/new');
  await page.getByTestId('new-design-v2-link').click();
  await expect(page.locator('[data-testid="design-start"][data-hydrated="true"]')).toBeVisible({ timeout: 120_000 });
  await expect(async () => {
    await page.getByLabel('Describe the design').fill('a small orange rover that avoids obstacles');
    await expect(page.getByTestId('generate-design-v2')).toBeEnabled({ timeout: 1000 });
  }).toPass({ timeout: 30_000 });
  await page.getByTestId('design-mode-select').selectOption('engineered');
  await page.getByTestId('generate-design-v2').click();
  await expect(page.getByTestId('design-studio')).toBeVisible();
  await expect(page.getByTestId('generation-timeline').locator('[data-stage="geometry_preview"]').first()).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('[data-rivet-stage]')).toHaveAttribute('data-stage-state', 'ready');
  await expect(page.getByTestId('design-status')).toBeVisible({ timeout: 240_000 });
  await expect(page.getByTestId('design-mode')).toContainText('Engineered');
  await expect(page.getByTestId('design-mode')).toContainText('fresh');
  for (const id of ['cand-1', 'cand-2', 'cand-3']) await expect(page.getByTestId(`candidate-${id}`)).toBeVisible();
  await expect(page.getByTestId('design-claims')).toContainText('Buildability');
  await page.screenshot({ path: info.outputPath('design-v2-generated.png'), fullPage: true });

  const target = (await page.getByTestId('candidate-cand-1').getAttribute('data-selected')) === 'true' ? 'cand-2' : 'cand-1';
  await page.getByTestId(`choose-${target}`).click();
  await expect(page.getByTestId(`candidate-${target}`)).toHaveAttribute('data-selected', 'true');

  await page.getByTestId('design-revise-input').fill('make the chassis wider');
  await page.getByTestId('design-revise-submit').click();
  await expect(page.getByTestId('revision-history')).toContainText('r3', { timeout: 120_000 });
  await page.screenshot({ path: info.outputPath('design-v2-revised.png'), fullPage: true });
  expect(errors.filter((e) => !/ResizeObserver/.test(e))).toEqual([]);
});
