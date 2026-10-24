import { readFileSync } from 'node:fs';
import { expect, test, type APIRequestContext, type Locator, type Page, type Response } from '@playwright/test';
import type { BomItem, BuildPlan, JobResponse } from '../src/lib/rivet/types';
import { API_URL, REFERENCE_IMAGE } from './env';
import { expectSceneFitsContainer, readZip, watchPageErrors } from './helpers';

/** Plain rover request; the mock vision provider refuses prompts that mention drones or arms. */
const PROMPT = 'Build a small two-wheeled rover like this one that avoids obstacles.';

/**
 * Today's default sourced rover (engine catalog `catalog-v1.2-2026-10-24`, see
 * packages/engineering/README.md) has 17 placed components on 15 BOM lines: the two TT
 * motors and the two wheels each share one line (quantity 2). The mock intent always asks
 * for that rover, so the number is fixed; change it together with the engine's default rover.
 */
const EXPECTED_BOM_LINES = 15;

/** What the verification panel must say for each plan status (never "verified" unless it is). */
const STATUS_LABEL: Record<BuildPlan['status'], RegExp> = {
  verified: /^Status: Verified \(implemented checks passed\)$/,
  verified_with_warnings: /^Status: Verified with warnings$/,
  needs_review: /^Status: Needs review$/,
  unbuildable: /^Status: Unbuildable$/,
};

/** GET /api/projects/{id} adds the response-only `provenance.sourcing` (contracts/api.md). */
type ApiPlan = BuildPlan & {
  provenance: BuildPlan['provenance'] & { sourcing?: { synthetic: boolean } };
};

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

function isPost(path: string) {
  return (response: Response) =>
    response.request().method() === 'POST' && new URL(response.url()).pathname === path;
}

async function apiGet<T>(request: APIRequestContext, path: string): Promise<T> {
  const res = await request.get(`${API_URL}${path}`);
  expect(res.status(), `GET ${path} on the API`).toBe(200);
  return (await res.json()) as T;
}

/**
 * Clicks a studio export link and waits for the browser download, then requests the same
 * href (through the same Next.js proxy) to check the HTTP status and headers, which a
 * Playwright download does not expose.
 */
