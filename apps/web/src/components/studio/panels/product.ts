import type {
  AssemblyStep,
  BomItem,
  BuildPlan,
  CatalogComponent,
  LinkStatus,
  PlanComponent,
  VerificationFinding,
} from "./types";
import { catalogIndex, formatAmount, isBlocking, isSyntheticComponent, RESULT_ORDER, usableUrl } from "./helpers";

/**
 * Everything the product card shows for one catalog part, derived only from the plan and
 * catalog. Keyed by catalog_id, so a 3D part, its parts-list row and its BOM row all give
 * the same facts. Nothing here is computed beyond what the data states.
 */
export interface ProductFacts {
  catalogId: string;
  entry: CatalogComponent | undefined;
  bomRow: BomItem | undefined;
  /** Instances of this part in the plan: the BOM row's, else every component with this catalog_id. */
  instanceIds: string[];
  /** Instances drawn without a 3D model (`render_overrides.visible === false`). */
  unmodeledIds: string[];
  synthetic: boolean;
  /** Vendor link from the BOM row, only when it is a usable http(s) URL. */
  vendorUrl: string | null;
  linkStatus: LinkStatus | null;
  /** Catalog `purchase_url_verified_at`, only when that catalog URL is the BOM row's link. */
  linkVerifiedAt: string | null;
  /** Catalog price as recorded (amount + currency), or null. */
  price: string | null;
  priceCheckedAt: string | null;
  /** True when the plan's BOM row carries a unit price (so it counts in the known subtotal). */
  inBomSubtotal: boolean;
  availability: string | null;
  /** Findings naming any instance of this part: blocking first, then FAIL, UNKNOWN, WARN, PASS. */
  findings: VerificationFinding[];
  steps: AssemblyStep[];
}

export function componentById(plan: BuildPlan, instanceId: string | null | undefined): PlanComponent | undefined {
  return instanceId ? plan.components.find((c) => c.instance_id === instanceId) : undefined;
}

export function isUnmodeled(component: PlanComponent | undefined): boolean {
  return component?.render_overrides?.visible === false;
}

export function sortFindings(findings: VerificationFinding[]): VerificationFinding[] {
  return [...findings].sort(
    (a, b) =>
      Number(isBlocking(b)) - Number(isBlocking(a)) || RESULT_ORDER.indexOf(a.result) - RESULT_ORDER.indexOf(b.result),
  );
}

export function productFacts(plan: BuildPlan, catalog: CatalogComponent[], catalogId: string): ProductFacts {
  const entry = catalogIndex(catalog).get(catalogId);
  const bomRow = plan.bom.items.find((i) => i.catalog_id === catalogId);
  const instanceIds = bomRow
    ? [...bomRow.instance_ids]
    : plan.components.filter((c) => c.catalog_id === catalogId).map((c) => c.instance_id);
  const ids = new Set(instanceIds);
  const unmodeledIds = instanceIds.filter((id) => isUnmodeled(componentById(plan, id)));
  const check = plan.provenance.sourcing?.link_checks?.[catalogId];
  const vendorUrl = check?.status === "broken" ? null : bomRow ? usableUrl(bomRow.purchase_url) : null;
  const catalogPurchase = usableUrl(entry?.sourcing.purchase_url);
  const linkVerifiedAt =
    vendorUrl && catalogPurchase === vendorUrl && bomRow?.link_status === "verified_product"
      ? entry?.sourcing.purchase_url_verified_at ?? null
      : null;
  const price = entry ? formatAmount(entry.sourcing.price_amount, entry.sourcing.price_currency) : null;
  return {
    catalogId,
    entry,
    bomRow,
    instanceIds,
    unmodeledIds,
    synthetic: plan.provenance.sourcing?.synthetic === true || isSyntheticComponent(entry),
    vendorUrl,
    linkStatus: check?.status === "broken" ? "not_available" : bomRow?.link_status ?? null,
    linkVerifiedAt,
    price,
    priceCheckedAt: price ? entry?.sourcing.price_checked_at ?? null : null,
    inBomSubtotal: !!bomRow && formatAmount(bomRow.unit_price_amount, plan.bom.currency) !== null,
    availability: entry?.sourcing.availability_status ?? null,
    findings: sortFindings(plan.verification.findings.filter((f) => f.affected_instance_ids.some((id) => ids.has(id)))),
    steps: plan.assembly_steps.filter((s) => s.instance_ids.some((id) => ids.has(id))),
  };
}

