/**
 * Byte-for-byte copies of `fixtures/offers/*.json` (drift-tested in
 * `__tests__/fixtures-drift.test.ts`). Served by `FixtureSource` and the
 * `/studio?offers=<name>` example dialog; never presented as a live lookup.
 */
import adafruit3801 from "./adafruit-3801.json";
import notFound9999999 from "./not-found-9999999.json";
import refusedSyntheticDemoPart from "./refused-synthetic-demo-part.json";
import sparkfunRob13301 from "./sparkfun-rob-13301.json";
import syntheticMultivendor from "./synthetic-multivendor.json";
import type { OfferSet } from "../types";
import { parseOfferSet } from "../validate";

export const OFFER_FIXTURE_NAMES = [
  "adafruit-3801",
  "sparkfun-rob-13301",
  "not-found-9999999",
  "synthetic-multivendor",
  "refused-synthetic-demo-part",
] as const;
export type OfferFixtureName = (typeof OFFER_FIXTURE_NAMES)[number];

export const RAW_OFFER_FIXTURES: Record<OfferFixtureName, unknown> = {
  "adafruit-3801": adafruit3801,
  "sparkfun-rob-13301": sparkfunRob13301,
  "not-found-9999999": notFound9999999,
  "synthetic-multivendor": syntheticMultivendor,
  "refused-synthetic-demo-part": refusedSyntheticDemoPart,
};

export const OFFER_FIXTURE_LABEL: Record<OfferFixtureName, string> = {
  "adafruit-3801": "Single vendor, recorded page (Adafruit 3801)",
  "sparkfun-rob-13301": "Price stated, stock not stated (SparkFun ROB-13301)",
  "not-found-9999999": "Not found anywhere",
  "synthetic-multivendor": "Several vendors, synthetic test-only",
  "refused-synthetic-demo-part": "Refused: synthetic demo part",
};

let parsed: Record<OfferFixtureName, OfferSet> | null = null;

/** Parses every fixture once; a fixture that violates the contract fails the whole index closed. */
export function offerFixtures(): Record<OfferFixtureName, OfferSet> {
  if (parsed) return parsed;
  const out = {} as Record<OfferFixtureName, OfferSet>;
  for (const name of OFFER_FIXTURE_NAMES) out[name] = parseOfferSet(RAW_OFFER_FIXTURES[name]);
  parsed = out;
  return out;
}

export function isOfferFixtureName(value: unknown): value is OfferFixtureName {
  return typeof value === "string" && (OFFER_FIXTURE_NAMES as readonly string[]).includes(value);
}

export function offerFixture(name: OfferFixtureName): OfferSet {
  return structuredClone(offerFixtures()[name]);
}

/** The fixture whose query names this catalog part, if any. */
export function offerFixtureForCatalogId(catalogId: string): OfferSet | null {
  const all = offerFixtures();
  for (const name of OFFER_FIXTURE_NAMES) {
    if (all[name].query.catalog_id === catalogId) return structuredClone(all[name]);
  }
  return null;
}

export function offerFixtureForNormalizedKey(key: string): OfferSet | null {
  const all = offerFixtures();
  for (const name of OFFER_FIXTURE_NAMES) {
    if (all[name].query.normalized_key === key) return structuredClone(all[name]);
  }
  return null;
}