async function downloadFromStudio(page: Page, link: Locator) {
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

test('reference image to a real-engine rover: verified parts, assembly steps, BOM and firmware exports', async ({
  page,
  request,
}) => {
  const errors = watchPageErrors(page);

  await test.step('the API runs in live mode (real engine, mock vision)', async () => {
    expect(await apiGet(request, '/api/health')).toEqual({ ok: true, mode: 'live' });
  });

  await test.step('the studio opens on the HTTP data source', async () => {
    await page.goto('/studio?dev=1');
    await page.getByTestId('developer-menu').click();
    await expect(page.getByTestId('datasource-mode-http')).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
    // The stage leaves `pending` only after hydration, so clicks below reach React.
    await expect(page.locator('[data-rivet-stage]')).not.toHaveAttribute('data-stage-state', 'pending');
  });

  let jobId = '';
  await test.step('upload the reference image, enter a prompt and generate', async () => {
    await page.getByTestId('header-toggle-intake').click();
    await expect(page.locator('[data-rivet="build-intake"]')).toBeVisible();
    await page.getByTestId('image-dropzone-input').setInputFiles(REFERENCE_IMAGE);
    await expect(page.getByRole('img', { name: 'Preview of rover-reference.png' })).toBeVisible();
    await page.getByLabel(/What should it do/).fill(PROMPT);

    const uploaded = page.waitForResponse(isPost('/api/assets/images'));
    let generateCount = 0;
    page.on('request', (request) => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/projects/generate') generateCount += 1; });
    await page.getByRole('button', { name: 'Review interpretation' }).click();
    await expect(page.getByTestId('interpretation-card')).toContainText('rover');
    expect(generateCount, 'engine must wait for confirmation').toBe(0);
    const generated = page.waitForResponse(isPost('/api/projects/generate'));
    await page.getByRole('button', { name: 'Confirm and build' }).click();

    const upload = await uploaded;
    expect(upload.status(), 'image upload').toBe(200);
    const asset = (await upload.json()) as { asset_id: string; mime_type: string };
    expect(asset.mime_type).toBe('image/png');

    const generate = await generated;
    expect(generate.status(), 'generate request').toBe(202);
    expect(generate.request().postDataJSON()).toMatchObject({
      input: { kind: 'image_and_text', image_asset_id: asset.asset_id, user_text: PROMPT },
    });
    jobId = ((await generate.json()) as { job_id: string }).job_id;
    expect(jobId).toBeTruthy();
  });

  let buildId = '';
  await test.step('the job completes and the studio reports the new build', async () => {
    await expect
      .poll(async () => (await apiGet<JobResponse>(request, `/api/jobs/${jobId}`)).status, { timeout: 60_000 })
      .toBe('complete');
    const job = await apiGet<JobResponse>(request, `/api/jobs/${jobId}`);
    expect(job.build_id).toBeTruthy();
    expect(job.revision).toBe(1);
    buildId = job.build_id!;

    await expect(page.getByRole('dialog', { name: 'New build' })).toBeHidden();
  });

  const plan = await apiGet<ApiPlan>(request, `/api/projects/${buildId}`);

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
  });
  test.info().annotations.push({
    type: 'build',
    description: `${buildId} r1: ${plan.status}, ${plan.components.length} components, ${plan.bom.items.length} BOM lines, ${plan.assembly_steps.length} steps`,
  });

  const canvas = page.locator('[data-rivet-stage] canvas').first();
  const fallback = page.locator('[data-stage-fallback]');
  let webgl = false;

  await test.step('the studio shows the generated rover', async () => {
    await expect(page.locator('[data-rivet="build-intake"]')).toHaveCount(0);

    await expect(page.getByTestId('studio-build-title')).toHaveText(plan.title);
    await expect(page.getByTestId('studio-build-identity')).toHaveText(`${buildId} · rev 1 · status: ${plan.status}`);
    const banner = page.getByTestId('provenance-trust-banner');
    await expect(banner).toHaveAttribute('data-trust-label', 'Fallback output');
    await expect(banner).toHaveAttribute('data-synthetic', 'false');
    await expect(banner).toContainText('Fallback');

    const scene = page.getByTestId('rover-scene');
    await expect(scene).toHaveAttribute('data-build-id', buildId);
    await expect(scene).toHaveAttribute('data-revision', '1');
    // A WebGL canvas, or the documented fallback when the browser cannot start WebGL.
    await expect(canvas).toBeVisible();
    await expect(fallback, 'rendering acceptance requires WebGL; fallback is tested separately').toHaveCount(0);
    webgl = (await fallback.count()) === 0;
    if (webgl) {
      await expect(page.locator('[data-stage-context-lost]')).toHaveCount(0);
    } else {
      await expect(fallback).toContainText(/3D view unavailable/i);
    }
    test.info().annotations.push({ type: 'webgl', description: webgl ? 'canvas rendered' : 'fallback shown' });

    for (const component of plan.components) {
      await expect(page.getByTestId(`tree-item-${component.instance_id}`)).toBeVisible();
    }
    await expectSceneFitsContainer(page, 'Design mode');
  });

  await test.step('Inspect: every BOM line with real links, and the verification status', async () => {
    await page.getByTestId('studio-mode-inspect').click();
    const bom = page.getByTestId('bom-panel');
    await expect(bom).toBeVisible();
    // The UI shows exactly the API plan's BOM.
    await expect(bom.locator('tr[data-testid^="bom-row-"]')).toHaveCount(plan.bom.items.length);
    await expect(page.getByTestId('bom-row-count')).toHaveText(`${plan.bom.items.length} line items`);

    const { currency } = plan.bom;
    for (const item of plan.bom.items) {
      const id = item.catalog_id;
      await expect(page.getByTestId(`bom-row-${id}`)).toBeVisible();
      await expect(page.getByTestId(`bom-qty-${id}`)).toHaveText(String(item.quantity));
      const link = page.getByTestId(`bom-link-${id}`);
      await expect(link).toHaveAttribute('data-link-status', item.link_status);
      if (isPriced(item) || item.link_status === 'verified_product') {
        // Anything that costs money, and anything called a verified product, is a product
        // listing with an https link, and the studio links exactly that URL.
        expect(isHttpsUrl(item.purchase_url), `${id}: https purchase_url, got ${item.purchase_url}`).toBe(true);
        expect(item.link_status, `${id}: link_status`).toBe('verified_product');
        await expect(link).toHaveAttribute('href', item.purchase_url!);
        await expect(link).toHaveText('Product listing');
      } else {
        // Kit items that come with another part (today the Shadow Chassis nub caster at 0.00,
        // `manufacturer_reference_only`; services/api/README.md "Real products only") are not
        // sold separately and must not look like a store listing.
        await expect(link).not.toHaveText('Product listing');
        if (!item.purchase_url) await expect(link).toHaveText('No link available');
      }
      const price = item.unit_price_amount === null ? 'Unknown' : `${item.unit_price_amount} ${currency}`;
      await expect(page.getByTestId(`bom-price-${id}`)).toHaveText(price);
    }
    const total = page.getByTestId('bom-total');
    await expect(total).toHaveAttribute('data-total-status', plan.bom.total_status);
    if (plan.bom.total_status === 'complete' && plan.bom.known_subtotal_amount !== null) {
      await expect(total).toHaveText(`Total: ${plan.bom.known_subtotal_amount} ${currency}`);
    }

    const overall = page.getByTestId('verification-overall');
    await expect(overall).toHaveAttribute('data-status', plan.verification.overall);
    await expect(overall).toHaveText(STATUS_LABEL[plan.verification.overall]);
    // A non-live plan is flagged as not describing verified physical hardware.
    await expect(page.getByTestId('verification-synthetic-notice')).toContainText('Generated in fallback mode');
    for (const result of ['PASS', 'WARN', 'FAIL', 'UNKNOWN'] as const) {
      const count = plan.verification.findings.filter((f) => f.result === result).length;
      await expect(page.getByTestId(`verification-count-${result}`)).toHaveText(`${({ PASS: "Passed", WARN: "Warning", FAIL: "Failed", UNKNOWN: "Unknown" })[result]}: ${count}`);
    }
    const blocking = plan.verification.findings.filter((f) => f.severity === 'blocking' && f.result !== 'PASS');
    if (blocking.length > 0) {
      await expect(page.getByTestId('verification-blocking-summary')).toHaveText(
        `${blocking.length} blocking finding${blocking.length === 1 ? '' : 's'} unresolved`,
      );
    }
    // The long BOM and finding lists are what used to stretch the canvas (#70).
    await expectSceneFitsContainer(page, 'Inspect mode with the full BOM and findings');
  });

  await test.step('Assemble: step through every assembly step', async () => {
    await page.getByTestId('studio-mode-assemble').click();
    await expect(page.getByTestId('rover-scene')).toHaveAttribute('data-assembly-mode', 'step');
    await expect(page.getByTestId('assembly-bom-coverage')).toHaveAttribute('data-complete', 'true');
    const covered = new Set(plan.assembly_steps.flatMap((step) => step.instance_ids));
    for (const row of plan.bom.items) for (const id of row.instance_ids) expect(covered.has(id), `assembly covers ${id}`).toBe(true);
    const steps = plan.assembly_steps;
    expect(steps.length).toBeGreaterThan(0);
    // One pill per step plus "0 · Prep".
    await expect(page.locator('[data-testid^="timeline-step-pill-"]')).toHaveCount(steps.length + 1);
    await expect(page.getByTestId('inspector-assembly-steps')).toContainText(`Assembly steps (${steps.length})`);
    await expectSceneFitsContainer(page, 'Assemble mode with the timeline open');

    await page.getByTestId('timeline-step-pill-0').click();
    const details = page.getByTestId('timeline-active-step-details');
    await expect(details).toHaveCount(0);
    const prepShot = webgl ? await settledScreenshot(canvas) : null;

    const next = page.getByTestId('step-timeline-panel').getByRole('button', { name: 'Next step', exact: true });
    for (const [index, step] of steps.entries()) {
      const position = index + 1;
      await next.click();
      await expect(page.getByTestId(`timeline-step-pill-${position}`)).toHaveAttribute('aria-pressed', 'true');
      await expect(details).toContainText(`Step ${step.step}: ${step.title}`);
      for (const instanceId of step.instance_ids) {
        await expect(page.getByTestId(`timeline-step-instance-${instanceId}`)).toBeVisible();
      }
      await expect(page.getByTestId(`inspector-step-${position}`)).toHaveAttribute('aria-current', 'step');
    }
    await expect(next).toBeDisabled();

    if (prepShot) {
      // If the rover were framed outside the visible canvas (the blank-scene defect), the
      // empty preparation step and the full assembly would render identical pixels.
      const assembledShot = await settledScreenshot(canvas);
      expect(assembledShot.equals(prepShot), 'the 3D view changes between step 0 and the full assembly').toBe(false);
    }
  });

  await test.step('Export: BOM CSV and firmware ZIP download from the studio', async () => {
    await page.getByTestId('header-open-export').click();
    const dialog = page.getByTestId('export-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('firmware-compile-status')).toHaveText('not_checked');
    await expect(dialog.getByTestId('estelle-status-badge')).toHaveText('disabled');
    await expect(dialog.getByTestId('estelle-ground-button')).toHaveCount(0);

    const bomLink = dialog.getByTestId('export-bom-csv');
    await expect(bomLink).toHaveAttribute('href', `/api/projects/${buildId}/exports/bom.csv?revision=1`);
    const csv = await downloadFromStudio(page, bomLink);
    expect(csv.download.suggestedFilename()).toBe(`${buildId}-r1-bom.csv`);
    expect(csv.response.status()).toBe(200);
    expect(csv.response.headers()['content-type']).toMatch(/^text\/csv\b/);
    expect(csv.response.headers()['content-disposition']).toBe(`attachment; filename="${buildId}-r1-bom.csv"`);
    expect(csv.response.headers()['x-rivet-generation-mode']).toBe('fallback');
    expect(csv.response.headers()['x-rivet-synthetic']).toBe('false');
    // The browser saved the API's artifact itself, not a client-side rebuild.
    expect(csv.body.equals(await csv.response.body())).toBe(true);
    const lines = csv.body.toString('utf8').trim().split(/\r?\n/);
    expect(lines[0]).toMatch(/^catalog_id,/);
    const rows = lines.slice(1).filter((line) => !line.startsWith('TOTAL,'));
    expect(rows.map((line) => line.split(',')[0])).toEqual(plan.bom.items.map((item) => item.catalog_id));

    const firmwareLink = dialog.getByTestId('export-firmware-zip');
    await expect(firmwareLink).toHaveAttribute('href', `/api/projects/${buildId}/exports/firmware.zip?revision=1`);
    const zip = await downloadFromStudio(page, firmwareLink);
    expect(zip.download.suggestedFilename()).toBe(`${buildId}-r1-firmware.zip`);
    expect(zip.response.status()).toBe(200);
    expect(zip.response.headers()['content-type']).toBe('application/zip');
    expect(zip.response.headers()['content-disposition']).toBe(`attachment; filename="${buildId}-r1-firmware.zip"`);
    expect(zip.response.headers()['x-rivet-compile-status']).toBe('not_checked');
    expect(zip.response.headers()['x-rivet-generation-mode']).toBe('fallback');
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
  });

  await test.step('Edit: a bounded change creates a consistent revision without altering history', async () => {
    await page.keyboard.press('Escape');
    await page.getByTestId('studio-mode-design').click();
    await page.getByTestId('preset-edit-stop-distance').click();
    await expect(page.getByTestId('studio-build-identity')).toContainText('rev 2');
    const edited = await apiGet<BuildPlan>(request, `/api/projects/${buildId}`);
    expect(edited.revision).toBe(2);
    expect(edited.behavior.parameters.obstacle_stop_distance_m).toBe(0.4);
    expect(edited.provenance.generation_mode).toBe('fallback');
    const original = await apiGet<BuildPlan>(request, `/api/projects/${buildId}?revision=1`);
    expect(original.behavior).toEqual(plan.behavior);
    await expect(page.getByTestId('rover-scene')).toHaveAttribute('data-revision', '2');
    await page.getByTestId('header-open-export').click();
    await expect(page.getByTestId('export-bom-csv')).toHaveAttribute('href', `/api/projects/${buildId}/exports/bom.csv?revision=2`);
    await expect(page.getByTestId('export-firmware-zip')).toHaveAttribute('href', `/api/projects/${buildId}/exports/firmware.zip?revision=2`);
  });

  expect(errors, 'uncaught page errors or console errors during the run').toEqual([]);
});
