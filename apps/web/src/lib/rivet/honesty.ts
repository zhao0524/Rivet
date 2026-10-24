/** Display-safe summaries that never upgrade unknown evidence to verified. */
import type { BomItem, BuildPlan, CatalogComponent } from "./types";

export const SAVED_SYNTHETIC_EXAMPLE_LABEL = "Saved synthetic example";
export const SAVED_BUILD_LABEL = "Saved demo build";

export type DataSourceMode = "fixture" | "http";

export interface BuildTrust {
  /** Short label suitable for a banner. */
  label: string;
  isSynthetic: boolean;
  isSaved: boolean;
  /** True only for a non-synthetic, `verified` plan without blocking FAIL/UNKNOWN findings. */
  canDisplayAsVerified: boolean;
  reasons: string[];
}

const SYNTHETIC_MARKERS = /synthetic/i;

export function isSyntheticPlan(plan: BuildPlan, catalog: readonly CatalogComponent[] = []): boolean {
  if (SYNTHETIC_MARKERS.test(plan.provenance.catalog_version)) return true;
  if (plan.components.some((c) => c.catalog_id.startsWith("demo."))) return true;
  const used = new Set(plan.components.map((c) => c.catalog_id));
  return catalog.some((c) => used.has(c.catalog_id) && SYNTHETIC_MARKERS.test(c.identity.manufacturer));
}

export function describeBuildTrust(
  plan: BuildPlan,
  sourceMode: DataSourceMode,
  catalog: readonly CatalogComponent[] = [],
): BuildTrust {
  const reasons: string[] = [];
  const isSynthetic = isSyntheticPlan(plan, catalog);
  const isSaved = sourceMode === "fixture" || plan.provenance.generation_mode === "fixture";
  if (isSynthetic) reasons.push("Components are synthetic placeholders, not sourced parts");
  if (isSaved) reasons.push("Loaded from a saved build, not freshly generated");
  if (plan.provenance.generation_mode === "fallback") reasons.push("Produced by a fallback path, not live generation");
  const blocking = plan.verification.findings.filter(
    (f) => f.severity === "blocking" && (f.result === "FAIL" || f.result === "UNKNOWN"),
  );
  if (blocking.length > 0) reasons.push(`${blocking.length} blocking finding(s) are FAIL or UNKNOWN`);
  if (plan.status !== "verified") reasons.push(`Build status is "${plan.status}"`);

  const canDisplayAsVerified = !isSynthetic && plan.status === "verified" && blocking.length === 0;
  let label: string;
  if (isSynthetic) label = SAVED_SYNTHETIC_EXAMPLE_LABEL;
  else if (isSaved) label = SAVED_BUILD_LABEL;
  else if (plan.provenance.generation_mode === "fallback") label = "Fallback output";
  else label = "Live generation";
  return { label, isSynthetic, isSaved, canDisplayAsVerified, reasons };
}

export interface BomSummary {
  rowCount: number;
  unitCount: number;
  unpricedRowCount: number;
  currency: string;
  /** Server-provided known subtotal, untouched (decimal string or null). */
  knownSubtotal: string | null;
  /** Never "Total $X" when any price is unknown. */
  totalLabel: "Total" | "Known subtotal" | "Total unavailable";
}

export function summarizeBom(plan: BuildPlan): BomSummary {
  const items = plan.bom.items;
  const unpricedRowCount = items.filter((i) => i.unit_price_amount === null).length;
  const complete = plan.bom.total_status === "complete" && unpricedRowCount === 0 && plan.bom.known_subtotal_amount !== null;
  return {
    rowCount: items.length,
    unitCount: items.reduce((n, i) => n + i.quantity, 0),
    unpricedRowCount,
    currency: plan.bom.currency,
    knownSubtotal: plan.bom.known_subtotal_amount,
    totalLabel: complete ? "Total" : plan.bom.known_subtotal_amount !== null ? "Known subtotal" : "Total unavailable",
  };
}

export interface BomLink {
  href: string | null;
  kind: "store" | "manufacturer_reference" | "none";
}

/** A purchase link is only clickable when the server sourced it. */
export function bomLinkFor(item: BomItem): BomLink {
  if (!item.purchase_url || item.link_status === "not_available") return { href: null, kind: "none" };
  return {
    href: item.purchase_url,
    kind: item.link_status === "verified_product" ? "store" : "manufacturer_reference",
  };
}
