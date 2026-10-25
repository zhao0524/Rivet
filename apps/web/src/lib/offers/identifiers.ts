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

const GTIN_RE = /^\d{8}$|^\d{12,14}$/;

/** GTIN check digit (GS1 mod 10). */
export function gtinCheckDigitOk(digits: string): boolean {
  if (!GTIN_RE.test(digits)) return false;
  const body = digits.slice(0, -1).split("").reverse();
  const sum = body.reduce((acc, d, i) => acc + Number(d) * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === Number(digits[digits.length - 1]);
}

/**
 * What the part-number search box sends: a valid GTIN goes as `gtin`, anything else as `sku` (the
 * API also matches a page's MPN against it). Null for empty input.
 */
export function identifierFromInput(input: string): { sku?: string; gtin?: string } | null {
  const text = input.trim();
  if (!text) return null;
  const digits = text.replace(/[\s-]/g, "");
  if (gtinCheckDigitOk(digits)) return { gtin: digits };
  return { sku: text };
}
