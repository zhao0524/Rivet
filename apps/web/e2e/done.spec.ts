import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { blockers } from '../src/lib/flow/derive';
import { expectUrl, readProject, seedExample, SOURCED_PLAN, watchPageErrors } from './helpers';

const OPEN = blockers(SOURCED_PLAN);
const CHASSIS = 'chassis.sparkfun_shadow_rob13301';

test.describe('Done', () => {
  test('summarises the build, keeps unresolved checks visible, Share reports what it did, and Iterate shows the refusal', async ({
    page,
    context,
  }) => {
    const errors = watchPageErrors(page);
    const record = await seedExample(page, {
      furthestStep: 'done',
      buildStep: SOURCED_PLAN.assembly_steps.length,
      completedAt: '2026-10-24T18:00:00.000Z',
      missingCatalogIds: [CHASSIS],
    });
    await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => undefined);
    // Desktop Chrome has navigator.share; headless it opens an OS sheet that never resolves.
    // Removing it exercises the clipboard path, which is what a browser without Web Share gets.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    });
    await page.goto(`/p/${record.id}/done`);
    await expect(page.getByTestId('done-step')).toBeVisible();

    await expect(page.getByTestId('done-part-count')).toHaveText(String(SOURCED_PLAN.components.length));
    await expect(page.getByTestId('done-step-count')).toHaveText(String(SOURCED_PLAN.assembly_steps.length));
    await expect(page.getByTestId('done-summary')).toContainText('Finished Oct 24, 2026');
    await expect(page.getByTestId('done-missing')).toContainText('Shadow Chassis');
    const open = page.getByTestId('done-blockers');
    await expect(open).toContainText(`${OPEN.length} checks could not be settled`);
    for (const f of OPEN) await expect(open).toContainText(f.message);
    await expect(page.getByTestId('done-viewport')).toContainText(SOURCED_PLAN.title);
    await expect(page.getByTestId('stepper-build')).toHaveAttribute('data-state', 'done');

    // Share: copies the link or shows it; either way it says the link works on this device only.
    await page.getByTestId('done-primary').click();
    const status = page.getByTestId('done-status');
    await expect(status).toContainText(/Link copied|Copy this link yourself/);
    await expect(status).toContainText('this device only');
    const text = (await status.textContent()) ?? '';
    if (text.includes('Link copied')) {
      const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
      if (clip !== null) expect(clip).toBe(page.url());
    } else {
      expect(text).toContain(`/p/${record.id}/done`);
    }

    // Export build.json: no live engine, so it is the loaded plan, downloaded from the browser.
    await page.getByTestId('step-overflow').click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('done-export').click()]);
    expect(download.suggestedFilename()).toBe(`${SOURCED_PLAN.build_id}-r${SOURCED_PLAN.revision}.build.json`);
    const body = JSON.parse(await readFile(await download.path(), 'utf8')) as { build_id: string; revision: number };
    expect(body).toMatchObject({ build_id: SOURCED_PLAN.build_id, revision: SOURCED_PLAN.revision });
    await expect(status).toContainText('Downloaded build.json');

    // Iterate from Done: the fixture engine refuses, and the reason is shown as-is.
    await page.getByTestId('done-change').click();
    await expect(page.getByTestId('iterate')).toBeVisible();
    await page.getByTestId('iterate-text').fill('Move the sensor higher');
    await page.getByTestId('iterate-apply').click();
    await expect(page.getByTestId('iterate-reason')).toContainText('edits cannot be validated in fixture mode');
    await expect(page.getByTestId('iterate-reason')).toContainText('Move the sensor higher');
    await expectUrl(page, `/p/${record.id}/done`);
    expect((await readProject(page, record.id)).revision).toBeNull();

    expect(errors).toEqual([]);
  });
});
