/**
 * Runtime validation for `OfferSet` (contracts/offer.schema.json), in the style of
 * `lib/rivet/validate.ts`: every issue is collected with a path and the parse fails
 * closed. The cross-field rules the schema states in `allOf` are enforced here too.
 */
import type { ValidationIssue } from "../rivet/errors";
import {
  arrayOf,
  bool,
  literal,
  nonEmptyStr,
  nullable,
  num,
  object,
  oneOf,
  parseOrThrow,
  positiveInt,
  safeParse,
  str,
  type Check,
  type ParseResult,
} from "../rivet/validate";
import {
  AVAILABILITIES,
  EVIDENCE_LEVELS,
  LEDGER_STATUSES,
  LINK_STATUSES,
  MATCH_KINDS,
  OFFER_OUTCOMES,
  OFFER_PROVIDER_MODES,
  OFFER_SCHEMA_VERSION,
  OFFER_STATUSES,
  RATING_SOURCES,
  RELIABILITY_FACTOR_KEYS,
  UNIT_PRICE_BASES,
  VENDOR_TIERS,
  type LedgerEntry,
  type Match,
  type Offer,
  type OfferQuery,
  type OfferSearchAccepted,
  type OfferSet,
  type Pack,
  type Rating,
  type Reliability,
  type ReliabilityFactor,
  type Shipping,
  type Vendor,
} from "./types";

const fail = (issues: ValidationIssue[], path: string, message: string) => {
  issues.push({ path, message });
};

const describe = (v: unknown): string =>
  v === null ? "null" : Array.isArray(v) ? "array" : typeof v === "string" ? `"${v.slice(0, 40)}"` : typeof v;

const matching =
  (re: RegExp, what: string, maxLength = Infinity): Check<string> =>
  (v, p, issues) => {
    if (typeof v !== "string" || !re.test(v) || v.length > maxLength) fail(issues, p, `expected ${what}, got ${describe(v)}`);
    return v as string;
  };

const bounded =
  (min: number, max: number): Check<string> =>
  (v, p, issues) => {
    if (typeof v !== "string" || v.length < min || v.length > max)
      fail(issues, p, `expected string of ${min}..${max} characters, got ${describe(v)}`);
    return v as string;
  };

const inRange =
  (min: number, max: number): Check<number> =>
  (v, p, issues) => {
    num(v, p, issues);
    if (typeof v === "number" && (v < min || v > max)) fail(issues, p, `expected ${min}..${max}, got ${v}`);
    return v as number;
  };

export const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
export const timestamp: Check<string> = (v, p, issues) => {
  if (typeof v !== "string" || !TIMESTAMP_RE.test(v) || Number.isNaN(Date.parse(v)))
    fail(issues, p, `expected UTC timestamp ending in Z, got ${describe(v)}`);
  return v as string;
};

