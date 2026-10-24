/**
 * Local re-sort and filter over a returned `OfferSet`, with the semantics of
 * contracts/api.md "Offers": unknown price / rating sort last in every direction, ties
 * break on `offer_id`, pack-size variants compare per unit only when
 * `unit_price_basis` is `per_pack`, no currency conversion and `max_price` applies only
 * within one currency.
 */
import type { Availability, Offer, OfferFilters, OfferListParams, OfferSet, OfferSort } from "./types";

const MONEY_SCALE = 4;
const MONEY_FACTOR = 10n ** BigInt(MONEY_SCALE);

/** "4.50" -> 45000n (four fixed fractional digits) so prices compare exactly. */
export function moneyToScaled(amount: string): bigint | null {
  const m = /^(\d+)(?:\.(\d{1,4}))?$/.exec(amount.trim());
  if (!m) return null;
  const fraction = (m[2] ?? "").padEnd(MONEY_SCALE, "0");
  return BigInt(m[1]) * MONEY_FACTOR + BigInt(fraction);
}

/** Scaled price of one unit times `denominator` so two offers can be compared without division. */
interface UnitPrice {
  numerator: bigint;
  denominator: bigint;
}

export function unitPriceOf(offer: Offer): UnitPrice | null {
  if (offer.price_amount === null) return null;
  const scaled = moneyToScaled(offer.price_amount);
  if (scaled === null) return null;
  const perPack = offer.pack.unit_price_basis === "per_pack" && offer.pack.quantity > 1;
  return { numerator: scaled, denominator: perPack ? BigInt(offer.pack.quantity) : 1n };
}

/** Per-unit price as a decimal string with up to 4 fractional digits (no rounding past that), for display only. */
export function unitPriceString(offer: Offer): string | null {
  const u = unitPriceOf(offer);
  if (!u) return null;
  const whole = u.numerator / u.denominator;
  const text = whole.toString().padStart(MONEY_SCALE + 1, "0");
  const intPart = text.slice(0, -MONEY_SCALE);
  const frac = text.slice(-MONEY_SCALE).replace(/0+$/, "");
  return frac.length <= 2 ? `${intPart}.${frac.padEnd(2, "0")}` : `${intPart}.${frac}`;
}

function compareUnitPrice(a: UnitPrice, b: UnitPrice): number {
  const left = a.numerator * b.denominator;
  const right = b.numerator * a.denominator;
  return left < right ? -1 : left > right ? 1 : 0;
}

const byOfferId = (a: Offer, b: Offer) => (a.offer_id < b.offer_id ? -1 : a.offer_id > b.offer_id ? 1 : 0);

