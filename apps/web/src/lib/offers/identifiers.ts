/** Identifier normalisation matching `OfferQuery.normalized_key` in the schema. */
import type { OfferQuery } from "./types";

function normalise(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ").replace(/\|/g, " ");
}

/** Lowercase, whitespace-collapsed `sku|mpn|gtin|manufacturer`; empty fields stay empty. */
export function normalizedKey(parts: {
  sku?: string | null;
  mpn?: string | null;
  gtin?: string | null;
  manufacturer?: string | null;
}): string {
  return [parts.sku, parts.mpn, parts.gtin, parts.manufacturer].map(normalise).join("|");
}

export function buildOfferQuery(parts: {
  sku?: string | null;
  mpn?: string | null;
  gtin?: string | null;
  manufacturer?: string | null;
  catalog_id?: string | null;
}): OfferQuery {
  const clean = (v: string | null | undefined) => (v && v.trim() !== "" ? v.trim() : null);
  return {
    sku: clean(parts.sku),
    mpn: clean(parts.mpn),
    gtin: clean(parts.gtin),
    manufacturer: clean(parts.manufacturer),
    catalog_id: clean(parts.catalog_id),
    normalized_key: normalizedKey(parts),
  };
}

/** `demo.*` catalog parts are synthetic placeholders; the API refuses to search for them. */
export function isSyntheticCatalogId(catalogId: string): boolean {
  return catalogId.startsWith("demo.");
}
