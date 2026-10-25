import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page, type Response } from '@playwright/test';
import { firmwareStep, needsSafetyAck, orderedSteps, stepParts } from '../src/components/steps/build/build-model';
import { NO_VENDOR, groupByVendor } from '../src/components/steps/buy/buy-model';
import { blockers, buyLines, formatMoney, partNicknames, partRows, plainInstructions, specRows } from '../src/lib/flow/derive';
import type { BomItem, BuildPlan, CatalogComponent, EditResponse, InterpretResponse, JobResponse } from '../src/lib/rivet/types';
import { API_URL, REFERENCE_IMAGE } from './env';
import { apiGet, expectSceneFitsViewport, isPost, patchProject, readProject, readZip, watchPageErrors } from './helpers';

/** Plain rover request; the mock vision provider refuses prompts that mention drones or arms. */
const PROMPT = 'Build a small two-wheeled rover like this one that avoids obstacles.';

/**
 * Today's default sourced rover (engine catalog `catalog-v1.2-2026-10-24`, see
 * packages/engineering/README.md) has 17 placed components on 15 BOM lines: the two TT
 * motors and the two wheels each share one line (quantity 2). The mock intent always asks
 * for that rover, so the number is fixed; change it together with the engine's default rover.
 */
const EXPECTED_BOM_LINES = 15;

/** The one edit the old studio preset sent; the engine accepts it as a behavior-parameter change. */
const EDIT_INSTRUCTION = 'Increase obstacle stop distance to 0.40 m';
const EDIT_OPERATION = { op: 'set_behavior_parameter', name: 'obstacle_stop_distance_m', value: 0.4 };

/** GET /api/projects/{id} adds the response-only `provenance.sourcing` (contracts/api.md). */
type ApiPlan = BuildPlan & {
  provenance: BuildPlan['provenance'] & { sourcing?: { synthetic: boolean } };
};

/** The project record the app keeps per build (`src/lib/flow/projects.ts`). */
interface StoredProject {
  id: string;
  phase: string;
  imageAssetId: string | null;
  intentId: string | null;
  buildId: string | null;
  revision: number | null;
  furthestStep: string;
  buildStep: number;
  completedAt: string | null;
}

/** A line that costs money. Kit items included with another part are listed at 0.00. */
function isPriced(item: BomItem): boolean {
  return item.unit_price_amount !== null && Number(item.unit_price_amount) > 0;
}

function isHttpsUrl(value: string | null): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.length > 0;
  } catch {
    return false;
  }
}

/**
 * Clicks an export link and waits for the browser download, then requests the same href
 * (through the same Next.js proxy) to check the HTTP status and headers, which a Playwright
 * download does not expose.
 */
async function downloadLink(page: Page, link: Locator) {
  const href = await link.getAttribute('href');
  if (!href) throw new Error('export link has no href');
  const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
  expect(await download.failure(), `download of ${href}`).toBeNull();
  const body = readFileSync(await download.path());
  const response = await page.request.get(href);
  return { href, download, body, response };
}

/** Canvas screenshot taken once two consecutive frames match (camera and part animations settled). */
async function settledScreenshot(target: Locator): Promise<Buffer> {
  let previous = await target.screenshot();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await target.page().waitForTimeout(250);
    const current = await target.screenshot();
    if (current.equals(previous)) return current;
    previous = current;
  }
  return previous;
}

/** Expands every collapsed vendor group on Buy so each line is on screen. */
async function expandVendors(page: Page): Promise<void> {
  const toggles = page.locator('[data-testid^="buy-vendor-"] > button[aria-expanded="false"]');
  while ((await toggles.count()) > 0) await toggles.first().click();
}

