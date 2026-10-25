/**
 * Checked-in showcase catalogue served by `FixtureSource` and the landing-page gallery.
 * Layout mirrors `fixtures/showcase/`: `index.json`, `products/<product_id>.json` and
 * `offers/<name>.json` (pre-collected `OfferSet`s keyed by `query.normalized_key`).
 * Every file is enumerated at build time (`enumerate-files.ts`), so the engine's real output replaces
 * the hand-made `sample-*` files without a code change; `__tests__/fixtures.test.ts`
 * fails on drift against the shared folder and on a product file the index does not list.
 */
import rawIndex from "./index.json";
import { loadRawFixtureFiles } from "./enumerate-files";
import type { OfferSet } from "../../offers/types";
import { parseOfferSet } from "../../offers/validate";
import type { ShowcaseCategory, ShowcaseIndex, ShowcaseProduct } from "../types";
import { parseShowcaseIndex, parseShowcaseProduct } from "../validate";

export const SHOWCASE_FIXTURE_LABEL = "Checked-in catalogue snapshot";

export const RAW_SHOWCASE_INDEX: unknown = rawIndex;
const rawFiles = loadRawFixtureFiles();
/** Raw product documents keyed by file name, e.g. `sample-simple-raspberry-pi-robot.json`. */
export const RAW_SHOWCASE_PRODUCT_FILES: Readonly<Record<string, unknown>> = rawFiles.products;
/** Raw offer sets keyed by file name. */
export const RAW_SHOWCASE_OFFER_FILES: Readonly<Record<string, unknown>> = rawFiles.offers;

export interface ShowcaseFixtures {
  index: ShowcaseIndex;
  products: ReadonlyMap<string, ShowcaseProduct>;
  /** Pre-collected offer sets by `query.normalized_key`. */
  offersByKey: ReadonlyMap<string, OfferSet>;
}

let parsed: ShowcaseFixtures | null = null;

/** Parses every fixture once; any file that violates its contract fails the whole catalogue closed. */
export function showcaseFixtures(): ShowcaseFixtures {
  if (parsed) return parsed;
  const index = parseShowcaseIndex(RAW_SHOWCASE_INDEX);
  const products = new Map<string, ShowcaseProduct>();
  for (const file of Object.keys(RAW_SHOWCASE_PRODUCT_FILES).sort()) {
    const product = parseShowcaseProduct(RAW_SHOWCASE_PRODUCT_FILES[file]);
    products.set(product.product_id, product);
  }
  const offersByKey = new Map<string, OfferSet>();
  for (const file of Object.keys(RAW_SHOWCASE_OFFER_FILES).sort()) {
    const set = parseOfferSet(RAW_SHOWCASE_OFFER_FILES[file]);
    offersByKey.set(set.query.normalized_key, set);
  }
  parsed = { index, products, offersByKey };
  return parsed;
}

export function showcaseFixtureIndex(category?: ShowcaseCategory): ShowcaseIndex {
  const { index } = showcaseFixtures();
  const copy = structuredClone(index);
  if (category) copy.products = copy.products.filter((p) => p.category === category);
  return copy;
}

/** The product for an id the index lists, or null (an unlisted file is ignored, never served). */
export function showcaseFixtureProduct(productId: string): ShowcaseProduct | null {
  const { index, products } = showcaseFixtures();
  if (!index.products.some((p) => p.product_id === productId)) return null;
  const product = products.get(productId);
  return product ? structuredClone(product) : null;
}

export function showcaseFixtureOffers(normalizedKey: string): OfferSet | null {
  const set = showcaseFixtures().offersByKey.get(normalizedKey);
  return set ? structuredClone(set) : null;
}
