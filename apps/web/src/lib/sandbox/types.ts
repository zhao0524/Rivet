/**
 * Sandbox catalogue: products whose parts are hand-placed, hard-coded shapes the viewer can select.
 * Lengths are millimetres in a right-handed, Y-up frame (the stage's canonical units); rotations are
 * XYZ Euler degrees. A `demo` product is invented geometry and says so; a `showcase` product carries
 * real, fetched vendor facts (SKU, price, evidence) from `lib/showcase` on a generic illustrative layout.
 */
import type { ShowcaseCategory } from "../showcase/types";

export type SandboxShape = "box" | "cylinder" | "sphere";
export type SandboxKind = "demo" | "showcase";

export type Vec3Mm = readonly [number, number, number];

/** Vendor facts for one part; present only for `showcase` products. */
export interface SandboxSourcing {
  sku: string;
  mpn: string | null;
  manufacturer: string | null;
  vendor: string;
  url: string;
  /** "24.95 USD as of 2026-10-24", or the not-stated text. */
  price: string;
  availability: string;
  evidence_level: "verified" | "inferred" | "stale";
  evidence_quote: string;
}

export interface SandboxPart {
  part_id: string;
  name: string;
  group: string;
  quantity: number;
  shape: SandboxShape;
  /** Box: [x, y, z]. Cylinder: [diameter, height, diameter] with its axis on Y before rotation. Sphere: [d, d, d]. */
  size_mm: Vec3Mm;
  position_mm: Vec3Mm;
  rotation_deg?: Vec3Mm;
  color: string;
  note: string;
  sourcing: SandboxSourcing | null;
}

export interface SandboxProduct {
  product_id: string;
  name: string;
  category: ShowcaseCategory;
  summary: string;
  kind: SandboxKind;
  parts: SandboxPart[];
  /** Where a `showcase` product's parts list came from. */
  source: { url: string; title: string } | null;
}

export const SANDBOX_MAX_PRODUCTS = 50;
export const DEMO_LABEL = "Demo model";
export const DEMO_HONESTY = "Hand-placed demo shapes. Not a real product: no SKUs, prices or vendors.";
export const SHOWCASE_LAYOUT_HONESTY =
  "Real parts list with fetched vendor facts. The 3D layout is illustrative: the maker publishes no geometry.";
