import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import schema from "../../../../../../contracts/showcase-product.schema.json";
import {
  RAW_SHOWCASE_INDEX,
  RAW_SHOWCASE_OFFER_FILES,
  RAW_SHOWCASE_PRODUCT_FILES,
  showcaseFixtureIndex,
  showcaseFixtureOffers,
  showcaseFixtureProduct,
  showcaseFixtures,
} from "../fixtures";

const WEB_DIR = path.resolve(__dirname, "../fixtures");
const SHARED_DIR = path.resolve(__dirname, "../../../../../../fixtures/showcase");

const readJson = (file: string): unknown => JSON.parse(fs.readFileSync(file, "utf8"));
const listJson = (dir: string): string[] =>
  fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort() : [];

describe("bundled showcase fixtures", () => {
  it("parse, and every product file is listed in the index and vice versa", () => {
    const { index, products } = showcaseFixtures();
    expect([...products.keys()].sort()).toEqual(index.products.map((p) => p.product_id).sort());
    for (const entry of index.products) {
      const product = products.get(entry.product_id)!;
      expect(entry.parts_total).toBe(product.totals.parts_total);
      expect(entry.parts_verified).toBe(product.totals.parts_verified);
      expect(entry.status).toBe(product.status);
      expect(product.parts.length).toBe(product.totals.parts_verified);
      expect(product.parts.length + product.unsourced_parts.length).toBe(product.totals.parts_total);
    }
  });

  it("product files are named <product_id>.json", () => {
    for (const [file, raw] of Object.entries(RAW_SHOWCASE_PRODUCT_FILES)) {
      expect(file).toBe(`${(raw as { product_id: string }).product_id}.json`);
    }
  });

  it("uses exactly the keys the closed schema allows (additionalProperties: false)", () => {
    const defs = schema.$defs;
    for (const raw of Object.values(RAW_SHOWCASE_PRODUCT_FILES) as Record<string, unknown>[]) {
      expect(Object.keys(raw).sort()).toEqual([...schema.required].sort());
      for (const part of raw.parts as Record<string, unknown>[]) expect(Object.keys(part).sort()).toEqual([...defs.Part.required].sort());
      for (const u of raw.unsourced_parts as Record<string, unknown>[])
        expect(Object.keys(u).sort()).toEqual([...defs.UnsourcedPart.required].sort());
      expect(Object.keys(raw.totals as object).sort()).toEqual([...defs.Totals.required].sort());
      expect(Object.keys(raw.image as object).sort()).toEqual([...defs.Image.required].sort());
      expect(Object.keys(raw.source as object).sort()).toEqual([...defs.Source.required].sort());
    }
    const index = RAW_SHOWCASE_INDEX as Record<string, unknown>;
    expect(Object.keys(index).sort()).toEqual([...defs.ShowcaseIndex.required].sort());
    for (const entry of index.products as Record<string, unknown>[])
      expect(Object.keys(entry).sort()).toEqual([...defs.IndexEntry.required].sort());
  });

  it("nothing is synthetic and every part has an https vendor URL, a quote and a check time", () => {
    for (const product of showcaseFixtures().products.values()) {
      expect(product.synthetic).toBe(false);
      for (const part of product.parts) {
        expect(part.url.startsWith("https://")).toBe(true);
        expect(part.evidence_quote).toContain(part.sku);
        expect(Number.isNaN(Date.parse(part.fetched_at))).toBe(false);
      }
    }
  });

  it("serves copies, filters by category and ignores unknown ids", () => {
    const all = showcaseFixtureIndex();
    const rovers = showcaseFixtureIndex("rover");
    expect(rovers.products.every((p) => p.category === "rover")).toBe(true);
    expect(rovers.products.length).toBeLessThan(all.products.length);
    const product = showcaseFixtureProduct("sample-simple-raspberry-pi-robot")!;
    product.parts[0].price_amount = "1.00";
    expect(showcaseFixtureProduct("sample-simple-raspberry-pi-robot")!.parts[0].price_amount).toBe("24.95");
    expect(showcaseFixtureProduct("no-such-product")).toBeNull();
  });

  it("offer sets are keyed by normalized_key and are never synthetic", () => {
    expect(Object.keys(RAW_SHOWCASE_OFFER_FILES).length).toBeGreaterThan(0);
    const set = showcaseFixtureOffers("2939|||adafruit")!;
    expect(set.offers[0].price_amount).toBe("24.95");
    expect(set.offers[0].availability).toBe("out_of_stock");
    expect(set.synthetic).toBe(false);
    expect(showcaseFixtureOffers("nope|||")).toBeNull();
  });
});

describe("drift against the shared fixtures/showcase folder", () => {
  const sharedIndex = path.join(SHARED_DIR, "index.json");
  const sharedProducts = listJson(path.join(SHARED_DIR, "products"));
  const sharedOffers = listJson(path.join(SHARED_DIR, "offers"));
  const nothingShared = !fs.existsSync(sharedIndex) && sharedProducts.length === 0 && sharedOffers.length === 0;

  it.skipIf(nothingShared)("index.json matches byte for byte once the engine has produced it", () => {
    if (!fs.existsSync(sharedIndex)) return;
    expect(readJson(path.join(WEB_DIR, "index.json"))).toEqual(readJson(sharedIndex));
  });

  it.skipIf(sharedProducts.length === 0)("every shared product file has an identical bundled copy", () => {
    for (const file of sharedProducts) {
      expect(RAW_SHOWCASE_PRODUCT_FILES[file], `missing bundled copy of products/${file}`).toBeDefined();
      expect(RAW_SHOWCASE_PRODUCT_FILES[file]).toEqual(readJson(path.join(SHARED_DIR, "products", file)));
    }
  });

  it.skipIf(sharedOffers.length === 0)("every shared offers file has an identical bundled copy", () => {
    for (const file of sharedOffers) {
      expect(RAW_SHOWCASE_OFFER_FILES[file], `missing bundled copy of offers/${file}`).toBeDefined();
      expect(RAW_SHOWCASE_OFFER_FILES[file]).toEqual(readJson(path.join(SHARED_DIR, "offers", file)));
    }
  });
});
