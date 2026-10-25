/** Display strings for offers. Nothing here invents a value: unknown stays "not stated". */
import { unitPriceString } from "./sort";
import type { Availability, MatchKind, Offer, ReliabilityFactor, VendorTier } from "./types";

export const PRICE_NOT_STATED = "Price not stated";
export const NO_RATING = "No rating on vendor page";
export const HONESTY_FOOTER = "Prices and stock are as of the check time and may have changed. Rivet does not sell parts.";
export const NOT_LIVE_LABEL = "Not a live lookup";
export const SYNTHETIC_LABEL = "SYNTHETIC TEST-ONLY offers";
export const NOT_FOUND_MESSAGE = "No verified offer was found; no link is shown because none was verified.";
export const REFUSED_MESSAGE = "This part is a synthetic placeholder. There is nothing to buy, so no vendor search ran.";
export const EMPTY_AFTER_FILTER_MESSAGE = "No offer matches the current filters. Clear a filter to see the returned offers.";

/** "4.50 USD"; `PRICE_NOT_STATED` when the page did not state a price. */
export function formatPrice(amount: string | null, currency: string | null): string {
  if (amount === null) return PRICE_NOT_STATED;
  return currency ? `${amount} ${currency}` : amount;
}

/** "3-pack, price per pack (4.00 each)" or "3-pack, price per unit"; null for a single unit. */
export function formatPack(offer: Offer): string | null {
  if (offer.pack.quantity <= 1) return null;
  const head = `${offer.pack.quantity}-pack`;
  if (offer.pack.unit_price_basis === "per_unit") return `${head}, price per unit`;
  const each = unitPriceString(offer);
  return each ? `${head}, price per pack (${each} each)` : `${head}, price per pack`;
}

/** "4.6 (128)" or `NO_RATING`; the scale is shown only when it is not out of 5. */
export function formatRating(rating: Offer["rating"]): string {
  if (!rating) return NO_RATING;
  const scale = rating.scale === 5 ? "" : `/${rating.scale}`;
  return `${rating.value}${scale} (${rating.count})`;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** "checked 2 h ago", "checked 65 days ago"; relative to `now` so tests are deterministic. */
export function formatFreshness(fetchedAt: string, now: Date = new Date()): string {
  const t = Date.parse(fetchedAt);
  if (Number.isNaN(t)) return "check time unknown";
  const diff = now.getTime() - t;
  if (diff < MINUTE_MS) return "checked just now";
  if (diff < HOUR_MS) return `checked ${Math.floor(diff / MINUTE_MS)} min ago`;
  if (diff < DAY_MS) return `checked ${Math.floor(diff / HOUR_MS)} h ago`;
  const days = Math.floor(diff / DAY_MS);
  return `checked ${days} day${days === 1 ? "" : "s"} ago`;
}

export const STALE_AFTER_DAYS = 30;

export function daysSince(fetchedAt: string, now: Date = new Date()): number | null {
  const t = Date.parse(fetchedAt);
  return Number.isNaN(t) ? null : Math.floor((now.getTime() - t) / DAY_MS);
}

export type ReliabilityLevel = "high" | "medium" | "low";

export const RELIABILITY_THRESHOLDS = { high: 0.85, medium: 0.65 } as const;

export function reliabilityLevel(score: number): ReliabilityLevel {
  if (score >= RELIABILITY_THRESHOLDS.high) return "high";
  if (score >= RELIABILITY_THRESHOLDS.medium) return "medium";
  return "low";
}

export const RELIABILITY_LEVEL_LABEL: Record<ReliabilityLevel, string> = {
  high: "High reliability",
  medium: "Medium reliability",
  low: "Low reliability",
};

export const FACTOR_LABEL: Record<ReliabilityFactor["key"], string> = {
  vendor_tier: "Vendor tier",
  match_exactness: "Match exactness",
  freshness: "Freshness",
  link_status: "Link check",
  rating: "Rating",
  price_outlier: "Price vs median",
};

/** "Vendor tier: 0.9 (weight 0.3)" plus the note when the engine gave one. */
export function describeFactor(f: ReliabilityFactor): string {
  const base = `${FACTOR_LABEL[f.key]}: ${f.value} (weight ${f.weight})`;
  return f.note ? `${base}. ${f.note}` : base;
}

export const TIER_LABEL: Record<VendorTier, string> = {
  manufacturer: "Manufacturer",
  authorized_distributor: "Authorized distributor",
  marketplace: "Marketplace",
  reseller: "Reseller",
  unknown: "Tier unknown",
};

export const AVAILABILITY_LABEL: Record<Availability, string> = {
  in_stock: "In stock",
  out_of_stock: "Out of stock",
  backorder: "Backorder",
  discontinued: "Discontinued",
  unknown: "Stock not stated",
};

export const MATCH_KIND_LABEL: Record<MatchKind, string> = {
  exact_sku: "Exact SKU match",
  exact_mpn: "Exact MPN match",
  gtin: "GTIN match",
  fuzzy: "Fuzzy match (not verified)",
};

/**
 * Label for a `stale` or `demoted` offer with the reason taken from the reliability
 * factors; null for `ok`. Demotion reasons: failed link check or price outlier.
 */
export function statusLabel(offer: Offer, now: Date = new Date()): string | null {
  if (offer.status === "ok") return null;
  if (offer.status === "stale") {
    const days = daysSince(offer.fetched_at, now);
    const freshness = offer.reliability.factors.find((f) => f.key === "freshness")?.note;
    return `Stale: ${freshness || (days !== null ? `checked ${days} days ago` : "check time unknown")}`;
  }
  const reasons: string[] = [];
  if (offer.link_status !== "pass") {
    const note = offer.reliability.factors.find((f) => f.key === "link_status")?.note;
    reasons.push(note || `link check ${offer.link_status}`);
  }
  const outlier = offer.reliability.factors.find((f) => f.key === "price_outlier");
  if (outlier && outlier.value < 0.5) reasons.push(outlier.note || "price far from the median");
  return `Demoted: ${reasons.length > 0 ? reasons.join("; ") : "see reliability factors"}`;
}
