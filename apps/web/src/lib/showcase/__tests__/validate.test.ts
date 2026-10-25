import { describe, expect, it } from "vitest";
import { RivetContractError } from "../../rivet/errors";
import { RAW_SHOWCASE_PRODUCT_FILES, showcaseFixtures } from "../fixtures";
import {
  isShowcaseProductId,
  parseShowcaseIndex,
  parseShowcaseProduct,
  safeParseShowcaseIndex,
  safeParseShowcaseProduct,
} from "../validate";
import type { ShowcaseProduct } from "../types";

const sample = (): ShowcaseProduct => {
  const raw = RAW_SHOWCASE_PRODUCT_FILES["sample-simple-raspberry-pi-robot.json"];
  return structuredClone(parseShowcaseProduct(raw));
};

const issuesOf = (v: unknown) => {
  const r = safeParseShowcaseProduct(v);
  return r.ok ? [] : r.issues.map((i) => i.path);
};

describe("parseShowcaseProduct", () => {
  it("accepts the hand-made samples", () => {
    const p = sample();
    expect(p.product_id).toBe("sample-simple-raspberry-pi-robot");
    expect(p.parts).toHaveLength(8);
  });

  it("rejects a product that claims to be synthetic", () => {
    const p = sample() as unknown as { synthetic: boolean };
    p.synthetic = true;
    expect(issuesOf(p)).toEqual(["$.synthetic"]);
  });

  it("rejects non-https and javascript: URLs on the image, source and parts", () => {
    const p = sample();
    p.image.url = "http://cdn-learn.adafruit.com/x.jpg";
    p.source.url = "javascript:alert(1)";
    p.parts[0].url = "/product/2939";
    expect(issuesOf(p)).toEqual(["$.image.url", "$.source.url", "$.parts[0].url"]);
  });

  it("rejects parts_verified above parts_total", () => {
    const p = sample();
    p.totals.parts_verified = p.totals.parts_total + 1;
    expect(issuesOf(p)).toEqual(["$.totals.parts_verified"]);
  });

  it("rejects a price without a currency and a zero price", () => {
    const p = sample();
    p.parts[0].currency = null;
    p.parts[1].price_amount = "0";
    p.totals.currency = null;
    expect(issuesOf(p)).toEqual(["$.parts[0].currency", "$.parts[1].price_amount", "$.totals.currency"]);
  });

  it("accepts a null price with a null currency and a null price total", () => {
    const p = sample();
    p.parts[0].price_amount = null;
    p.parts[0].currency = null;
    p.totals.price_total_amount = null;
    p.totals.currency = null;
    expect(safeParseShowcaseProduct(p).ok).toBe(true);
  });

  it("rejects duplicate part ids, an empty evidence quote and an unknown category", () => {
    const p = sample();
    p.parts[1].part_id = p.parts[0].part_id;
    p.parts[2].evidence_quote = "";
    (p as unknown as { category: string }).category = "spaceship";
    expect(issuesOf(p)).toEqual(["$.category", "$.parts[2].evidence_quote", "$.parts[1].part_id"]);
  });

  it("throws a RivetContractError with paths when asked to parse strictly", () => {
    expect(() => parseShowcaseProduct({})).toThrow(RivetContractError);
  });
});

describe("parseShowcaseIndex", () => {
  it("accepts the bundled index and rejects a duplicate product id", () => {
    const index = structuredClone(showcaseFixtures().index);
    expect(parseShowcaseIndex(index).products.length).toBeGreaterThan(0);
    index.products.push({ ...index.products[0] });
    const r = safeParseShowcaseIndex(index);
    expect(r.ok ? [] : r.issues.map((i) => i.path)).toEqual([`$.products[${index.products.length - 1}].product_id`]);
  });

  it("rejects an entry whose sourced count exceeds its total", () => {
    const index = structuredClone(showcaseFixtures().index);
    index.products[0].parts_verified = index.products[0].parts_total + 1;
    const r = safeParseShowcaseIndex(index);
    expect(r.ok ? [] : r.issues.map((i) => i.path)).toEqual(["$.products[0].parts_verified"]);
  });
});

describe("isShowcaseProductId", () => {
  it("accepts slugs of 3..80 lowercase characters and nothing else", () => {
    expect(isShowcaseProductId("sample-simple-raspberry-pi-robot")).toBe(true);
    expect(isShowcaseProductId("ab")).toBe(false);
    expect(isShowcaseProductId("Has Caps")).toBe(false);
    expect(isShowcaseProductId("../etc")).toBe(false);
    expect(isShowcaseProductId(undefined)).toBe(false);
  });
});
