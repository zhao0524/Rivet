/**
 * Enumerates every `products/*.json` and `offers/*.json` next to this file so the real
 * `fixtures/showcase/` files can be dropped in without listing them in code. This is the
 * webpack (Next.js) implementation via `require.context`; Vitest resolves this module to
 * `enumerate-files.vite.ts` (see `vitest.config.ts`), which does the same with `import.meta.glob`.
 */
import type { RawFixtureFiles } from "./enumerate-files-types";

declare global {
  namespace NodeJS {
    interface Require {
      context(directory: string, useSubdirectories: boolean, pattern: RegExp): {
        keys(): string[];
        (key: string): unknown;
      };
    }
  }
}

function fromContext(ctx: { keys(): string[]; (key: string): unknown }): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of ctx.keys()) {
    const file = key.replace(/^\.\//, "");
    const mod = ctx(key) as { default?: unknown };
    out[file] = mod && typeof mod === "object" && "default" in mod ? mod.default : mod;
  }
  return out;
}

export function loadRawFixtureFiles(): RawFixtureFiles {
  return {
    products: fromContext(require.context("./products", false, /\.json$/)),
    offers: fromContext(require.context("./offers", false, /\.json$/)),
  };
}
