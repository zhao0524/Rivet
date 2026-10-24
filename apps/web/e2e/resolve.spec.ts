import { expect, test, type Page, type Route } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { watchPageErrors } from './helpers';

async function open(page: Page, outcome: string) {
  await page.goto(`/studio?resolve=${outcome}`);
  const dialog = page.getByRole('dialog', { name: 'Product match' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('resolve-saved-banner')).toContainText('not a live lookup');
  await expect(dialog.getByTestId('resolve-result')).toHaveAttribute('data-claimed-outcome', outcome);
  return dialog;
}

test('exact match lists parts with labels and a source popover', async ({ page }) => {
  const errors = watchPageErrors(page);
  const d = await open(page, 'exact_match');
  await expect(d.getByTestId('resolve-result')).toHaveAttribute('data-outcome', 'exact_match');
  await expect(d.getByTestId('resolve-headline')).toContainText('We found this product: Example Aero');
  await expect(d.getByTestId('resolve-sku')).toContainText('EA-SCOUT-MINI');
  await expect(d.getByTestId('resolve-part-motor').getByTestId('part-status')).toHaveText('Verified');
  await expect(d.getByTestId('resolve-part-gps').getByTestId('part-status')).toHaveText('Not sold separately');
  await expect(d.getByTestId('resolve-provenance-banner')).toContainText('Saved example');
  await expect(d.getByTestId('no-source-gps')).toBeVisible();
  await expect(d.getByTestId('resolve-typical')).toHaveCount(0);
  // Nothing was over-claimed, so there is no downgrade notice.
  await expect(d.getByTestId('resolve-downgrade-notice')).toHaveCount(0);

  await d.getByTestId('source-toggle-motor').click();
  const pop = d.getByTestId('source-popover-motor');
  // One record for the part number and one for the material, both from the distributor page.
  await expect(pop.getByRole('link')).toHaveCount(2);
  await expect(pop.getByRole('link').first()).toHaveAttribute('href', /saved-example\/shop\/m1103/);
  await expect(pop).toContainText('Material Aluminium');
  await expect(pop).toContainText('Distributor');
  await expect(pop).toContainText(/fetched \d{4}-\d{2}-\d{2}/);
  expect(errors).toEqual([]);
});

test('partial match says what could not be confirmed and separates typical parts', async ({ page }) => {
  const errors = watchPageErrors(page);
  const d = await open(page, 'partial_match');
  await expect(d.getByTestId('resolve-headline')).toHaveText(
    'We found the product but could not confirm 5 of 6 parts',
  );
  await expect(d.getByTestId('resolve-conflict-esc')).toContainText('EA-ESC-4A and EA-ESC-5A');
  await expect(d.getByTestId('resolve-part-frame').getByTestId('part-status')).toHaveText('Inferred');
  await expect(d.getByTestId('resolve-part-esc').getByTestId('part-status')).toHaveText('Sources disagree');
  await d.getByTestId('source-toggle-esc').click();
  await expect(d.getByTestId('source-popover-esc').getByRole('link')).toHaveCount(2);
  await d.getByTestId('source-toggle-frame').click();
  await expect(d.getByTestId('source-popover-frame')).toContainText('cannot count as verified');
  const typical = d.getByTestId('resolve-typical');
  await expect(typical).toContainText('What similar products use');
  await expect(typical).toContainText('not parts of your product');
  await expect(d.getByTestId('resolve-parts')).not.toContainText('EA-CAM-12');
  await d.getByTestId('resolve-ledger').locator('summary').click();
  await expect(d.getByTestId('resolve-ledger').locator('[data-support="rejected"]')).toContainText(
    'does not contain the claimed value',
  );
  expect(errors).toEqual([]);
});

test('a part claimed verified on an out-of-date source is shown as out of date', async ({ page }) => {
  const d = await open(page, 'partial_match');
  const row = d.getByTestId('resolve-part-props');
  await expect(row).toHaveAttribute('data-claimed-status', 'verified');
  await expect(row.getByTestId('part-status')).toHaveText('Out of date');
  await expect(d.getByTestId('resolve-downgrade-props')).toContainText('freshness window');
  await expect(d.getByTestId('resolve-downgrade-notice')).toContainText('1 part claims more than');
});

test('no match shows alternatives and typical parts, never a product', async ({ page }) => {
  const errors = watchPageErrors(page);
  const d = await open(page, 'no_match_with_alternatives');
  await expect(d.getByTestId('resolve-headline')).toHaveText('We could not find this exact product');
  await expect(d.getByTestId('resolve-sku')).toHaveCount(0);
  await expect(d.getByTestId('resolve-parts')).toHaveCount(0);
  await expect(d.getByTestId('resolve-alternatives')).toContainText('Pocket 4 drone');
  await expect(d.getByTestId('resolve-typical')).toContainText('2 of 2 verified comparable drones');
  expect(errors).toEqual([]);
});

test('unsupported explains why and what to upload instead', async ({ page }) => {
  const errors = watchPageErrors(page);
  const d = await open(page, 'unsupported');
  await expect(d.getByTestId('resolve-result')).toContainText('landscape');
  await expect(d.getByTestId('resolve-unsupported-help')).toContainText('What to upload instead');
  await expect(d.getByTestId('resolve-parts')).toHaveCount(0);
  await expect(d.getByTestId('resolve-alternatives')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('product match opens from the header in fixture mode and switches outcome', async ({ page }) => {
  await page.goto('/studio');
  await page.getByTestId('header-open-resolve').click();
  const d = page.getByRole('dialog', { name: 'Product match' });
  await expect(d.getByTestId('resolve-result')).toHaveAttribute('data-outcome', 'exact_match');
  await d.getByTestId('resolve-fixture-select').selectOption('unsupported');
  await expect(d.getByTestId('resolve-result')).toHaveAttribute('data-outcome', 'unsupported');
});

// ---- live API: the dialog runs a real lookup through POST /api/resolve ---------------------
// The API is mocked at the network layer with real responses captured from services/api.
const SAMPLES = join(__dirname, '..', 'src', 'lib', 'resolve', '__tests__', 'api-samples');
const sample = (name: string) => JSON.parse(readFileSync(join(SAMPLES, `${name}.json`), 'utf8'));

async function openLive(page: Page, onApi: (route: Route, path: string) => Promise<void> | void) {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/resolve' || path.startsWith('/api/jobs/res-job') || path.startsWith('/api/resolutions/')) {
      await onApi(route, path);
      return;
    }
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'not mocked', details: null, retryable: false } }),
    });
  });
  await page.goto('/studio?dev=1');
  await page.getByTestId('developer-menu').click();
  await page.getByTestId('datasource-mode-http').click();
  await page.keyboard.press('Escape');
  await page.getByTestId('header-open-resolve').click();
  const dialog = page.getByRole('dialog', { name: 'Product match' });
  await expect(dialog.getByTestId('resolve-live')).toBeVisible();
  await expect(dialog.getByTestId('resolve-saved-banner')).toHaveCount(0);
  return dialog;
}

