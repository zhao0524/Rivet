import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3918);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

/**
 * Studio E2E coverage (issue #34). Runs headlessly against the fixture data
 * source — no API server needed. `npx playwright install chromium` once, then
 * `npm run e2e`. Point E2E_BASE_URL at an already-running server to skip the
 * managed dev server.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `npx next dev --port ${PORT}`,
        url: BASE_URL,
        reuseExistingServer: false,
        timeout: 180_000,
        env: {
          NEXT_PUBLIC_RIVET_USE_FIXTURES: 'true',
          RIVET_NEXT_DIST_DIR: '.next-e2e',
        },
      },
});
