import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { API_PORT, API_URL, REPO_ROOT, WEB_PORT, WEB_URL } from './e2e-acceptance/env';

/**
 * End-to-end acceptance run of the demo path (issue #71): a local API with the real
 * engineering engine and the mock vision provider, plus `next dev` in HTTP mode.
 * No API keys, no network. Kept apart from the fixture-only suite (`playwright.config.ts`,
 * `e2e/`). Usage and environment variables: `e2e-acceptance/README.md`.
 *
 *   pnpm --filter web e2e:acceptance
 */

// One fresh API data directory per run. This file is evaluated again in every worker
// process; they inherit the variable, so the directory is created only once.
if (!process.env.RIVET_E2E_DATA_ROOT) {
  process.env.RIVET_E2E_DATA_ROOT = mkdtempSync(path.join(os.tmpdir(), 'rivet-acceptance-'));
  process.env.RIVET_E2E_DATA_ROOT_CREATED = '1';
}
const DATA_ROOT = process.env.RIVET_E2E_DATA_ROOT;

/** Interpreter that has the API's dependencies; CI points this at a uv-managed venv. */
const PYTHON = process.env.RIVET_PYTHON || 'python3';
const ENGINE_DIR = path.join(REPO_ROOT, 'packages', 'engineering');
const REPORT_DIR = 'playwright-report/acceptance';

/**
 * Where `next dev` runs. Defaults to this app. Point it at a copy of apps/web when another
 * `next dev` already serves this directory: two dev servers share one `.next/` and corrupt it.
 */
const WEB_CWD = process.env.E2E_ACCEPTANCE_WEB_CWD || __dirname;

/** Opt-in browser channel (`E2E_CHANNEL=chrome`), as in `playwright.config.ts`. */
const CHANNEL = process.env.E2E_CHANNEL?.trim() || undefined;
const CHANNEL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

export default defineConfig({
  testDir: './e2e-acceptance',
  outputDir: './test-results/acceptance',
  // The whole flow is one ordered story against shared servers: one worker, no retries.
  // Generation, eleven assembly steps with the 3D scene, downloads and an edit: ten minutes.
  timeout: 600_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI
    ? [['list'], ['github'], ['html', { open: 'never', outputFolder: REPORT_DIR }]]
    : [['list'], ['html', { open: 'never', outputFolder: REPORT_DIR }]],
  globalTeardown: './e2e-acceptance/global-teardown.ts',
  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...(CHANNEL ? { channel: CHANNEL, launchOptions: { args: CHANNEL_ARGS } } : {}),
  },
  projects: [
    {
      name: 'chromium',
      // The window size of the manual review that found the off-screen canvas (#70).
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 717 } },
    },
  ],
  webServer: [
    {
      name: 'api',
      command: `${PYTHON} -m uvicorn rivet_api.main:app --host 127.0.0.1 --port ${API_PORT} --no-access-log`,
      cwd: path.join(REPO_ROOT, 'services', 'api'),
      url: `${API_URL}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        // Real engine from the checkout (CI also installs it into the venv).
        PYTHONPATH: [ENGINE_DIR, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
        PYTHONUNBUFFERED: '1',
        RIVET_MODE: 'live',
        // The mock returns the saved rover intent, so the plan is honestly labeled `fallback`.
        RIVET_VISION_PROVIDER: 'mock',
        RIVET_DATA_ROOT: DATA_ROOT,
        RIVET_ENABLE_ESTELLE: 'false',
        // Never hand a provider key to this server, even if the shell has one.
        OPENAI_API_KEY: '',
        BACKBOARD_API_KEY: '',
      },
    },
    {
      name: 'web',
      // `npx` so the run does not depend on pnpm being on PATH (same as playwright.config.ts).
      command: `npx next dev --port ${WEB_PORT}`,
      cwd: WEB_CWD,
      url: `${WEB_URL}/new`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        // HTTP mode: the app talks to the API above instead of the checked-in fixtures.
        NEXT_PUBLIC_RIVET_USE_FIXTURES: 'false',
        RIVET_NEXT_DIST_DIR: '.next-acceptance',
        // next.config.mjs rewrites /api/* to this origin; the browser stays same-origin.
        NEXT_PUBLIC_RIVET_API_URL: API_URL,
        NEXT_TELEMETRY_DISABLED: '1',
      },
    },
  ],
});