const fulfill = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

test('live: a described product is looked up and its checked result shown', async ({ page }) => {
  const resolution = sample('exact_match');
  let polls = 0;
  let sent: unknown = null;
  const d = await openLive(page, (route, path) => {
    if (path === '/api/resolve') {
      sent = route.request().postDataJSON();
      return fulfill(route, 202, { job_id: 'res-job-1', status: 'queued', resolution_id: null });
    }
    if (path === '/api/jobs/res-job-1') {
      polls += 1;
      return fulfill(
        route,
        200,
        polls < 2
          ? { job_id: 'res-job-1', status: 'running', stage: 'verify', progress: 0.5 }
          : { job_id: 'res-job-1', status: 'complete', stage: 'complete', progress: 1, resolution_id: resolution.resolution_id },
      );
    }
    // The stored evidence is dated when it was captured; serve it as fetched just now.
    const fresh = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    return fulfill(route, 200, {
      ...resolution,
      ledger: resolution.ledger.map((e: { evidence: object }) => ({ ...e, evidence: { ...e.evidence, fetched_at: fresh } })),
    });
  });
  await d.getByTestId('resolve-text-input').fill('DJI Mini 4 drone');
  await d.getByTestId('resolve-submit').click();
  await expect(d.getByTestId('resolve-result')).toHaveAttribute('data-outcome', 'exact_match');
  expect(sent).toEqual({ input: { kind: 'text', image_asset_id: null, user_text: 'DJI Mini 4 drone' } });
  await expect(d.getByTestId('resolve-headline')).toHaveText('We found this product: DJI Mini 4');
  await expect(d.getByTestId('resolve-part-gimbal').getByTestId('part-status')).toHaveText('Not sold separately');
  // The stub resolver is sample data, and the server says so; the UI repeats it.
  await expect(d.getByTestId('resolve-provenance-banner')).toContainText('Saved example');
});

test('live: a failed lookup shows the server error and no result', async ({ page }) => {
  const d = await openLive(page, (route, path) => {
    if (path === '/api/resolve') return fulfill(route, 202, { job_id: 'res-job-2', status: 'queued', resolution_id: null });
    return fulfill(route, 200, {
      job_id: 'res-job-2',
      status: 'failed',
      stage: 'failed',
      progress: null,
      error: {
        code: 'RESOLVER_OFFLINE',
        message: 'Sources could not be reached, so nothing was resolved. No saved data was substituted',
        details: null,
        retryable: true,
      },
    });
  });
  await d.getByTestId('resolve-text-input').fill('DJI Mini 4');
  await d.getByTestId('resolve-submit').click();
  const error = d.getByTestId('resolve-error');
  await expect(error).toHaveAttribute('data-code', 'RESOLVER_OFFLINE');
  await expect(error).toContainText('No saved data was substituted');
  await expect(d.getByTestId('resolve-result')).toHaveCount(0);
});

test('live: a server that refuses the lookup up front is reported plainly', async ({ page }) => {
  const d = await openLive(page, (route) =>
    fulfill(route, 503, {
      error: {
        code: 'RESOLVER_UNAVAILABLE',
        message: 'No live product resolver is configured, so this product cannot be looked up',
        details: { resolver: 'stub' },
        retryable: false,
      },
    }),
  );
  await d.getByTestId('resolve-text-input').fill('DJI Mini 4');
  await d.getByTestId('resolve-submit').click();
  await expect(d.getByTestId('resolve-error')).toContainText('No live product resolver is configured');
});
