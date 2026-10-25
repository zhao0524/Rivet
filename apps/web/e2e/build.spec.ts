import { expect, test } from '@playwright/test';
import { partNicknames, plainInstructions } from '../src/lib/flow/derive';
import type { CatalogComponent } from '../src/lib/rivet/types';
import rawCatalog from '../src/lib/rivet/fixtures/sourced-seed-components.json';
import { expectUrl, pickOverflow, readProject, seedExample, setChecked, SOURCED_PLAN, watchPageErrors } from './helpers';

const STEPS = [...SOURCED_PLAN.assembly_steps].sort((a, b) => a.step - b.step);
const COUNT = STEPS.length;
const NICKNAMES = partNicknames(SOURCED_PLAN, rawCatalog as unknown as CatalogComponent[]);

/** The step text reads with everyday part names; the engine's exact wording stays under "Show the exact…". */
async function expectInstructions(page: import('@playwright/test').Page, raw: string) {
  const plain = plainInstructions(raw, NICKNAMES);
  await expect(page.getByTestId('build-instructions')).toHaveText(plain);
  if (plain !== raw) await expect(page.getByTestId('build-instructions-original')).toHaveText(raw);
  else await expect(page.getByTestId('build-instructions-original')).toHaveCount(0);
  await expect(page.getByTestId('build-instructions')).not.toContainText(/controller-1|driver-1|sensor-1|accessory-\d/);
}
/** First step that mounts the controller board carries the firmware card (build-model.ts). */
const FIRMWARE_STEP = STEPS.find((s) => s.instance_ids.includes('controller-1'))!.step;
/** Steps gated behind the safety checkbox: a safety note, or a power part in the step. */
const POWER = /power|battery|batteries|lipo|cell|charger/i;
const gated = (s: (typeof STEPS)[number]) =>
  s.safety_notes.length > 0 ||
  s.instance_ids.some((id) => {
    const c = SOURCED_PLAN.components.find((x) => x.instance_id === id);
    return c ? POWER.test(`${c.role} ${c.catalog_id}`) : false;
  });

test.describe('Build', () => {
  test('safety notes gate Next, the firmware card sits on the controller step, progress survives a reload, Finish lands on Done', async ({
    page,
  }) => {
    // Eleven steps, each re-rendering the 3D scene, plus a reload: give it the long timeout.
    test.slow();
    const errors = watchPageErrors(page);
    const record = await seedExample(page, { furthestStep: 'build' });
    await page.goto(`/p/${record.id}/build`);
    await expect(page.getByTestId('build-step')).toBeVisible();

    const count = page.getByTestId('build-step-count');
    const primary = page.getByTestId('build-primary');
    await expect(count).toHaveText(`Step 1 of ${COUNT}`);
    await expectInstructions(page, STEPS[0]!.instructions);
    await expect(page.getByTestId('build-back')).toBeDisabled();
    expect(gated(STEPS[0]!)).toBe(false);
    await expect(page.getByTestId('build-safety')).toHaveCount(0);
    await expect(primary).toBeEnabled();
    expect((await readProject(page, record.id)).buildStep).toBe(1);

    // Mark the chassis missing: a note on the step, nothing hidden.
    await pickOverflow(page, 'build-mark-missing');
    await expect(page.getByTestId('build-missing')).toBeVisible();
    await page.getByTestId('build-missing-chassis-1').check();
    await page.getByTestId('build-missing-confirm').click();
    await expect(page.getByTestId('build-missing-note')).toContainText('Missing: Shadow Chassis');
    await expect(page.getByTestId('build-part-chassis-1')).toContainText('Missing');

    // Walk to the first gated step.
    const firstGated = STEPS.findIndex(gated) + 1;
    for (let n = 1; n < firstGated; n += 1) await primary.click();
    await expect(count).toHaveText(`Step ${firstGated} of ${COUNT}`);
    const safety = page.getByTestId('build-safety');
    await expect(safety).toBeVisible();
    for (const note of STEPS[firstGated - 1]!.safety_notes) await expect(safety).toContainText(note);
    await expect(primary).toBeDisabled();
    await expect(page.getByTestId('build-step')).toContainText('Tick the safety note to continue');
    for (const id of STEPS[firstGated - 1]!.instance_ids) {
      if (SOURCED_PLAN.components.some((c) => c.instance_id === id)) await expect(page.getByTestId(`build-part-${id}`)).toBeVisible();
    }

    // The firmware card appears where the board is mounted; offline it has no package to download.
    expect(firstGated).toBe(FIRMWARE_STEP);
    const firmware = page.getByTestId('build-firmware');
    await expect(firmware).toBeVisible();
    await expect(firmware).toContainText('Code check: not checked yet');
    await expect(firmware).toContainText('Load the starter code');
    await expect(firmware).toContainText(SOURCED_PLAN.firmware.target);
    await expect(page.getByTestId('build-firmware-download')).toBeDisabled();
    await expect(firmware).toContainText("Downloads need Rivet's live engine");

    await setChecked(page.getByTestId('build-safety-ack'), true);
    await expect(primary).toBeEnabled();

    // Progress and the acknowledgement are saved per step.
    await page.reload();
    await expect(page.getByTestId('build-step')).toBeVisible();
    await expect(count).toHaveText(`Step ${firstGated} of ${COUNT}`);
    await expect(page.getByTestId('build-safety-ack')).toBeChecked();
    await expect(primary).toBeEnabled();
    expect(await readProject(page, record.id)).toMatchObject({
      buildStep: firstGated,
      acknowledgedSteps: [firstGated],
      missingCatalogIds: ['chassis.sparkfun_shadow_rob13301'],
    });

    await page.getByTestId('build-back').click();
    await expect(count).toHaveText(`Step ${firstGated - 1} of ${COUNT}`);
    await primary.click();
    await expect(count).toHaveText(`Step ${firstGated} of ${COUNT}`);

    // Every remaining step: read the note, tick it, go on. The last one says Finish.
    for (let n = firstGated; n <= COUNT; n += 1) {
      await expect(count).toHaveText(`Step ${n} of ${COUNT}`);
      await expectInstructions(page, STEPS[n - 1]!.instructions);
      if (gated(STEPS[n - 1]!)) {
        await setChecked(page.getByTestId('build-safety-ack'), true);
      } else {
        await expect(page.getByTestId('build-safety')).toHaveCount(0);
      }
      await expect(primary).toHaveText(n === COUNT ? 'Finish' : 'Next step');
      await expect(primary).toBeEnabled();
      await primary.click();
    }

    await expectUrl(page, `/p/${record.id}/done`);
    await expect(page.getByTestId('done-step')).toBeVisible();
    const saved = await readProject(page, record.id);
    expect(saved.furthestStep).toBe('done');
    expect(saved.buildStep).toBe(COUNT);
    expect(saved.completedAt).toBeTruthy();
    expect(errors).toEqual([]);
  });
});
