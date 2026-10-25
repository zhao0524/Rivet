import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3918);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

/**
 * Opt-in browser channel, e.g. `E2E_CHANNEL=chrome` to run with the installed Google Chrome
 * when the pinned Playwright Chromium build is not downloaded. Unset (CI) keeps Playwright's
 * own Chromium. Chrome's headless mode needs the SwiftShader flags for the WebGL scenes.
 */
const CHANNEL = process.env.E2E_CHANNEL?.trim() || undefined;
const CHANNEL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

/**
 * Flow E2E coverage against the offline fixture data source: landing → prompt → clarify →
 * generate → the five steps → done, projects, theme, mobile layout. No API server needed.
 * `npx playwright install chromium` once, then `npm run e2e`. Point E2E_BASE_URL at an
 * already-running fixture-mode dev server to skip the managed one.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Every test drives WebGL scenes; a few workers keep a dev server responsive.
  workers: process.env.CI ? 2 : 3,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...(CHANNEL ? { channel: CHANNEL, launchOptions: { args: CHANNEL_ARGS } } : {}),
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
        },
      },
});
