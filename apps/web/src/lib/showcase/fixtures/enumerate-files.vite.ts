/**
 * Vite / Vitest counterpart of `enumerate-files.ts`: `vitest.config.ts` aliases `./enumerate-files` to this file
 * because `require.context` does not exist outside webpack. Both must enumerate the same
 * `products/*.json` and `offers/*.json` files.
 */
import type { RawFixtureFiles } from "./enumerate-files-types";

declare global {
  interface ImportMeta {
    glob<T = unknown>(pattern: string, options: { eager: true }): Record<string, T>;
  }
}

function fromGlob(modules: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [path, mod] of Object.entries(modules)) {
    const file = path.slice(path.lastIndexOf("/") + 1);
    out[file] = mod && typeof mod === "object" && "default" in (mod as object) ? (mod as { default: unknown }).default : mod;
  }
  return out;
}

export function loadRawFixtureFiles(): RawFixtureFiles {
  return {
    products: fromGlob(import.meta.glob("./products/*.json", { eager: true })),
    offers: fromGlob(import.meta.glob("./offers/*.json", { eager: true })),
  };
}
