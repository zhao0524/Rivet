import { describe, expect, it } from "vitest";
import { RivetContractError } from "../../rivet/errors";
import { RAW_OFFER_FIXTURES, offerFixture } from "../fixtures";
import { parseOfferSet, safeParseOfferSet } from "../validate";
import type { OfferSet } from "../types";

const multivendor = () => structuredClone(RAW_OFFER_FIXTURES["synthetic-multivendor"]) as OfferSet;

const issuesOf = (value: unknown) => {
  const r = safeParseOfferSet(value);
  if (r.ok) throw new Error("expected the OfferSet to be rejected");
  return r.issues;
};

describe("parseOfferSet", () => {
  it("accepts every checked-in fixture", () => {
    for (const raw of Object.values(RAW_OFFER_FIXTURES)) expect(() => parseOfferSet(raw)).not.toThrow();
  });

  it("throws a RivetContractError listing the path for a broken set", () => {
    const set = multivendor();
    set.offers[0].vendor.tier = "premium" as never;
    try {
      parseOfferSet(set);
      throw new Error("expected rejection");
    } catch (err) {
      expect(err).toBeInstanceOf(RivetContractError);
      expect((err as RivetContractError).issues[0].path).toBe("$.offers[0].vendor.tier");
    }
  });

  it.each(["http://maker-shop.example/p/1", "javascript:alert(1)", "//maker-shop.example/p/1", "ftp://x.example/a", "mailto:a@b.example"])(
    "rejects a non-https offer URL (%s)",
    (url) => {
      const set = multivendor();
      set.offers[0].url = url;
      expect(issuesOf(set).map((i) => i.path)).toContain("$.offers[0].url");
    },
  );

  it("rejects a ledger URL that is not https", () => {
    const set = multivendor();
    set.ledger[0].url = "javascript:void(0)";
    expect(issuesOf(set).map((i) => i.path)).toContain("$.ledger[0].url");
  });

  it.each(["0", "0.00", "0.0000", "-4.50", "4.", "free", "4.12345", ""])("rejects price %j so a missing price is never shown as free", (price) => {
    const set = multivendor();
    set.offers[0].price_amount = price;
    expect(issuesOf(set).map((i) => i.path)).toContain("$.offers[0].price_amount");
  });

  it("accepts null price and positive decimals", () => {
    const set = multivendor();
    set.offers[0].price_amount = null;
    set.offers[1].price_amount = "0.0001";
    set.offers[2].price_amount = "1234.5";
    expect(safeParseOfferSet(set).ok).toBe(true);
  });

  it("rejects a price without a currency", () => {
    const set = multivendor();
    set.offers[0].currency = null;
    expect(issuesOf(set).map((i) => i.path)).toContain("$.offers[0].currency");
  });

  it("rejects a rating with count 0 (the whole rating must be null instead)", () => {
    const set = multivendor();
    set.offers[1].rating = { value: 4.6, count: 0, scale: 5, source: "jsonld_aggregate_rating" };
    expect(issuesOf(set).map((i) => i.path)).toContain("$.offers[1].rating.count");
  });

  it("rejects a fuzzy match inside the ranked offers", () => {
    const set = multivendor();
    set.offers.push(structuredClone(set.possible_matches[0]));
    const paths = issuesOf(set).map((i) => i.path);
    expect(paths).toContain(`$.offers[${set.offers.length - 1}].match.kind`);
  });

  it("rejects a non-fuzzy match without an evidence quote", () => {
    const set = multivendor();
    set.offers[0].match.evidence_quote = null;
    expect(issuesOf(set).map((i) => i.path)).toContain("$.offers[0].match.evidence_quote");
  });

  it("rejects a verified offer whose match is fuzzy", () => {
    const set = multivendor();
    const fuzzy = structuredClone(set.possible_matches[0]);
    fuzzy.evidence_level = "verified";
    set.possible_matches[0] = fuzzy;
    expect(issuesOf(set).map((i) => i.path)).toContain("$.possible_matches[0].match.kind");
  });

  it("rejects timestamps without a trailing Z and unknown schema versions", () => {
    const set = multivendor();
    set.generated_at = "2026-10-24T12:00:00+00:00";
    (set as { schema_version: string }).schema_version = "2.0";
    const paths = issuesOf(set).map((i) => i.path);
    expect(paths).toContain("$.generated_at");
    expect(paths).toContain("$.schema_version");
  });

  it("returns copies from the fixture index", () => {
    const a = offerFixture("adafruit-3801");
    a.offers[0].price_amount = "99.00";
    expect(offerFixture("adafruit-3801").offers[0].price_amount).toBe("4.50");
  });
});
