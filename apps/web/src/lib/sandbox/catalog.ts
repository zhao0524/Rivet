import demoCatalog from "./catalog.json";
import { formatPartPrice } from "../showcase/format";
import { showcaseFixtureIndex, showcaseFixtureProduct } from "../showcase/fixtures";
import { SHOWCASE_CATEGORIES, type ShowcasePart, type ShowcaseProduct } from "../showcase/types";
import {
  SANDBOX_MAX_PRODUCTS,
  type SandboxPart,
  type SandboxProduct,
  type SandboxShape,
  type Vec3Mm,
} from "./types";

const SHAPES: readonly SandboxShape[] = ["box", "cylinder", "sphere"];
const EVIDENCE_COLOR = { verified: "#2f8f5b", inferred: "#e8a33d", stale: "#9aa3b2" } as const;

const isVec3 = (v: unknown): v is Vec3Mm => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && Number.isFinite(n));

/** Throws on the first malformed product, so a bad hand edit to `catalog.json` fails loudly in tests and at load. */
export function parseDemoCatalog(raw: unknown): SandboxProduct[] {
  const doc = raw as { synthetic?: unknown; products?: unknown };
  if (doc?.synthetic !== true || !Array.isArray(doc.products)) throw new Error("sandbox catalog must be a synthetic list of products");
  return doc.products.map((p, i) => {
    const where = `sandbox product #${i + 1}`;
    if (typeof p?.product_id !== "string" || !p.product_id) throw new Error(`${where}: product_id`);
    if (typeof p.name !== "string" || !p.name) throw new Error(`${where}: name`);
    if (!SHOWCASE_CATEGORIES.includes(p.category)) throw new Error(`${where}: category ${String(p.category)}`);
    if (!Array.isArray(p.parts) || p.parts.length === 0) throw new Error(`${where}: needs parts`);
    const seen = new Set<string>();
    const parts: SandboxPart[] = p.parts.map((part: Record<string, unknown>) => {
      const id = part.part_id;
      if (typeof id !== "string" || !id || seen.has(id)) throw new Error(`${where}: bad or duplicate part_id ${String(id)}`);
      seen.add(id);
      if (!SHAPES.includes(part.shape as SandboxShape)) throw new Error(`${where}/${id}: shape`);
      if (!isVec3(part.size_mm) || part.size_mm.some((n) => n <= 0)) throw new Error(`${where}/${id}: size_mm`);
      if (!isVec3(part.position_mm)) throw new Error(`${where}/${id}: position_mm`);
      if (part.rotation_deg !== undefined && !isVec3(part.rotation_deg)) throw new Error(`${where}/${id}: rotation_deg`);
      if (typeof part.color !== "string" || !/^#[0-9a-f]{6}$/i.test(part.color)) throw new Error(`${where}/${id}: color`);
      if (typeof part.name !== "string" || typeof part.group !== "string" || typeof part.note !== "string") throw new Error(`${where}/${id}: text`);
      return {
        part_id: id,
        name: part.name,
        group: part.group,
        quantity: typeof part.quantity === "number" && part.quantity >= 1 ? part.quantity : 1,
        shape: part.shape as SandboxShape,
        size_mm: part.size_mm,
        position_mm: part.position_mm,
        ...(part.rotation_deg ? { rotation_deg: part.rotation_deg as Vec3Mm } : {}),
        color: part.color,
        note: part.note,
        sourcing: null,
      };
    });
    return { product_id: p.product_id, name: p.name, category: p.category, summary: String(p.summary ?? ""), kind: "demo" as const, parts, source: null };
  });
}

/**
 * A real showcase product on a plain illustrative layout: one slab per sourced part in a tidy grid,
 * colored by how strong its evidence is. The shapes carry no meaning beyond "this is one part".
 */
export function showcaseToSandbox(product: ShowcaseProduct): SandboxProduct {
  const cols = Math.max(2, Math.ceil(Math.sqrt(product.parts.length)));
  const gap = 56;
  const rows = Math.ceil(product.parts.length / cols);
  const parts = product.parts.map((p: ShowcasePart, n): SandboxPart => {
    const col = n % cols;
    const row = Math.floor(n / cols);
    return {
      part_id: p.part_id,
      name: p.name,
      group: p.manufacturer ?? p.vendor.name,
      quantity: p.quantity,
      shape: "box",
      size_mm: [40, 10 + Math.min(p.quantity, 4) * 3, 30],
      position_mm: [(col - (cols - 1) / 2) * gap, 8, (row - (rows - 1) / 2) * gap],
      color: EVIDENCE_COLOR[p.evidence_level],
      note: p.bom_quote,
      sourcing: {
        sku: p.sku,
        mpn: p.mpn,
        manufacturer: p.manufacturer,
        vendor: p.vendor.name,
        url: p.url,
        price: formatPartPrice(p),
        availability: p.availability.replace(/_/g, " "),
        evidence_level: p.evidence_level,
        evidence_quote: p.evidence_quote,
      },
    };
  });
  return { product_id: product.product_id, name: product.name, category: product.category, summary: product.summary, kind: "showcase", parts, source: { url: product.source.url, title: product.source.title } };
}

function build(): SandboxProduct[] {
  const real: SandboxProduct[] = [];
  for (const entry of showcaseFixtureIndex().products) {
    const product = showcaseFixtureProduct(entry.product_id);
    if (product) real.push(showcaseToSandbox(product));
  }
  const all = [...real, ...parseDemoCatalog(demoCatalog)];
  const ids = new Set<string>();
  for (const p of all) {
    if (ids.has(p.product_id)) throw new Error(`duplicate sandbox product ${p.product_id}`);
    ids.add(p.product_id);
  }
  return all.slice(0, SANDBOX_MAX_PRODUCTS);
}

let cache: SandboxProduct[] | null = null;

/** Real SKU-backed products first, then the hard-coded demo models; at most `SANDBOX_MAX_PRODUCTS`. */
export function sandboxProducts(): readonly SandboxProduct[] {
  return (cache ??= build());
}

export function sandboxProduct(productId: string): SandboxProduct | null {
  return sandboxProducts().find((p) => p.product_id === productId) ?? null;
}
