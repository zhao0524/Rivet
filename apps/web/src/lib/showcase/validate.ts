/**
 * Runtime validation for `ShowcaseProduct` and `ShowcaseIndex`
 * (contracts/showcase-product.schema.json), in the style of `lib/offers/validate.ts`:
 * every issue is collected with a path and the parse fails closed. Besides the schema
 * shapes it enforces the rules the schema only states in prose: https URLs only,
 * `synthetic` must be `false`, a price needs a currency, `parts_verified <= parts_total`
 * and unique part ids.
 */
import type { ValidationIssue } from "../rivet/errors";
import {
  arrayOf,
  int,
  literal,
  nullable,
  object,
  oneOf,
  parseOrThrow,
  positiveInt,
  safeParse,
  type Check,
  type ParseResult,
} from "../rivet/validate";
import { AVAILABILITIES } from "../offers/types";
import { httpsUrl, money, timestamp, vendorCheck } from "../offers/validate";
import {
  SHOWCASE_CATEGORIES,
  SHOWCASE_HOST_TIERS,
  SHOWCASE_PART_EVIDENCE_LEVELS,
  SHOWCASE_SCHEMA_VERSION,
  SHOWCASE_STATUSES,
  type ShowcaseImage,
  type ShowcaseIndex,
  type ShowcaseIndexEntry,
  type ShowcasePart,
  type ShowcaseProduct,
  type ShowcaseSource,
  type ShowcaseTotals,
  type ShowcaseUnsourcedPart,
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

const nonNegativeInt: Check<number> = (v, p, issues) => {
  int(v, p, issues);
  if (typeof v === "number" && v < 0) fail(issues, p, `expected integer >= 0, got ${v}`);
  return v as number;
};

/** The schema says `"const": false`; a showcase product that claims to be synthetic is rejected. */
const neverSynthetic: Check<false> = (v, p, issues) => {
  if (v !== false) fail(issues, p, `showcase products are never synthetic; expected false, got ${describe(v)}`);
  return false;
};

export const PRODUCT_ID_RE = /^[a-z0-9][a-z0-9-]{2,79}$/;
const productId = matching(PRODUCT_ID_RE, "product id (lowercase slug of 3..80 characters)");
const partId = matching(/^[a-z0-9][a-z0-9-]{0,79}$/, "part id (lowercase slug)");
const sha256 = matching(/^[0-9a-f]{64}$/, "sha-256 hex digest");
const currency = matching(/^[A-Z]{3}$/, "ISO 4217 currency code");

export const showcaseImageCheck: Check<ShowcaseImage> = object<ShowcaseImage>({
  url: httpsUrl,
  credit: bounded(1, 200),
  license: bounded(1, 80),
});

export const showcaseSourceCheck: Check<ShowcaseSource> = object<ShowcaseSource>({
  url: httpsUrl,
  host_tier: oneOf(SHOWCASE_HOST_TIERS),
  title: bounded(1, 200),
  fetched_at: timestamp,
  content_sha256: sha256,
});

export const showcasePartCheck: Check<ShowcasePart> = (v, p, issues) => {
  const part = object<ShowcasePart>({
    part_id: partId,
    name: bounded(1, 200),
    quantity: positiveInt,
    sku: bounded(1, 64),
    mpn: nullable(bounded(1, 64)),
    manufacturer: nullable(bounded(1, 120)),
    vendor: vendorCheck,
    url: httpsUrl,
    price_amount: nullable(money),
    currency: nullable(currency),
    availability: oneOf(AVAILABILITIES),
    fetched_at: timestamp,
    source_sha256: sha256,
    evidence_level: oneOf(SHOWCASE_PART_EVIDENCE_LEVELS),
    evidence_quote: bounded(1, 400),
    bom_quote: bounded(1, 400),
  })(v, p, issues);
  if (part && typeof part === "object" && typeof part.price_amount === "string" && part.currency === null)
    fail(issues, `${p}.currency`, "a price needs a currency");
  return part;
};

export const showcaseUnsourcedPartCheck: Check<ShowcaseUnsourcedPart> = object<ShowcaseUnsourcedPart>({
  name: bounded(1, 200),
  quantity: nullable(positiveInt),
  note: bounded(1, 300),
});

export const showcaseTotalsCheck: Check<ShowcaseTotals> = (v, p, issues) => {
  const totals = object<ShowcaseTotals>({
    parts_total: nonNegativeInt,
    parts_verified: nonNegativeInt,
    price_total_amount: nullable(money),
    currency: nullable(currency),
  })(v, p, issues);
  if (totals && typeof totals === "object") {
    if (typeof totals.parts_total === "number" && typeof totals.parts_verified === "number" && totals.parts_verified > totals.parts_total)
      fail(issues, `${p}.parts_verified`, `parts_verified (${totals.parts_verified}) exceeds parts_total (${totals.parts_total})`);
    if (typeof totals.price_total_amount === "string" && totals.currency === null)
      fail(issues, `${p}.currency`, "a price total needs a currency");
  }
  return totals;
};

export const showcaseProductCheck: Check<ShowcaseProduct> = (v, p, issues) => {
  const product = object<ShowcaseProduct>({
    schema_version: literal(SHOWCASE_SCHEMA_VERSION),
    product_id: productId,
    name: bounded(1, 160),
    category: oneOf(SHOWCASE_CATEGORIES),
    summary: bounded(0, 600),
    image: showcaseImageCheck,
    source: showcaseSourceCheck,
    parts: arrayOf(showcasePartCheck),
    unsourced_parts: arrayOf(showcaseUnsourcedPartCheck),
    totals: showcaseTotalsCheck,
    status: oneOf(SHOWCASE_STATUSES),
    generated_at: timestamp,
    synthetic: neverSynthetic,
  })(v, p, issues);
  if (product && typeof product === "object" && Array.isArray(product.parts)) {
    const seen = new Set<string>();
    product.parts.forEach((part, i) => {
      if (!part || typeof part !== "object" || typeof part.part_id !== "string") return;
      if (seen.has(part.part_id)) fail(issues, `${p}.parts[${i}].part_id`, `duplicate part id "${part.part_id}"`);
      seen.add(part.part_id);
    });
  }
  return product;
};

export const showcaseIndexEntryCheck: Check<ShowcaseIndexEntry> = (v, p, issues) => {
  const entry = object<ShowcaseIndexEntry>({
    product_id: productId,
    name: bounded(1, 160),
    category: oneOf(SHOWCASE_CATEGORIES),
    image: showcaseImageCheck,
    parts_total: nonNegativeInt,
    parts_verified: nonNegativeInt,
    status: oneOf(SHOWCASE_STATUSES),
  })(v, p, issues);
  if (entry && typeof entry === "object" && typeof entry.parts_total === "number" && typeof entry.parts_verified === "number" && entry.parts_verified > entry.parts_total)
    fail(issues, `${p}.parts_verified`, `parts_verified (${entry.parts_verified}) exceeds parts_total (${entry.parts_total})`);
  return entry;
};

export const showcaseIndexCheck: Check<ShowcaseIndex> = (v, p, issues) => {
  const index = object<ShowcaseIndex>({
    schema_version: literal(SHOWCASE_SCHEMA_VERSION),
    generated_at: timestamp,
    products: arrayOf(showcaseIndexEntryCheck),
  })(v, p, issues);
  if (index && typeof index === "object" && Array.isArray(index.products)) {
    const seen = new Set<string>();
    index.products.forEach((entry, i) => {
      if (!entry || typeof entry !== "object" || typeof entry.product_id !== "string") return;
      if (seen.has(entry.product_id)) fail(issues, `${p}.products[${i}].product_id`, `duplicate product id "${entry.product_id}"`);
      seen.add(entry.product_id);
    });
  }
  return index;
};

export const safeParseShowcaseProduct = (v: unknown): ParseResult<ShowcaseProduct> => safeParse(showcaseProductCheck, v);
export const parseShowcaseProduct = (v: unknown): ShowcaseProduct => parseOrThrow(showcaseProductCheck, v, "ShowcaseProduct");
export const safeParseShowcaseIndex = (v: unknown): ParseResult<ShowcaseIndex> => safeParse(showcaseIndexCheck, v);
export const parseShowcaseIndex = (v: unknown): ShowcaseIndex => parseOrThrow(showcaseIndexCheck, v, "ShowcaseIndex");

export function isShowcaseProductId(value: unknown): value is string {
  return typeof value === "string" && PRODUCT_ID_RE.test(value);
}