/** "2026-10-20T00:00:00Z" -> "2026-10-20"; other strings unchanged. */
export function formatDay(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = /^\d{4}-\d{2}-\d{2}/.exec(value);
  return m ? m[0] : value;
}

const AVAILABILITY_LABEL: Record<string, string> = {
  in_stock: "In stock",
  out_of_stock: "Out of stock",
  unknown: "Unknown",
};

export function availabilityLabel(value: string | null | undefined): string {
  if (!value) return "Unknown";
  return AVAILABILITY_LABEL[value] ?? value.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export function partName(catalog: CatalogComponent[], catalogId: string): string {
  return catalogIndex(catalog).get(catalogId)?.identity.model ?? catalogId;
}

export interface BuyListLine {
  catalogId: string;
  name: string;
  quantity: number;
  unitPrice: string | null;
  url: string;
  linkVerifiedAt: string | null;
  firstInstanceId: string | null;
}

export interface BuildSummary {
  placedCount: number;
  lineCount: number;
  unitCount: number;
  unmodeledCount: number;
  knownSubtotal: string | null;
  /** True only when the plan says complete, every line is priced and a subtotal exists. */
  complete: boolean;
  unpricedLines: BomItem[];
  verifiedLinkLines: BomItem[];
  referenceOnlyLines: BomItem[];
  noLinkLines: BomItem[];
  blocking: VerificationFinding[];
  buyList: BuyListLine[];
}

/** Build-level counts for the overview; reads the plan's own totals, never sums prices. */
export function summarizeBuild(plan: BuildPlan, catalog: CatalogComponent[]): BuildSummary {
  const { bom } = plan;
  const knownSubtotal = formatAmount(bom.known_subtotal_amount, bom.currency);
  const unpricedLines = bom.items.filter((i) => formatAmount(i.unit_price_amount, bom.currency) === null);
  const verifiedLinkLines = bom.items.filter((i) => i.link_status === "verified_product" && usableUrl(i.purchase_url) && plan.provenance.sourcing?.link_checks?.[i.catalog_id]?.status !== "broken");
  const referenceOnlyLines = bom.items.filter((i) => i.link_status === "manufacturer_reference_only");
  const noLinkLines = bom.items.filter((i) => !verifiedLinkLines.includes(i) && !referenceOnlyLines.includes(i));
  return {
    placedCount: plan.components.length,
    lineCount: bom.items.length,
    unitCount: bom.items.reduce((n, i) => n + i.quantity, 0),
    unmodeledCount: plan.components.filter(isUnmodeled).length,
    knownSubtotal,
    complete: bom.total_status === "complete" && unpricedLines.length === 0 && knownSubtotal !== null,
    unpricedLines,
    verifiedLinkLines,
    referenceOnlyLines,
    noLinkLines,
    blocking: plan.verification.findings.filter(isBlocking),
    buyList: verifiedLinkLines.map((item) => {
      const facts = productFacts(plan, catalog, item.catalog_id);
      return {
        catalogId: item.catalog_id,
        name: partName(catalog, item.catalog_id),
        quantity: item.quantity,
        unitPrice: formatAmount(item.unit_price_amount, bom.currency),
        url: usableUrl(item.purchase_url) as string,
        linkVerifiedAt: facts.linkVerifiedAt,
        firstInstanceId: item.instance_ids[0] ?? null,
      };
    }),
  };
}
