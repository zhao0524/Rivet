import { describe, expect, it } from "vitest";
import { offerFixture } from "../fixtures";
import {
  describeFactor,
  formatFreshness,
  formatPack,
  formatPrice,
  formatRating,
  NO_RATING,
  PRICE_NOT_STATED,
  reliabilityLevel,
  statusLabel,
} from "../format";
import type { Offer } from "../types";

const NOW = new Date("2026-10-24T14:00:00Z");
const offer = (id: string): Offer => {
  const found = offerFixture("synthetic-multivendor").offers.find((o) => o.offer_id === id);
  if (!found) throw new Error(`no fixture offer ${id}`);
  return found;
};

describe("formatPrice / formatPack / formatRating", () => {
  it("never renders a missing price as 0 or free", () => {
    expect(formatPrice(null, "USD")).toBe(PRICE_NOT_STATED);
    expect(formatPrice("4.50", "USD")).toBe("4.50 USD");
    expect(formatPrice("4.50", null)).toBe("4.50");
  });

  it("flags the pack basis and the derived per-unit price", () => {
    expect(formatPack(offer("dist-one:e4e5560d62dc624a"))).toBe("3-pack, price per pack (4.00 each)");
    expect(formatPack(offer("maker-shop:57674c0c691c7fa2"))).toBeNull();
    const perUnit = { ...offer("dist-one:e4e5560d62dc624a"), pack: { quantity: 3, unit_price_basis: "per_unit" as const } };
    expect(formatPack(perUnit)).toBe("3-pack, price per unit");
  });

  it("shows the vendor-page rating with its count, else says there is none", () => {
    expect(formatRating(offer("dist-one:e4c8a313d8534aef").rating)).toBe("4.6 (128)");
    expect(formatRating(offer("bargain-bay:877c148882e83900").rating)).toBe("5 (1)");
    expect(formatRating(null)).toBe(NO_RATING);
    expect(formatRating({ value: 8, count: 3, scale: 10, source: "vendor_api" })).toBe("8/10 (3)");
  });
});

describe("formatFreshness", () => {
  it("is relative to the injected clock", () => {
    expect(formatFreshness("2026-10-24T12:00:00Z", NOW)).toBe("checked 2 h ago");
    expect(formatFreshness("2026-08-20T12:00:00Z", NOW)).toBe("checked 65 days ago");
    expect(formatFreshness("2026-10-24T13:35:00Z", NOW)).toBe("checked 25 min ago");
    expect(formatFreshness("2026-10-24T13:59:40Z", NOW)).toBe("checked just now");
    expect(formatFreshness("2026-10-23T13:00:00Z", NOW)).toBe("checked 1 day ago");
    expect(formatFreshness("garbage", NOW)).toBe("check time unknown");
  });
});

describe("reliability", () => {
  it("maps the score to a level", () => {
    expect(reliabilityLevel(0.95)).toBe("high");
    expect(reliabilityLevel(0.85)).toBe("high");
    expect(reliabilityLevel(0.75)).toBe("medium");
    expect(reliabilityLevel(0.65)).toBe("medium");
    expect(reliabilityLevel(0.49)).toBe("low");
  });

  it("describes a factor with its note for the tooltip", () => {
    expect(describeFactor({ key: "rating", weight: 0.05, value: 0.2, note: "5.0 from a single review carries little weight" })).toBe(
      "Rating: 0.2 (weight 0.05). 5.0 from a single review carries little weight",
    );
    expect(describeFactor({ key: "vendor_tier", weight: 0.3, value: 1, note: "" })).toBe("Vendor tier: 1 (weight 0.3)");
  });
});

describe("statusLabel", () => {
  it("is null for ok offers", () => {
    expect(statusLabel(offer("maker-shop:57674c0c691c7fa2"), NOW)).toBeNull();
  });

  it("labels stale offers with the freshness reason", () => {
    expect(statusLabel(offer("dist-two:cfa9b01d78023178"), NOW)).toBe("Stale: checked 65 days ago");
  });

  it("labels demoted offers with the broken-link or outlier reason", () => {
    expect(statusLabel(offer("maker-shop:383b8a45b8f44efc"), NOW)).toBe("Demoted: link check returned 404 on 2026-10-24");
    expect(statusLabel(offer("bargain-bay:877c148882e83900"), NOW)).toBe("Demoted: 0.99 is 78% below the 4.50 median");
  });
});
