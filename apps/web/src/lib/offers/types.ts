/**
 * Structural mirror of `contracts/offer.schema.json` (OfferSet / Offer) and the
 * sort/filter parameters documented in the "Offers" section of `contracts/api.md`.
 * snake_case matches the wire format; unknown values are `null`, never 0 or "".
 */

export const OFFER_SCHEMA_VERSION = "1.0" as const;

export const OFFER_OUTCOMES = ["found", "partial", "not_found", "refused"] as const;
export type OfferOutcome = (typeof OFFER_OUTCOMES)[number];

export const OFFER_PROVIDER_MODES = ["stub", "recorded", "live"] as const;
export type OfferProviderMode = (typeof OFFER_PROVIDER_MODES)[number];

export const VENDOR_TIERS = ["manufacturer", "authorized_distributor", "marketplace", "reseller", "unknown"] as const;
export type VendorTier = (typeof VENDOR_TIERS)[number];

export const AVAILABILITIES = ["in_stock", "out_of_stock", "backorder", "discontinued", "unknown"] as const;
export type Availability = (typeof AVAILABILITIES)[number];

export const MATCH_KINDS = ["exact_sku", "exact_mpn", "gtin", "fuzzy"] as const;
export type MatchKind = (typeof MATCH_KINDS)[number];

export const EVIDENCE_LEVELS = ["verified", "inferred", "stale", "conflict", "not_found"] as const;
export type EvidenceLevel = (typeof EVIDENCE_LEVELS)[number];

export const LINK_STATUSES = ["pass", "broken", "blocked", "error", "unchecked"] as const;
export type LinkStatus = (typeof LINK_STATUSES)[number];

export const OFFER_STATUSES = ["ok", "stale", "demoted"] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

export const RATING_SOURCES = ["jsonld_aggregate_rating", "vendor_api"] as const;
export type RatingSource = (typeof RATING_SOURCES)[number];

export const RELIABILITY_FACTOR_KEYS = [
  "vendor_tier",
  "match_exactness",
  "freshness",
  "link_status",
  "rating",
  "price_outlier",
] as const;
export type ReliabilityFactorKey = (typeof RELIABILITY_FACTOR_KEYS)[number];

export const UNIT_PRICE_BASES = ["per_pack", "per_unit"] as const;
export type UnitPriceBasis = (typeof UNIT_PRICE_BASES)[number];

export const LEDGER_STATUSES = [
  "offer",
  "possible_match",
  "dropped_no_identifier",
  "dropped_soft_404",
  "dropped_unavailable",
  "dropped_denylisted",
  "duplicate",
  "not_found",
  "blocked",
  "error",
  "needs_api_key",
  "skipped",
] as const;
export type LedgerStatus = (typeof LEDGER_STATUSES)[number];

/** Positive decimal string such as "4.50"; unknown is null. */
export type Money = string;

export interface OfferQuery {
  sku: string | null;
  mpn: string | null;
  gtin: string | null;
  manufacturer: string | null;
  catalog_id: string | null;
  /** Lowercase, whitespace-collapsed `sku|mpn|gtin|manufacturer`. */
  normalized_key: string;
}

export interface Vendor {
  id: string;
  name: string;
  tier: VendorTier;
  domain: string;
}

/** Only from the vendor page; absent or count 0 means the whole object is null. */
export interface Rating {
  value: number;
  count: number;
  scale: number;
  source: RatingSource;
}

export interface Match {
  kind: MatchKind;
  confidence: number;
  /** Required (non-null) for every non-fuzzy match. */
  evidence_quote: string | null;
}

export interface ReliabilityFactor {
  key: ReliabilityFactorKey;
  weight: number;
  value: number;
  note: string;
}

export interface Reliability {
  score: number;
  factors: ReliabilityFactor[];
}

export interface Shipping {
  amount: Money | null;
  currency: string;
  note: string | null;
}

export interface Pack {
  quantity: number;
  unit_price_basis: UnitPriceBasis;
}

export interface Offer {
  offer_id: string;
  sku: string | null;
  mpn: string | null;
  gtin: string | null;
  vendor: Vendor;
  url: string;
  price_amount: Money | null;
  currency: string | null;
  availability: Availability;
  min_order_qty: number | null;
  pack: Pack;
  shipping: Shipping | null;
  rating: Rating | null;
  match: Match;
  fetched_at: string;
  evidence_level: EvidenceLevel;
  link_status: LinkStatus;
  reliability: Reliability;
  status: OfferStatus;
  source_sha256: string;
}

export interface LedgerEntry {
  source: string;
  url: string | null;
  status: LedgerStatus;
  reason: string;
  checked_at: string | null;
}

export interface OfferSet {
  schema_version: typeof OFFER_SCHEMA_VERSION;
  query: OfferQuery;
  outcome: OfferOutcome;
  provider_mode: OfferProviderMode;
  synthetic: boolean;
  generated_at: string;
  /** Ranked; only exact_sku / exact_mpn / gtin matches. */
  offers: Offer[];
  /** Fuzzy matches; shown separately, never ranked with offers. */
  possible_matches: Offer[];
  /** Offers for a substitute part. */
  alternatives: Offer[];
  ledger: LedgerEntry[];
  notices: string[];
}

export const OFFER_SORTS = ["reliability", "price_asc", "price_desc", "rating", "availability", "newest"] as const;
export type OfferSort = (typeof OFFER_SORTS)[number];

/** Filters apply to `offers` only; `possible_matches` and `alternatives` stay unfiltered. */
export interface OfferFilters {
  vendor_tier?: VendorTier[];
  /** `true` keeps only `availability: in_stock`. */
  in_stock?: boolean;
  /** 0..5; offers with `rating: null` are excluded. */
  min_rating?: number;
  /** Decimal string, compared only within `currency`. */
  max_price?: Money;
  currency?: string;
}

export interface OfferListParams extends OfferFilters {
  sort?: OfferSort;
}

/** Body of `POST /api/offers/search`; at least one of sku / mpn / gtin. */
export interface OfferSearchRequest extends OfferListParams {
  sku?: string;
  mpn?: string;
  gtin?: string;
  manufacturer?: string;
}

/** `202` from `POST /api/offers/search` when live discovery is needed. */
export interface OfferSearchAccepted {
  job_id: string;
  status: "queued" | "running" | "complete" | "failed";
  offer_set_id: string | null;
}
