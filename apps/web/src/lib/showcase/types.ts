/**
 * Structural mirror of `contracts/showcase-product.schema.json` (`ShowcaseProduct` and
 * `$defs.ShowcaseIndex`). snake_case matches the wire format; unknown values are `null`,
 * never 0 or "". A showcase product is never synthetic.
 */
import type { Availability, Money, Vendor } from "../offers/types";

export const SHOWCASE_SCHEMA_VERSION = "1.0" as const;

export const SHOWCASE_CATEGORIES = ["rover", "robot", "drone", "wearable", "iot", "audio", "display", "tool", "other"] as const;
export type ShowcaseCategory = (typeof SHOWCASE_CATEGORIES)[number];

export const SHOWCASE_HOST_TIERS = ["manufacturer", "distributor", "teardown", "community"] as const;
export type ShowcaseHostTier = (typeof SHOWCASE_HOST_TIERS)[number];

export const SHOWCASE_STATUSES = ["complete", "partial"] as const;
export type ShowcaseStatus = (typeof SHOWCASE_STATUSES)[number];

export const SHOWCASE_PART_EVIDENCE_LEVELS = ["verified", "inferred", "stale"] as const;
export type ShowcasePartEvidenceLevel = (typeof SHOWCASE_PART_EVIDENCE_LEVELS)[number];

/** Remote image from the source page; the binary is not committed. Credit and license are shown next to it. */
export interface ShowcaseImage {
  url: string;
  credit: string;
  license: string;
}

export interface ShowcaseSource {
  url: string;
  host_tier: ShowcaseHostTier;
  title: string;
  fetched_at: string;
  content_sha256: string;
}

export interface ShowcasePart {
  part_id: string;
  name: string;
  quantity: number;
  sku: string;
  mpn: string | null;
  manufacturer: string | null;
  vendor: Vendor;
  url: string;
  price_amount: Money | null;
  currency: string | null;
  availability: Availability;
  fetched_at: string;
  source_sha256: string;
  evidence_level: ShowcasePartEvidenceLevel;
  /** Quote from the part's vendor page containing the SKU. */
  evidence_quote: string;
  /** Quote from the product's source page naming the part. */
  bom_quote: string;
}

export interface ShowcaseUnsourcedPart {
  name: string;
  quantity: number | null;
  note: string;
}

export interface ShowcaseTotals {
  parts_total: number;
  parts_verified: number;
  /** Sum of quantity x price over sourced parts, only when every sourced part has a price in one currency; else null. */
  price_total_amount: Money | null;
  currency: string | null;
}

export interface ShowcaseProduct {
  schema_version: typeof SHOWCASE_SCHEMA_VERSION;
  product_id: string;
  name: string;
  category: ShowcaseCategory;
  summary: string;
  image: ShowcaseImage;
  source: ShowcaseSource;
  parts: ShowcasePart[];
  unsourced_parts: ShowcaseUnsourcedPart[];
  totals: ShowcaseTotals;
  /** complete: every named part is sourced. partial: some named parts have no vendor link. */
  status: ShowcaseStatus;
  generated_at: string;
  synthetic: false;
}

export interface ShowcaseIndexEntry {
  product_id: string;
  name: string;
  category: ShowcaseCategory;
  image: ShowcaseImage;
  parts_total: number;
  parts_verified: number;
  status: ShowcaseStatus;
}

export interface ShowcaseIndex {
  schema_version: typeof SHOWCASE_SCHEMA_VERSION;
  generated_at: string;
  products: ShowcaseIndexEntry[];
}
