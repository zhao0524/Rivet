import path from 'node:path';

/**
 * Ports and paths shared by `playwright.acceptance.config.ts` and the acceptance specs.
 * Defaults are deliberately unusual so a developer's own servers (3000, 3100, 8000) are
 * never reused by accident; override them with the environment variables below.
 */
function port(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`${name} must be a TCP port number, got ${JSON.stringify(raw)}`);
  }
  return value;
}

export const WEB_PORT = port('E2E_ACCEPTANCE_WEB_PORT', 3917);
export const API_PORT = port('E2E_ACCEPTANCE_API_PORT', 8917);

export const WEB_URL = `http://localhost:${WEB_PORT}`;
/** IPv4 on purpose: uvicorn binds 127.0.0.1, and `localhost` may resolve to ::1 first. */
export const API_URL = `http://127.0.0.1:${API_PORT}`;

export const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
/** Original, repo-owned illustration (provenance in fixtures/README.md). */
export const REFERENCE_IMAGE = path.join(REPO_ROOT, 'fixtures', 'images', 'rover-reference.png');
