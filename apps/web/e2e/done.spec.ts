import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { blockers } from '../src/lib/flow/derive';
import { expectUrl, readProject, seedExample, SOURCED_PLAN, watchPageErrors } from './helpers';

const OPEN = blockers(SOURCED_PLAN);
const CHASSIS = 'chassis.sparkfun_shadow_rob13301';

test.describe('Done', () => {
  test('summarises the example, keeps unresolved checks visible and exports the build', async ({
    page,
  }) => {
    const errors = watchPageErrors(page);
    const record = await seedExample(page, {
      furthestStep: 'done',
      buildStep: SOURCED_PLAN.assembly_steps.length,
      completedAt: '2026-10-24T18:00:00.000Z',
      missingCatalogIds: [CHASSIS],
    });
    await page.goto(`/p/${record.id}/done`);
    await expect(page.getByTestId('done-step')).toBeVisible();

    await expect(page.getByTestId('done-part-count')).toHaveText(String(SOURCED_PLAN.components.length));
    await expect(page.getByTestId('done-step-count')).toHaveText(String(SOURCED_PLAN.assembly_steps.length));
    await expect(page.getByTestId('done-summary')).toContainText('Finished Oct 24, 2026');
    await expect(page.getByTestId('done-missing')).toContainText('Shadow Chassis');
    const open = page.getByTestId('done-blockers');
    await expect(open).toContainText(`${OPEN.length} problems couldn't be settled`);
    await expect(open).toContainText('The left motor may not fit the frame');
    await expect(page.getByTestId('done-summary')).toContainText('version');
    for (const f of OPEN) await expect(open).toContainText(f.message);
    await expect(page.getByTestId('done-viewport')).toContainText(SOURCED_PLAN.title);
    await expect(page.getByTestId('stepper-build')).toHaveAttribute('data-state', 'done');

    await expect(page.getByRole('heading', { name: 'Example complete' })).toBeVisible();
    const status = page.getByTestId('done-status');

    // Export build.json: no live engine, so it is the loaded plan, downloaded from the browser.
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('done-primary').click()]);
    expect(download.suggestedFilename()).toBe(`${SOURCED_PLAN.build_id}-r${SOURCED_PLAN.revision}.build.json`);
    const body = JSON.parse(await readFile(await download.path(), 'utf8')) as { build_id: string; revision: number };
    expect(body).toMatchObject({ build_id: SOURCED_PLAN.build_id, revision: SOURCED_PLAN.revision });
    await expect(status).toContainText('Downloaded build.json');

    // The example explains its edit boundary before offering a new project.
    await page.getByTestId('done-change').click();
    await expect(page.getByTestId('iterate')).toBeVisible();
    await expect(page.getByTestId('iterate')).toContainText('cannot be edited');
    await expect(page.getByTestId('iterate-apply')).toHaveCount(0);
    await expectUrl(page, `/p/${record.id}/done`);
    expect((await readProject(page, record.id)).revision).toBeNull();

    expect(errors).toEqual([]);
  });
});