/** Only `https://` with a host; `javascript:`, `http:` and relative URLs are rejected. */
export const HTTPS_URL_RE = /^https:\/\/[^\s/?#]+[^\s]*$/;
export const httpsUrl: Check<string> = (v, p, issues) => {
  if (typeof v !== "string" || v.length > 2048 || !HTTPS_URL_RE.test(v)) {
    fail(issues, p, `expected an https:// URL, got ${describe(v)}`);
    return v as string;
  }
  try {
    if (new URL(v).protocol !== "https:") fail(issues, p, `expected an https:// URL, got ${describe(v)}`);
  } catch {
    fail(issues, p, `expected a parseable https:// URL, got ${describe(v)}`);
  }
  return v as string;
};

/** Positive decimal string; "0", "0.00" and negatives are rejected so a missing price is never "free". */
export const MONEY_RE = /^([1-9][0-9]*(\.[0-9]{1,4})?|0\.[0-9]{0,3}[1-9][0-9]{0,3})$/;
export const money: Check<string> = (v, p, issues) => {
  if (typeof v !== "string" || v.length > 24 || !MONEY_RE.test(v))
    fail(issues, p, `expected a positive decimal string like "4.50", got ${describe(v)}`);
  return v as string;
};

const currency = matching(/^[A-Z]{3}$/, "ISO 4217 currency code");
const gtin = matching(/^[0-9]{8}$|^[0-9]{12,14}$/, "GTIN of 8, 12, 13 or 14 digits");
const identifier = bounded(1, 64);

export const offerQueryCheck: Check<OfferQuery> = object<OfferQuery>({
  sku: nullable(identifier),
  mpn: nullable(identifier),
  gtin: nullable(gtin),
  manufacturer: nullable(bounded(1, 120)),
  catalog_id: nullable(nonEmptyStr),
  normalized_key: matching(/^[^|]*\|[^|]*\|[^|]*\|[^|]*$/, "normalized key `sku|mpn|gtin|manufacturer`"),
});

export const vendorCheck: Check<Vendor> = object<Vendor>({
  id: matching(/^[a-z0-9][a-z0-9_.-]{0,62}$/, "vendor id"),
  name: bounded(1, 120),
  tier: oneOf(VENDOR_TIERS),
  domain: matching(/^[a-z0-9.-]+\.[a-z]{2,}$/, "vendor domain"),
});

const positiveNum: Check<number> = (v, p, issues) => {
  num(v, p, issues);
  if (typeof v === "number" && v <= 0) fail(issues, p, `expected number > 0, got ${v}`);
  return v as number;
};

/** A rating with count 0 is not a rating; the schema requires the whole object to be null instead. */
export const ratingCheck: Check<Rating | null> = nullable(
  object<Rating>({
    value: inRange(0, Infinity),
    count: positiveInt,
    scale: positiveNum,
    source: oneOf(RATING_SOURCES),
  }),
);

export const matchCheck: Check<Match> = (v, p, issues) => {
  const m = object<Match>({
    kind: oneOf(MATCH_KINDS),
    confidence: inRange(0, 1),
    evidence_quote: nullable(bounded(1, 400)),
  })(v, p, issues);
  if (m && typeof m === "object" && m.kind !== "fuzzy" && m.evidence_quote === null)
    fail(issues, `${p}.evidence_quote`, `a ${m.kind} match needs the quoted page text`);
  return m;
};

export const reliabilityFactorCheck: Check<ReliabilityFactor> = object<ReliabilityFactor>({
  key: oneOf(RELIABILITY_FACTOR_KEYS),
  weight: inRange(0, 1),
  value: inRange(0, 1),
  note: bounded(0, 200),
});

export const reliabilityCheck: Check<Reliability> = object<Reliability>({
  score: inRange(0, 1),
  factors: arrayOf(reliabilityFactorCheck),
});

export const shippingCheck: Check<Shipping | null> = nullable(
  object<Shipping>({ amount: nullable(money), currency, note: nullable(bounded(0, 200)) }),
);

export const packCheck: Check<Pack> = object<Pack>({ quantity: positiveInt, unit_price_basis: oneOf(UNIT_PRICE_BASES) });

export const offerCheck: Check<Offer> = (v, p, issues) => {
  const o = object<Offer>({
    offer_id: matching(/^[a-z0-9][a-z0-9_.-]{0,62}:[0-9a-f]{16}$/, "offer id `<vendor>:<16 hex>`"),
    sku: nullable(identifier),
    mpn: nullable(identifier),
    gtin: nullable(gtin),
    vendor: vendorCheck,
    url: httpsUrl,
    price_amount: nullable(money),
    currency: nullable(currency),
    availability: oneOf(AVAILABILITIES),
    min_order_qty: nullable(positiveInt),
    pack: packCheck,
    shipping: shippingCheck,
    rating: ratingCheck,
    match: matchCheck,
    fetched_at: timestamp,
    evidence_level: oneOf(EVIDENCE_LEVELS),
    link_status: oneOf(LINK_STATUSES),
    reliability: reliabilityCheck,
    status: oneOf(OFFER_STATUSES),
    source_sha256: matching(/^[0-9a-f]{64}$/, "sha-256 hex digest"),
  })(v, p, issues);
  if (o && typeof o === "object") {
    if (typeof o.price_amount === "string" && o.currency === null) fail(issues, `${p}.currency`, "a price needs a currency");
    if (o.evidence_level === "verified" && o.match && o.match.kind === "fuzzy")
      fail(issues, `${p}.match.kind`, "a verified offer is never a fuzzy match");
  }
  return o;
};

export const ledgerEntryCheck: Check<LedgerEntry> = object<LedgerEntry>({
  source: bounded(1, 64),
  url: nullable(httpsUrl),
  status: oneOf(LEDGER_STATUSES),
  reason: bounded(0, 300),
  checked_at: nullable(timestamp),
});

export const offerSetCheck: Check<OfferSet> = (v, p, issues) => {
  const set = object<OfferSet>({
    schema_version: literal(OFFER_SCHEMA_VERSION),
    query: offerQueryCheck,
    outcome: oneOf(OFFER_OUTCOMES),
    provider_mode: oneOf(OFFER_PROVIDER_MODES),
    synthetic: bool,
    generated_at: timestamp,
    offers: arrayOf(offerCheck),
    possible_matches: arrayOf(offerCheck),
    alternatives: arrayOf(offerCheck),
    ledger: arrayOf(ledgerEntryCheck),
    notices: arrayOf(bounded(1, 300)),
  })(v, p, issues);
  if (set && typeof set === "object" && Array.isArray(set.offers)) {
    set.offers.forEach((o, i) => {
      if (o && typeof o === "object" && o.match && o.match.kind === "fuzzy")
        fail(issues, `${p}.offers[${i}].match.kind`, "fuzzy matches belong in possible_matches, never in the ranked offers");
    });
  }
  return set;
};

export const offerSearchAcceptedCheck: Check<OfferSearchAccepted> = object<OfferSearchAccepted>({
  job_id: nonEmptyStr,
  status: oneOf(["queued", "running", "complete", "failed"] as const),
  offer_set_id: nullable(str),
});

/** `POST /api/offers/search` answers with an OfferSet (200) or an accepted job (202). */
export const offerSearchResponseCheck: Check<OfferSet | OfferSearchAccepted> = (v, p, issues) => {
  if (v && typeof v === "object" && "job_id" in (v as Record<string, unknown>)) return offerSearchAcceptedCheck(v, p, issues);
  return offerSetCheck(v, p, issues);
};

export const safeParseOfferSet = (v: unknown): ParseResult<OfferSet> => safeParse(offerSetCheck, v);
export const parseOfferSet = (v: unknown): OfferSet => parseOrThrow(offerSetCheck, v, "OfferSet");
export const parseOffer = (v: unknown): Offer => parseOrThrow(offerCheck, v, "Offer");
