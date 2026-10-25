import { expect, test } from '@playwright/test';
import { isAiEstimated, partRows, specRows } from '../src/lib/flow/derive';
import type { CatalogComponent } from '../src/lib/rivet/types';
import rawCatalog from '../src/lib/rivet/fixtures/sourced-seed-components.json';
import { expectUrl, pickOverflow, seedExample, SOURCED_PLAN, watchPageErrors } from './helpers';

const CATALOG = rawCatalog as unknown as CatalogComponent[];
const ROWS = partRows(SOURCED_PLAN, CATALOG);
const SOURCES = ['Datasheet', 'Checked', 'AI estimate'];

test.describe('Parts', () => {
  test('grouped rows select in the model and open a spec drawer with source tags and honest gaps', async ({ page }) => {
    const errors = watchPageErrors(page);
    const record = await seedExample(page, { furthestStep: 'parts' });
    await page.goto(`/p/${record.id}/parts`);
    await expect(page.getByTestId('parts-step')).toBeVisible();
    await expect(page.getByTestId('parts-groups')).toBeVisible();

    // Hidden accessories (wires, cells) are not rows; every visible component is.
    const rows = page.locator('[data-testid^="parts-row-"]');
    await expect(rows).toHaveCount(ROWS.length);
    for (const group of ['frame', 'drive', 'power', 'control', 'sensing']) {
      await expect(page.getByTestId(`parts-group-${group}`)).toBeVisible();
    }
    await expect(page.getByTestId('parts-step')).toContainText(`${ROWS.length} parts in`);

    const controller = ROWS.find((r) => r.instanceId === 'controller-1')!;
    const row = page.getByTestId('parts-row-controller-1');
    await expect(row).toContainText(controller.name);
    await row.click();
    await expect(row).toHaveAttribute('aria-current', 'true');
    await expect(page.getByTestId('parts-viewport')).toContainText(controller.name);

    const drawer = page.getByTestId('spec-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText(controller.name);
    await expect(drawer).toContainText(controller.catalogId);
    const expectedRows = specRows(controller.catalog, SOURCED_PLAN.bom.currency);
    for (const spec of expectedRows) {
      const tr = drawer.getByTestId(`spec-row-${spec.label.toLowerCase()}`);
      if (spec.value === null) {
        await expect(tr).toContainText('Not in datasheet');
        await expect(tr.getByTestId('spec-source')).toHaveCount(0);
      } else {
        await expect(tr.getByTestId('spec-source')).toHaveAttribute('data-source', spec.source!);
        if (spec.label === 'Price') await expect(tr).toContainText('$15.00');
      }
    }
    const tags = drawer.getByTestId('spec-source');
    expect(await tags.count()).toBeGreaterThan(0);
    for (const source of await tags.allInnerTexts()) expect(SOURCES).toContain(source);
    await expect(drawer).toContainText('Checked Oct 24, 2026');
    await page.getByTestId('spec-close').click();
    await expect(drawer).toHaveCount(0);

    // Explode view is a real switch.
    const explode = page.getByTestId('parts-explode');
    await expect(explode).toHaveAttribute('aria-checked', 'false');
    await explode.click();
    await expect(explode).toHaveAttribute('aria-checked', 'true');

    // The AI-estimate filter counts honestly.
    const aiRows = ROWS.filter((r) => isAiEstimated(r.catalog));
    await pickOverflow(page, 'overflow-ai-only');
    await expect(page.getByTestId('parts-step')).toContainText(`${aiRows.length} of ${ROWS.length} parts have AI-estimated values`);
    await expect(rows).toHaveCount(aiRows.length);

    expect(errors).toEqual([]);
  });

  test('?part= preselects a row and opens its drawer (the Review "swap manually" link)', async ({ page }) => {
    const errors = watchPageErrors(page);
    const record = await seedExample(page, { furthestStep: 'parts' });
    await page.goto(`/p/${record.id}/parts?part=motor-left-1`);
    const motor = ROWS.find((r) => r.instanceId === 'motor-left-1')!;
    const drawer = page.getByTestId('spec-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText(motor.name);
    await expect(page.getByTestId('parts-row-motor-left-1')).toHaveAttribute('aria-current', 'true');
    // The motor carries advisory warnings (brown-out) that Review kept off its screen.
    await expect(drawer.getByTestId('spec-warnings')).toBeVisible();
    await page.getByTestId('spec-close').click();

    await page.getByTestId('parts-primary').click();
    await expectUrl(page, `/p/${record.id}/wiring`);
    expect(errors).toEqual([]);
  });
});
