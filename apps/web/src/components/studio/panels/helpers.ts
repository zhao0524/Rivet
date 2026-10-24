import type {
  BuildPlan,
  CatalogComponent,
  FindingResult,
  LinkStatus,
  PlanStatus,
  VerificationFinding,
} from "./types";

export function catalogIndex(catalog: CatalogComponent[]): Map<string, CatalogComponent> {
  return new Map(catalog.map((c) => [c.catalog_id, c]));
}

/** Only http(s) URLs that were actually provided may become active links. */
export function usableUrl(url: string | null | undefined): string | null {
  if (typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? trimmed : null;
  } catch {
    return null;
  }
}

/** Formats a provided decimal string; never computes or guesses a value. */
export function formatAmount(amount: string | null | undefined, currency: string | null | undefined): string | null {
  if (amount === null || amount === undefined || String(amount).trim() === "") return null;
  return currency ? `${amount} ${currency}` : String(amount);
}

export const LINK_STATUS_LABEL: Record<LinkStatus, string> = {
  verified_product: "Verified product listing",
  manufacturer_reference_only: "Manufacturer reference only (not a store listing)",
  not_available: "No link available",
};

export const PLAN_STATUS_LABEL: Record<PlanStatus, string> = {
  verified: "Verified (implemented checks passed)",
  verified_with_warnings: "Verified with warnings",
  needs_review: "Needs review",
  unbuildable: "Unbuildable",
};

export const RESULT_ORDER: FindingResult[] = ["FAIL", "UNKNOWN", "WARN", "PASS"];

export function isBlocking(f: VerificationFinding): boolean {
  return f.severity === "blocking" && f.result !== "PASS";
}

/** True when the data must not be presented as real, verified hardware. */
export function isSyntheticPlan(plan: BuildPlan): boolean {
  return plan.provenance?.generation_mode !== "live";
}

export function isSyntheticComponent(c: CatalogComponent | undefined): boolean {
  if (!c) return false;
  const manufacturer = c.identity.manufacturer ?? "";
  return (
    /synthetic/i.test(manufacturer) ||
    c.evidence.dimensions === "synthetic_approximation" ||
    c.catalog_id.startsWith("demo.")
  );
}

export function componentIds(plan: BuildPlan): Set<string> {
  return new Set(plan.components.map((c) => c.instance_id));
}
