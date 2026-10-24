import { expect, test } from '@playwright/test';
import { expectSceneFitsContainer } from '../e2e-acceptance/helpers';

// Each case creates a WebGL renderer. Running all four viewports concurrently can
// starve ResizeObserver delivery and test stale canvas dimensions instead of layout.
test.describe.configure({ mode: 'serial' });

for (const width of [1440, 1024, 768, 390]) {
  test(`sourced rover fits ${width}px and long panels do not grow the canvas`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: width === 1440 ? 717 : 844 });
    await page.goto('/studio');
    await page.getByTestId('header-toggle-intake').click();
    await page.getByRole('button', { name: 'Open Indoor obstacle rover', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'New build' })).toBeHidden();
    const canvas = page.locator('[data-rivet-stage] canvas');
    await expect(canvas).toBeVisible();
    await expectSceneFitsContainer(page, `${width}px Design`);
    const height = (await canvas.boundingBox())!.height;
    await page.screenshot({ path: info.outputPath(`studio-${width}.png`) });
    await page.getByTestId('studio-mode-inspect').click();
    await expectSceneFitsContainer(page, `${width}px Inspect`);
    expect(Math.abs((await canvas.boundingBox())!.height - height)).toBeLessThanOrEqual(1);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
    // Increasing findings content must never change the center column's sizing.
    await page.getByTestId('inspector-verify-section').evaluate((el) => {
      const extra = document.createElement('div'); extra.style.height = '12000px'; el.append(extra);
    });
    expect(Math.abs((await canvas.boundingBox())!.height - height)).toBeLessThanOrEqual(1);
    await expectSceneFitsContainer(page, `${width}px long findings`);
    await page.getByTestId('studio-mode-assemble').click();
    await expect(page.getByTestId('assembly-bom-coverage')).toHaveAttribute('data-complete', 'true');
    await expectSceneFitsContainer(page, `${width}px Assemble`);
  });
}
