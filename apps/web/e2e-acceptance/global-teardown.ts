import { rmSync } from 'node:fs';

/**
 * Removes the API data directory the config created for this run (projects, jobs and the
 * uploaded image). A directory passed in through RIVET_E2E_DATA_ROOT is left alone.
 */
export default function globalTeardown(): void {
  const dir = process.env.RIVET_E2E_DATA_ROOT;
  if (dir && process.env.RIVET_E2E_DATA_ROOT_CREATED === '1') {
    rmSync(dir, { recursive: true, force: true });
  }
}