/** The currency most offers with a price are quoted in; ties resolve alphabetically. Null when nothing is priced. */
export function majorityCurrency(offers: readonly Offer[]): string | null {
  const counts = new Map<string, number>();
  for (const o of offers) {
    if (o.price_amount !== null && o.currency) counts.set(o.currency, (counts.get(o.currency) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [cur, n] of [...counts.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (n > bestCount) {
      best = cur;
      bestCount = n;
    }
  }
  return best;
}

const AVAILABILITY_RANK: Record<Availability, number> = {
  in_stock: 0,
  backorder: 1,
  out_of_stock: 2,
  discontinued: 3,
  unknown: 4,
};

function ratingFraction(offer: Offer): number | null {
  if (!offer.rating) return null;
  return offer.rating.value / offer.rating.scale;
}

/**
 * Price sorts: offers priced in `currency` first (ascending or descending per unit),
 * then priced offers in other currencies in `offer_id` order, then unpriced offers in
 * `offer_id` order. Nothing is converted.
 */
function sortByPrice(offers: readonly Offer[], direction: 1 | -1, currency: string | null): Offer[] {
  const comparable: Offer[] = [];
  const otherCurrency: Offer[] = [];
  const unpriced: Offer[] = [];
  for (const o of offers) {
    const unit = unitPriceOf(o);
    if (!unit) unpriced.push(o);
    else if (currency !== null && o.currency === currency) comparable.push(o);
    else otherCurrency.push(o);
  }
  comparable.sort((a, b) => {
    const ua = unitPriceOf(a) as UnitPrice;
    const ub = unitPriceOf(b) as UnitPrice;
    return direction * compareUnitPrice(ua, ub) || byOfferId(a, b);
  });
  otherCurrency.sort(byOfferId);
  unpriced.sort(byOfferId);
  return [...comparable, ...otherCurrency, ...unpriced];
}

export function sortOffers(offers: readonly Offer[], sort: OfferSort = "reliability", currency?: string): Offer[] {
  switch (sort) {
    case "reliability":
      return [...offers].sort((a, b) => b.reliability.score - a.reliability.score || byOfferId(a, b));
    case "price_asc":
      return sortByPrice(offers, 1, currency ?? majorityCurrency(offers));
    case "price_desc":
      return sortByPrice(offers, -1, currency ?? majorityCurrency(offers));
    case "rating":
      return [...offers].sort((a, b) => {
        const ra = ratingFraction(a);
        const rb = ratingFraction(b);
        if (ra === null && rb === null) return byOfferId(a, b);
        if (ra === null) return 1;
        if (rb === null) return -1;
        return rb - ra || (b.rating as NonNullable<Offer["rating"]>).count - (a.rating as NonNullable<Offer["rating"]>).count || byOfferId(a, b);
      });
    case "availability":
      return [...offers].sort(
        (a, b) => AVAILABILITY_RANK[a.availability] - AVAILABILITY_RANK[b.availability] || byOfferId(a, b),
      );
    case "newest":
      return [...offers].sort((a, b) => Date.parse(b.fetched_at) - Date.parse(a.fetched_at) || byOfferId(a, b));
  }
}

/** `min_rating` is on a 0..5 scale regardless of the vendor's own scale. */
const RATING_FILTER_SCALE = 5;

export function filterOffers(offers: readonly Offer[], filters: OfferFilters = {}): Offer[] {
  const tiers = filters.vendor_tier && filters.vendor_tier.length > 0 ? new Set(filters.vendor_tier) : null;
  const maxPrice = filters.max_price !== undefined ? moneyToScaled(filters.max_price) : null;
  const priceCurrency = filters.currency ?? (maxPrice !== null ? majorityCurrency(offers) : undefined);
  return offers.filter((o) => {
    if (tiers && !tiers.has(o.vendor.tier)) return false;
    if (filters.in_stock === true && o.availability !== "in_stock") return false;
    if (filters.min_rating !== undefined) {
      const r = ratingFraction(o);
      if (r === null || r * RATING_FILTER_SCALE < filters.min_rating) return false;
    }
    if (filters.currency !== undefined && o.currency !== filters.currency) return false;
    if (maxPrice !== null) {
      const unit = unitPriceOf(o);
      if (!unit || !priceCurrency || o.currency !== priceCurrency) return false;
      if (compareUnitPrice(unit, { numerator: maxPrice, denominator: 1n }) > 0) return false;
    }
    return true;
  });
}

/** Filters then sorts `offers` only; `possible_matches` and `alternatives` are returned untouched. */
export function applyOfferParams(set: OfferSet, params: OfferListParams = {}): OfferSet {
  const { sort, ...filters } = params;
  const filtered = filterOffers(set.offers, filters);
  return { ...set, offers: sortOffers(filtered, sort ?? "reliability", filters.currency) };
}

/** Builds the `?sort=&vendor_tier=&...` query for the offers endpoints; `vendor_tier` repeats. */
export function offerParamsToQuery(params: OfferListParams = {}): URLSearchParams {
  const q = new URLSearchParams();
  if (params.sort) q.set("sort", params.sort);
  for (const tier of params.vendor_tier ?? []) q.append("vendor_tier", tier);
  if (params.in_stock === true) q.set("in_stock", "true");
  if (params.min_rating !== undefined) q.set("min_rating", String(params.min_rating));
  if (params.max_price !== undefined) q.set("max_price", params.max_price);
  if (params.currency) q.set("currency", params.currency);
  return q;
}