test('reference image to a real-engine rover: clarify, generate, review, parts, wiring, buy, build, done and an edit', async ({
  page,
  request,
}) => {
  const errors = watchPageErrors(page);

  await test.step('the API runs in live mode (real engine, mock vision)', async () => {
    expect(await apiGet(request, '/api/health')).toEqual({ ok: true, mode: 'live' });
  });

  let projectId = '';
  let assetId = '';
  let interpreted: Promise<Response> | null = null;
  await test.step('/new: attach the reference image, enter the prompt, upload on submit', async () => {
    await page.goto('/new');
    await expect(page.getByTestId('new-screen')).toBeVisible();
    await expect(page.getByTestId('new-prompt')).toBeVisible();
    await page.getByTestId('new-prompt-file').setInputFiles(REFERENCE_IMAGE);
    await expect(page.getByTestId('new-prompt').getByRole('button', { name: 'rover-reference.png' })).toBeVisible();
    await page.getByTestId('new-prompt-input').fill(PROMPT);

    const uploaded = page.waitForResponse(isPost('/api/assets/images'));
    // Clarify interprets as soon as it mounts: listen before the navigation that triggers it.
    interpreted = page.waitForResponse(isPost('/api/intents/interpret'), { timeout: 120_000 });
    await page.getByTestId('new-prompt-submit').click();
    const upload = await uploaded;
    expect(upload.status(), 'image upload').toBe(200);
    const asset = (await upload.json()) as { asset_id: string; mime_type: string };
    expect(asset.mime_type).toBe('image/png');
    assetId = asset.asset_id;

    await expect(page).toHaveURL(/\/p\/p_[a-z0-9]+\/clarify$/, { timeout: 60_000 });
    projectId = page.url().split('/')[4]!;
    expect(await readProject<StoredProject>(page, projectId)).toMatchObject({ phase: 'clarify', imageAssetId: assetId });
  });

  let generateCount = 0;
  page.on('request', (req) => {
    if (req.method() === 'POST' && new URL(req.url()).pathname === '/api/projects/generate') generateCount += 1;
  });

  let intentId = '';
  await test.step('Clarify: the API reads the request first; the engine waits for confirmation', async () => {
    const interpretedResponse = await interpreted!;
    expect(interpretedResponse.status(), 'interpret request').toBe(200);
    const interpretation = (await interpretedResponse.json()) as InterpretResponse;
    expect(interpretation.supported).toBe(true);
    expect(interpretation.intent.project_family).toBe('rover');
    // The mock provider did not look at the image; the app must say so.
    expect(interpretation.vision_mode).toBe('fixture');
    expect(interpretation.intent.input).toMatchObject({ kind: 'image_and_text', image_asset_id: assetId, user_text: PROMPT });
    intentId = interpretation.intent_id;

    await expect(page.getByTestId('clarify-progress')).toHaveText('Question 1 of 3');
    await expect(page.getByTestId('clarify-understood')).toContainText('The saved example is an indoor rover');
    await expect(page.getByTestId('clarify-offline')).toContainText("didn't read your words or picture");
    await expect(page.getByTestId('clarify-limitation')).toHaveCount(0);
    expect(await readProject<StoredProject>(page, projectId)).toMatchObject({ intentId });
    expect(generateCount, 'engine must wait for confirmation').toBe(0);

    await page.getByTestId('clarify-next').click();
    await expect(page.getByTestId('clarify-progress')).toHaveText('Question 2 of 3');
    await expect(page.getByTestId('clarify-budget-none')).toHaveAttribute('aria-checked', 'true');
    await page.getByTestId('clarify-next').click();
    await expect(page.getByTestId('clarify-progress')).toHaveText('Question 3 of 3');
    await expect(page.getByTestId('clarify-next')).toHaveText(/^Generate/);
    expect(generateCount, 'engine must wait for confirmation').toBe(0);
  });

  let jobId = '';
  await test.step('Generate: one generate request from the stored interpretation, real job events in the tape', async () => {
    const generated = page.waitForResponse(isPost('/api/projects/generate'));
    await page.getByTestId('clarify-next').click();
    const generate = await generated;
    expect(generate.status(), 'generate request').toBe(202);
    expect(generate.request().postDataJSON()).toMatchObject({
      intent_id: intentId,
      interpretation_choice: 'as_interpreted',
      input: { kind: 'image_and_text', image_asset_id: assetId, user_text: PROMPT },
      requirements: { max_budget: null, currency: 'USD' },
    });
    jobId = ((await generate.json()) as { job_id: string }).job_id;
    expect(jobId).toBeTruthy();
    await expect(page).toHaveURL(`/p/${projectId}/generate`, { timeout: 60_000 });
    await expect(page.getByTestId('generate-screen')).toBeVisible();
  });

  let buildId = '';
  await test.step('the job completes and the app reports the new build', async () => {
    await expect
      .poll(async () => (await apiGet<JobResponse>(request, `/api/jobs/${jobId}`)).status, { timeout: 60_000 })
      .toBe('complete');
    const job = await apiGet<JobResponse>(request, `/api/jobs/${jobId}`);
    expect(job.build_id).toBeTruthy();
    expect(job.revision).toBe(1);
    buildId = job.build_id!;
    expect(generateCount, 'exactly one generate request').toBe(1);

    await expect(page.getByTestId('generate-done')).toBeVisible({ timeout: 60_000 });
    // Real stages from the engine, not a saved example.
    await expect(page.getByTestId('generate-fixture-note')).toHaveCount(0);
    // The Thinking trace lists one plain step per real engine stage, with the engine's message as detail.
    const trace = page.getByTestId('generate-thinking-steps');
    await expect(trace).toContainText('Image received');
    expect(await trace.locator('li').count()).toBeGreaterThan(1);
    await expect(page.getByTestId('generate-viewport').getByTestId('rover-scene')).toHaveAttribute('data-build-id', buildId);
    await expect(page.getByTestId('generate-status')).toContainText(/^Done: \d+ parts, ready to review$/);

    await page.getByTestId('generate-review').click();
    await expect(page).toHaveURL(`/p/${projectId}/review`, { timeout: 60_000 });
    expect(await readProject<StoredProject>(page, projectId)).toMatchObject({ phase: 'ready', buildId, revision: 1, furthestStep: 'review' });
  });

  const plan = await apiGet<ApiPlan>(request, `/api/projects/${buildId}`);
  const catalog = (await apiGet<{ components: CatalogComponent[] }>(request, '/api/catalog')).components;
  const catalogById = new Map(catalog.map((c) => [c.catalog_id, c]));

  await test.step('the API plan is the sourced default rover with honest labels', async () => {
    expect(plan.build_id).toBe(buildId);
    expect(plan.revision).toBe(1);
    expect(plan.project_family).toBe('rover');
    // Real engine, but the intent is the mock's: the API must call this `fallback`, not `live`.
    expect(plan.provenance.generation_mode).toBe('fallback');
    expect(plan.provenance.notes).toContain('Intent came from the fixture vision provider, not a live model');
    // Sourced catalog parts, not the synthetic `demo.*` fixture.
    expect(plan.provenance.sourcing?.synthetic).toBe(false);
    // No PlatformIO compile ran, so nothing may claim one did.
    expect(plan.firmware.compile_status).toBe('not_checked');
    expect(plan.status).toBe(plan.verification.overall);
    expect(plan.bom.items).toHaveLength(EXPECTED_BOM_LINES);
    // Every placed component is on exactly one BOM line.
    expect(plan.bom.items.reduce((n, item) => n + item.quantity, 0)).toBe(plan.components.length);
    for (const c of plan.components) expect(catalogById.has(c.catalog_id), `${c.instance_id} is in the catalog`).toBe(true);
  });
  test.info().annotations.push({
    type: 'build',
    description: `${buildId} r1: ${plan.status}, ${plan.components.length} components, ${plan.bom.items.length} BOM lines, ${plan.assembly_steps.length} steps`,
  });

  const rows = partRows(plan, catalog);
  const expectedBlockers = blockers(plan);

  await test.step('Review: exactly the blocking checks from the API plan, on the generated build', async () => {
    await expect(page.getByTestId('review-step')).toBeVisible();
    await expect(page.getByTestId('project-title')).toHaveText(/\S/);
    await expect(page.getByTestId('stepper-review')).toHaveAttribute('data-state', 'current');
    const cards = page.getByTestId('review-blocker');
    if (expectedBlockers.length === 0) {
      await expect(page.getByTestId('review-empty')).toBeVisible();
      await expect(cards).toHaveCount(0);
    } else {
      await expect(cards).toHaveCount(expectedBlockers.length);
      for (const [i, finding] of expectedBlockers.entries()) {
        await expect(cards.nth(i)).toHaveAttribute('data-rule', finding.rule_id);
        await expect(cards.nth(i)).toContainText(finding.message);
      }
      await expect(page.getByTestId('review-step')).toContainText(
        `${expectedBlockers.length} ${expectedBlockers.length === 1 ? 'problem is' : 'problems are'} still open`,
      );
      const scene = page.getByTestId('review-viewport').getByTestId('rover-scene');
      await expect(scene).toHaveAttribute('data-build-id', buildId);
      await expect(scene).toHaveAttribute('data-revision', '1');
      // A WebGL canvas, or the documented fallback when the browser cannot start WebGL.
      await expect(page.locator('[data-stage-fallback]'), 'rendering acceptance requires WebGL; fallback is tested separately').toHaveCount(0);
      await expect(page.locator('[data-stage-context-lost]')).toHaveCount(0);
      await expectSceneFitsViewport(page, 'review-viewport', 'Review');
    }
    // Advisory findings never show as blockers.
    for (const f of plan.verification.findings.filter((x) => !expectedBlockers.includes(x) && x.result !== 'PASS')) {
      await expect(cards.filter({ hasText: f.message })).toHaveCount(0);
    }
    await page.getByTestId('review-primary').click();
    await expect(page).toHaveURL(`/p/${projectId}/parts`, { timeout: 60_000 });
  });

  await test.step('Parts: every visible component with its catalog price and a spec drawer with sources', async () => {
    await expect(page.getByTestId('parts-step')).toBeVisible();
    const list = page.locator('[data-testid^="parts-row-"]');
    await expect(list).toHaveCount(rows.length);
    for (const row of rows) {
      const el = page.getByTestId(`parts-row-${row.instanceId}`);
      await expect(el).toContainText(row.name);
      const price = row.catalog?.sourcing.price_amount;
      await expect(el).toContainText(
        price === null || price === undefined ? 'No price' : formatMoney(Number(price), row.catalog?.sourcing.price_currency ?? plan.bom.currency),
      );
    }
    const scene = page.getByTestId('parts-viewport').getByTestId('rover-scene');
    await expect(scene).toHaveAttribute('data-build-id', buildId);
    await expectSceneFitsViewport(page, 'parts-viewport', 'Parts');

    const controller = rows.find((r) => r.role === 'controller') ?? rows[0]!;
    await page.getByTestId(`parts-row-${controller.instanceId}`).click();
    const drawer = page.getByTestId('spec-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText(controller.name);
    await expect(drawer).toContainText(controller.catalogId);
    for (const spec of specRows(controller.catalog, plan.bom.currency)) {
      const tr = drawer.getByTestId(`spec-row-${spec.label.toLowerCase()}`);
      if (spec.value === null) await expect(tr).toContainText('Not in datasheet');
      else await expect(tr.getByTestId('spec-source')).toHaveAttribute('data-source', spec.source!);
    }
    await page.getByTestId('spec-close').click();
    await expect(drawer).toHaveCount(0);

    await page.getByTestId('parts-primary').click();
    await expect(page).toHaveURL(`/p/${projectId}/wiring`, { timeout: 60_000 });
  });

  await test.step('Wiring & firmware: connections from the plan, the pin map, and the firmware ZIP from the API', async () => {
    await expect(page.getByTestId('wiring-step')).toBeVisible();
    const wires = page.getByTestId('wiring-list').locator('[data-testid^="wiring-row-"]');
    expect(await wires.count()).toBeGreaterThan(0);
    const ids = new Set(plan.connections.map((c) => c.connection_id));
    for (const testId of await wires.evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')!))) {
      expect(ids.has(testId.replace('wiring-row-', '')), `${testId} is a plan connection`).toBe(true);
    }
    await wires.first().hover();
    await expect(wires.first()).toHaveClass(/p1-wire--active/);
    await expectSceneFitsViewport(page, 'wiring-viewport', 'Wiring');

    await page.getByTestId('wiring-tab-firmware').click();
    const firmware = page.getByTestId('wiring-firmware');
    await expect(firmware).toContainText(plan.firmware.target);
    await expect(page.getByTestId('firmware-compile-status')).toHaveText('Not checked yet. It gets built when you copy it onto the board in Build.');
    const pins = Object.entries(plan.firmware.pin_map);
    expect(pins.length).toBeGreaterThan(0);
    await expect(page.getByTestId('firmware-pinmap').locator('tbody tr')).toHaveCount(pins.length);
    for (const [signal, pin] of pins) {
      const row = page.getByTestId(`firmware-pin-${signal}`);
      await expect(row).toBeVisible();
      await expect(row.locator('td').first()).toContainText(signal);
      await expect(row.locator('td').last()).toHaveText(String(pin));
    }

    const link = page.getByTestId('firmware-download');
    await expect(link).toHaveAttribute('href', `/api/projects/${buildId}/exports/firmware.zip?revision=1`);
    const zip = await downloadLink(page, link);
    expect(zip.download.suggestedFilename()).toBe(`${buildId}-r1-firmware.zip`);
    expect(zip.response.status()).toBe(200);
    expect(zip.response.headers()['content-type']).toBe('application/zip');
    expect(zip.response.headers()['content-disposition']).toBe(`attachment; filename="${buildId}-r1-firmware.zip"`);
    expect(zip.response.headers()['x-rivet-compile-status']).toBe('not_checked');
    expect(zip.response.headers()['x-rivet-generation-mode']).toBe('fallback');
    // The browser saved the API's artifact itself.
    expect(zip.body.equals(await zip.response.body())).toBe(true);
    const files = readZip(zip.body);
    expect([...files.keys()]).toEqual(expect.arrayContaining(['platformio.ini', 'src/main.cpp', 'manifest.json']));
    const manifest = JSON.parse(files.get('manifest.json')!.toString('utf8')) as Record<string, unknown>;
    expect(manifest).toMatchObject({
      build_id: buildId,
      revision: 1,
      plan_status: plan.status,
      generation_mode: 'fallback',
      compile_status: 'not_checked',
    });

    await page.getByTestId('wiring-primary').click();
    await expect(page).toHaveURL(`/p/${projectId}/buy`, { timeout: 60_000 });
  });

  const lines = buyLines(plan, catalog);
  await test.step('Buy: every BOM line with its price and link status; the cart links only verified product pages', async () => {
    await expect(page.getByTestId('buy-step')).toBeVisible();
    await expect(page.getByTestId('buy-vendors')).toBeVisible();
    await expandVendors(page);

    const { currency } = plan.bom;
    let known = 0;
    let unknown = 0;
    for (const item of plan.bom.items) {
      const id = item.catalog_id;
      const line = lines.find((l) => l.catalogId === id)!;
      const el = page.getByTestId(`buy-line-${id}`);
      await expect(el).toBeVisible();
      await expect(el).toContainText(catalogById.get(id)!.identity.model);
      await expect(el).toContainText(`Qty ${item.quantity}`);
      if (item.unit_price_amount === null) {
        unknown += 1;
        await expect(el).toContainText('Price unknown');
      } else {
        known += Number(item.unit_price_amount) * item.quantity;
        await expect(el).toContainText(formatMoney(Number(item.unit_price_amount), currency));
      }
      if (isPriced(item) || item.link_status === 'verified_product') {
        // Anything that costs money, and anything called a verified product, is a product
        // listing with an https link, and that exact URL is what the cart opens.
        expect(isHttpsUrl(item.purchase_url), `${id}: https purchase_url, got ${item.purchase_url}`).toBe(true);
        expect(item.link_status, `${id}: link_status`).toBe('verified_product');
        expect(line.url).toBe(item.purchase_url);
      } else {
        // Kit items that come with another part (today the Shadow Chassis nub caster at 0.00,
        // `manufacturer_reference_only`; services/api/README.md "Real products only") are not
        // sold separately and must not look like a store listing.
        expect(line.url).toBeNull();
      }
    }
    await expect(page.getByTestId('buy-total-amount')).toHaveText(formatMoney(known, currency));
    await expect(page.getByTestId('buy-total')).toContainText(`${plan.bom.items.length} parts to buy`);
    if (unknown > 0) await expect(page.getByTestId('buy-unknown-prices')).toContainText(`${unknown} part`);
    else await expect(page.getByTestId('buy-unknown-prices')).toHaveCount(0);
    if (plan.bom.total_status === 'complete' && plan.bom.known_subtotal_amount !== null) {
      expect(known).toBeCloseTo(Number(plan.bom.known_subtotal_amount), 2);
    }

    // The API's own BOM CSV, checked directly.
    const csv = await page.request.get(`/api/projects/${buildId}/exports/bom.csv?revision=1`);
    expect(csv.status()).toBe(200);
    expect(csv.headers()['content-type']).toMatch(/^text\/csv\b/);
    expect(csv.headers()['content-disposition']).toBe(`attachment; filename="${buildId}-r1-bom.csv"`);
    expect(csv.headers()['x-rivet-generation-mode']).toBe('fallback');
    expect(csv.headers()['x-rivet-synthetic']).toBe('false');
    const csvLines = (await csv.text()).trim().split(/\r?\n/);
    expect(csvLines[0]).toMatch(/^catalog_id,/);
    expect(csvLines.slice(1).filter((l) => !l.startsWith('TOTAL,')).map((l) => l.split(',')[0])).toEqual(plan.bom.items.map((i) => i.catalog_id));

    // The app's CSV export is built from the loaded plan: same lines, same order.
    await page.getByTestId('step-overflow').click();
    const [exported] = await Promise.all([page.waitForEvent('download'), page.getByTestId('buy-export-csv').click()]);
    expect(exported.suggestedFilename()).toBe(`${buildId}-bom.csv`);
    const appCsv = readFileSync(await exported.path(), 'utf8').trim().split(/\r?\n/);
    expect(appCsv[0]).toMatch(/^catalog_id,/);
    expect(appCsv.slice(1).filter((l) => !l.startsWith('TOTAL,')).map((l) => l.split(',')[0])).toEqual(plan.bom.items.map((i) => i.catalog_id));

    await page.getByTestId('buy-primary').click();
    const cart = page.getByTestId('buy-cart');
    await expect(cart).toBeVisible();
    for (const group of groupByVendor(lines, [])) {
      if (group.vendor === NO_VENDOR) {
        for (const line of group.lines) {
          await expect(cart.getByTestId('buy-cart-no-vendor')).toContainText(line.name);
          await expect(cart.getByTestId(`buy-cart-link-${line.catalogId}`)).toHaveCount(0);
        }
        continue;
      }
      await expect(cart.getByTestId(`buy-cart-vendor-${group.vendor}`)).toBeVisible();
      for (const line of group.lines) {
        const link = cart.getByTestId(`buy-cart-link-${line.catalogId}`);
        await expect(link).toHaveAttribute('href', line.url!);
        await expect(link).toHaveAttribute('target', '_blank');
      }
    }
    await page.getByTestId('buy-cart-continue').click();
    await expect(page).toHaveURL(`/p/${projectId}/build`, { timeout: 60_000 });
  });

  const steps = orderedSteps(plan);
  await test.step('Build: every assembly step in order, with its parts, safety gate and the firmware card', async () => {
    expect(steps.length).toBeGreaterThan(0);
    const covered = new Set(steps.flatMap((step) => step.instance_ids));
    for (const row of plan.bom.items) for (const id of row.instance_ids) expect(covered.has(id), `assembly covers ${id}`).toBe(true);
    const fwStep = firmwareStep(plan, catalog);
    expect(fwStep, 'a step mounts the controller board').not.toBeNull();

    await expect(page.getByTestId('build-step')).toBeVisible();
    const count = page.getByTestId('build-step-count');
    const primary = page.getByTestId('build-primary');
    const canvas = page.getByTestId('build-stage').locator('canvas').first();
    await expect(count).toHaveText(`Step 1 of ${steps.length}`);
    const scene = page.getByTestId('build-stage').getByTestId('rover-scene');
    await expect(scene).toHaveAttribute('data-assembly-mode', 'step');
    await expectSceneFitsViewport(page, 'build-stage', 'Build step 1');
    const firstShot = (await canvas.count()) > 0 ? await settledScreenshot(canvas) : null;

    for (const [index, step] of steps.entries()) {
      const position = index + 1;
      await expect(count).toHaveText(`Step ${position} of ${steps.length}`);
      await expect(page.getByTestId('build-panel').getByRole('heading', { level: 2 })).toHaveText(step.title);
      // Everyday part names on screen; the engine's exact wording under "Show the exact pin and part names".
      const plain = plainInstructions(step.instructions, partNicknames(plan, catalog));
      await expect(page.getByTestId('build-instructions')).toHaveText(plain);
      if (plain !== step.instructions) await expect(page.getByTestId('build-instructions-original')).toHaveText(step.instructions);
      const parts = stepParts(step, plan, catalog);
      for (const part of parts) await expect(page.getByTestId(`build-part-${part.instanceId}`)).toContainText(part.name);
      if (needsSafetyAck(step, parts)) {
        const safety = page.getByTestId('build-safety');
        await expect(safety).toBeVisible();
        for (const note of step.safety_notes) await expect(safety).toContainText(note);
        await expect(primary).toBeDisabled();
        await page.getByTestId('build-safety-ack').check();
      } else {
        await expect(page.getByTestId('build-safety')).toHaveCount(0);
      }
      if (step.step === fwStep) {
        const card = page.getByTestId('build-firmware');
        await expect(card).toContainText('Code check: not checked yet');
        await expect(page.getByTestId('build-firmware-download')).toHaveAttribute('href', `/api/projects/${buildId}/exports/firmware.zip?revision=1`);
      } else {
        await expect(page.getByTestId('build-firmware')).toHaveCount(0);
      }
      await expect(primary).toHaveText(position === steps.length ? 'Finish' : 'Next step');
      await expect(primary).toBeEnabled();
      if (position === steps.length && firstShot) {
        // If the rover were framed outside the visible canvas (the blank-scene defect), the first
        // and the last step would render identical pixels.
        const lastShot = await settledScreenshot(canvas);
        expect(lastShot.equals(firstShot), 'the 3D view changes between the first and the last step').toBe(false);
      }
      await primary.click();
    }

    await expect(page).toHaveURL(`/p/${projectId}/done`, { timeout: 60_000 });
    expect(await readProject<StoredProject>(page, projectId)).toMatchObject({ furthestStep: 'done', buildStep: steps.length });
  });

  await test.step('Done: the summary counts match the plan and unresolved checks stay visible', async () => {
    await expect(page.getByTestId('done-step')).toBeVisible();
    await expect(page.getByTestId('done-part-count')).toHaveText(String(plan.components.length));
    await expect(page.getByTestId('done-step-count')).toHaveText(String(steps.length));
    const open = page.getByTestId('done-blockers');
    if (expectedBlockers.length === 0) await expect(open).toContainText('None. Every important check passed.');
    else {
      await expect(open).toContainText(`${expectedBlockers.length} ${expectedBlockers.length === 1 ? 'problem' : 'problems'} couldn't be settled`);
      for (const f of expectedBlockers) await expect(open).toContainText(f.message);
    }
    await expect(page.getByTestId('done-viewport').getByTestId('rover-scene')).toHaveAttribute('data-revision', '1');
  });

  await test.step('Iterate: a preset sends a structured edit, the engine accepts it and Review loads the new revision', async () => {
    await page.getByTestId('done-change').click();
    await expect(page.getByTestId('iterate')).toBeVisible();
    await page.locator('[data-testid="iterate-example"][data-preset="stop-distance"]').click();
    await expect(page.getByTestId('iterate-text')).toHaveValue(EDIT_INSTRUCTION);
    const edited = page.waitForResponse(isPost(`/api/projects/${buildId}/edits`));
    await page.getByTestId('iterate-apply').click();
    const response = await edited;
    const sent = response.request().postDataJSON() as { base_revision: number; instruction: string; operation?: unknown };
    expect(sent).toMatchObject({ base_revision: 1, instruction: EDIT_INSTRUCTION, operation: EDIT_OPERATION });
    expect(response.status(), 'structured edit from the UI').toBe(200);
    const result = (await response.json()) as EditResponse;
    expect(result.accepted, `edit accepted: ${JSON.stringify(result.finding ?? null)}`).toBe(true);
    expect(result.revision).toBe(2);
    await expect(page).toHaveURL(`/p/${projectId}/review`, { timeout: 60_000 });
    expect(await readProject<StoredProject>(page, projectId)).toMatchObject({ revision: 2, reviewDone: false });
    const after = await apiGet<BuildPlan>(request, `/api/projects/${buildId}`);
    expect(after.revision, 'the API revision matches what the UI reported').toBe(2);
  });

  await test.step('Edit through the API: a bounded structured change creates a consistent revision, and Review loads it', async () => {
    const current = await apiGet<BuildPlan>(request, `/api/projects/${buildId}`);
    if (current.revision === 1) {
      const res = await request.post(`${API_URL}/api/projects/${buildId}/edits`, {
        data: { base_revision: 1, instruction: EDIT_INSTRUCTION, operation: EDIT_OPERATION },
      });
      expect(res.status(), 'structured edit on the API').toBe(200);
      const result = (await res.json()) as EditResponse;
      expect(result.accepted, `edit accepted: ${JSON.stringify(result.finding ?? null)}`).toBe(true);
      expect(result.revision).toBe(2);
      await patchProject(page, projectId, { revision: 2, reviewDone: false });
    }
    const edited = await apiGet<BuildPlan>(request, `/api/projects/${buildId}`);
    expect(edited.revision).toBe(2);
    expect(edited.behavior?.parameters.obstacle_stop_distance_m).toBe(0.4);
    expect(edited.provenance.generation_mode).toBe('fallback');
    const original = await apiGet<BuildPlan>(request, `/api/projects/${buildId}?revision=1`);
    expect(original.behavior).toEqual(plan.behavior);
    const revisions = await apiGet<{ revisions: Array<{ revision: number }> }>(request, `/api/projects/${buildId}/revisions`);
    expect(revisions.revisions.map((r) => r.revision)).toEqual([1, 2]);

    await page.goto(`/p/${projectId}/review`);
    await expect(page.getByTestId('review-step')).toBeVisible();
    await expect(page.getByTestId('rover-scene').first()).toHaveAttribute('data-revision', '2', { timeout: 60_000 });
    await expect(page.getByTestId('rover-scene').first()).toHaveAttribute('data-build-id', buildId);
    await page.goto(`/p/${projectId}/wiring`);
    await page.getByTestId('wiring-tab-firmware').click();
    await expect(page.getByTestId('firmware-download')).toHaveAttribute('href', `/api/projects/${buildId}/exports/firmware.zip?revision=2`);
  });

  expect(errors, 'uncaught page errors or console errors during the run').toEqual([]);
});
