import { describe, expect, it } from "vitest";
import { offerFixture } from "../fixtures";
import { applyOfferParams, filterOffers, majorityCurrency, offerParamsToQuery, sortOffers, unitPriceString } from "../sort";
import type { Offer } from "../types";

const set = () => offerFixture("synthetic-multivendor");
const ids = (offers: readonly Offer[]) => offers.map((o) => o.offer_id);

const MAKER = "maker-shop:57674c0c691c7fa2"; // 4.50 USD, in stock, manufacturer, no rating
const DIST_ONE = "dist-one:e4c8a313d8534aef"; // 4.95 USD, rating 4.6 (128)
const DIST_TWO_NOPRICE = "dist-two:2f1bc3376bcf7531"; // price null, backorder
const THREE_PACK = "dist-one:e4e5560d62dc624a"; // 12.00 USD per 3-pack = 4.00 each
const EU = "eu-reseller:cc07f8ac78c8e216"; // 4.20 EUR
const BARGAIN = "bargain-bay:877c148882e83900"; // 0.99 USD, rating 5.0 (1), demoted outlier
const STALE = "dist-two:cfa9b01d78023178"; // 4.75 USD, stale
const BROKEN = "maker-shop:383b8a45b8f44efc"; // 4.50 USD, availability unknown, broken link, demoted

describe("sortOffers", () => {
  it("reliability desc with offer_id tie-break (default)", () => {
    const sorted = sortOffers(set().offers);
    expect(ids(sorted)).toEqual([DIST_ONE, MAKER, THREE_PACK, DIST_TWO_NOPRICE, STALE, BROKEN, EU, BARGAIN]);
  });

  it("price_asc: USD per-unit ascending, 3-pack compared per unit, EUR after, unpriced last", () => {
    const sorted = sortOffers(set().offers, "price_asc");
    expect(ids(sorted)).toEqual([BARGAIN, THREE_PACK, BROKEN, MAKER, STALE, DIST_ONE, EU, DIST_TWO_NOPRICE]);
  });

  it("price_desc keeps unknown price last in the other direction too", () => {
    const sorted = sortOffers(set().offers, "price_desc");
    expect(ids(sorted)).toEqual([DIST_ONE, STALE, BROKEN, MAKER, THREE_PACK, BARGAIN, EU, DIST_TWO_NOPRICE]);
  });

  it("price sorting in a requested currency puts that currency first and converts nothing", () => {
    const sorted = sortOffers(set().offers, "price_asc", "EUR");
    expect(sorted[0].offer_id).toBe(EU);
    expect(sorted[sorted.length - 1].offer_id).toBe(DIST_TWO_NOPRICE);
    expect(ids(sorted.slice(1, -1))).toEqual([BARGAIN, DIST_ONE, THREE_PACK, BROKEN, MAKER, STALE].sort());
  });

  it("does not compare a per-pack price naively against single units", () => {
    expect(unitPriceString(set().offers.find((o) => o.offer_id === THREE_PACK) as Offer)).toBe("4.00");
    const perUnitPack = set().offers.map((o) =>
      o.offer_id === THREE_PACK ? { ...o, pack: { ...o.pack, unit_price_basis: "per_unit" as const } } : o,
    );
    expect(ids(sortOffers(perUnitPack, "price_asc")).at(-2)).toBe(EU);
    expect(ids(sortOffers(perUnitPack, "price_asc")).at(-3)).toBe(THREE_PACK);
  });

  it("rating: rated offers first by value then count, unrated last in offer_id order", () => {
    const sorted = sortOffers(set().offers, "rating");
    expect(ids(sorted).slice(0, 2)).toEqual([BARGAIN, DIST_ONE]);
    expect(ids(sorted).slice(2)).toEqual([THREE_PACK, DIST_TWO_NOPRICE, STALE, EU, BROKEN, MAKER]);
  });

  it("availability: in stock first, unknown last", () => {
    const sorted = sortOffers(set().offers, "availability");
    expect(sorted[0].availability).toBe("in_stock");
    expect(sorted[sorted.length - 2].offer_id).toBe(DIST_TWO_NOPRICE);
    expect(sorted[sorted.length - 1].offer_id).toBe(BROKEN);
  });

  it("newest: stale offer last", () => {
    expect(ids(sortOffers(set().offers, "newest")).at(-1)).toBe(STALE);
  });

  it("is deterministic across repeated calls and input order", () => {
    const a = sortOffers(set().offers, "price_asc");
    const b = sortOffers([...set().offers].reverse(), "price_asc");
    expect(ids(a)).toEqual(ids(b));
  });

  it("majority currency picks the most common priced currency", () => {
    expect(majorityCurrency(set().offers)).toBe("USD");
    expect(majorityCurrency(set().offers.map((o) => ({ ...o, price_amount: null })))).toBeNull();
  });
});

describe("filterOffers", () => {
  it("vendor_tier keeps only the listed tiers", () => {
    const out = filterOffers(set().offers, { vendor_tier: ["manufacturer"] });
    expect(ids(out)).toEqual([MAKER, BROKEN]);
  });

  it("in_stock excludes backorder and unknown availability", () => {
    const out = filterOffers(set().offers, { in_stock: true });
    expect(ids(out)).not.toContain(DIST_TWO_NOPRICE);
    expect(ids(out)).not.toContain(BROKEN);
    expect(out).toHaveLength(6);
  });

  it("min_rating excludes offers with no rating", () => {
    expect(ids(filterOffers(set().offers, { min_rating: 4 }))).toEqual([DIST_ONE, BARGAIN]);
    expect(ids(filterOffers(set().offers, { min_rating: 4.7 }))).toEqual([BARGAIN]);
  });

  it("max_price compares per unit within one currency and excludes unknown prices", () => {
    const out = filterOffers(set().offers, { max_price: "4.50", currency: "USD" });
    expect(ids(out).sort()).toEqual([BARGAIN, THREE_PACK, MAKER, BROKEN].sort());
    expect(ids(filterOffers(set().offers, { max_price: "4.50" }))).not.toContain(EU);
  });

  it("currency filter separates EUR from USD without converting", () => {
    expect(ids(filterOffers(set().offers, { currency: "EUR" }))).toEqual([EU]);
  });

  it("a combination can leave nothing, which is an empty list rather than not_found", () => {
    const result = applyOfferParams(set(), { in_stock: true, min_rating: 4, vendor_tier: ["manufacturer"] });
    expect(result.offers).toEqual([]);
    expect(result.outcome).toBe("partial");
    expect(result.possible_matches).toHaveLength(1);
    expect(result.alternatives).toHaveLength(1);
  });
});

describe("offerParamsToQuery", () => {
  it("repeats vendor_tier and omits unset filters", () => {
    const q = offerParamsToQuery({ sort: "price_asc", vendor_tier: ["manufacturer", "reseller"], in_stock: true, max_price: "5.00", currency: "USD" });
    expect(q.getAll("vendor_tier")).toEqual(["manufacturer", "reseller"]);
    expect(q.get("sort")).toBe("price_asc");
    expect(q.get("in_stock")).toBe("true");
    expect(q.get("min_rating")).toBeNull();
    expect(q.toString()).toBe("sort=price_asc&vendor_tier=manufacturer&vendor_tier=reseller&in_stock=true&max_price=5.00&currency=USD");
    expect(offerParamsToQuery().toString()).toBe("");
  });
});
