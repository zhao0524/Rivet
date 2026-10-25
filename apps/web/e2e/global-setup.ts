import type { FullConfig } from '@playwright/test';

/** Every route the specs visit. `warm` is not a saved project; the shell renders its "not on this device" card. */
const ROUTES = [
  '/',
  '/new',
  '/projects',
  '/studio',
  '/p/warm',
  '/p/warm/workspace',
  '/p/warm/clarify',
  '/p/warm/review',
  '/p/warm/parts',
  '/p/warm/wiring',
  '/p/warm/buy',
  '/p/warm/build',
  '/p/warm/done',
];

/**
 * Requests each route once so `next dev` compiles it before the first test needs it. Without
 * this, the first client-side push into an uncompiled route can wait longer than an assertion.
 * Failures here are ignored: the tests report real problems with real messages.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) return;
  for (const route of ROUTES) {
    try {
      await fetch(new URL(route, baseURL), { redirect: 'manual', signal: AbortSignal.timeout(120_000) });
    } catch {
      // Compile errors and timeouts surface in the specs themselves.
    }
  }
}
