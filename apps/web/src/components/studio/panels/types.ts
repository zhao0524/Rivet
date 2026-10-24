// Structural mirror of the v1 wire contracts (docs/implementation.md §3.2–3.4).
// Panels receive these via props only; snake_case matches the wire format.

export type PlanStatus = "verified" | "verified_with_warnings" | "needs_review" | "unbuildable";
export type FindingResult = "PASS" | "WARN" | "FAIL" | "UNKNOWN";
export type FindingSeverity = "blocking" | "advisory";
export type BomTotalStatus = "complete" | "incomplete" | "not_available";
export type LinkStatus = "verified_product" | "manufacturer_reference_only" | "not_available";
export type GenerationMode = "live" | "fixture" | "fallback" | "manual_template";

export interface CatalogComponent {
  schema_version: string;
  catalog_id: string;
  identity: {
    manufacturer: string | null;
    model: string | null;
    sku: string | null;
    category: string | null;
  };
  physical: {
    dimensions_mm: { x: number | null; y: number | null; z: number | null } | null;
    mass_g: number | null;
    bounds_verified: boolean;
    geometry_kind?: string | null;
    asset_path?: string | null;
    material_preset?: string | null;
  };
  mounts?: unknown[];
  ports?: unknown[];
  sourcing: {
    manufacturer_reference_url: string | null;
    datasheet_url: string | null;
    purchase_url: string | null;
    purchase_url_verified_at: string | null;
    price_amount: string | null;
    price_currency: string | null;
    price_checked_at: string | null;
    availability_status: string | null;
  };
  evidence: {
    dimensions: string | null;
    electrical: string | null;
    price: string | null;
    notes: string[];
  };
}

export interface PlanComponent {
  instance_id: string;
  catalog_id: string;
  role: string;
  parent_instance_id: string | null;
  attached_to_mount_id: string | null;
  own_mount_id: string | null;
  pose?: { position_mm: number[]; rotation_deg: number[] };
  render_overrides?: Record<string, unknown>;
}

export interface VerificationFinding {
  rule_id: string;
  result: FindingResult;
  severity: FindingSeverity;
  affected_instance_ids: string[];
  message: string;
  evidence_urls: string[];
}

export interface AssemblyStep {
  step: number;
  title: string;
  instance_ids: string[];
  instructions: string;
  safety_notes: string[];
}

export interface BomItem {
  catalog_id: string;
  quantity: number;
  instance_ids: string[];
  unit_price_amount: string | null;
  purchase_url: string | null;
  link_status: LinkStatus;
}

export interface Bom {
  currency: string | null;
  known_subtotal_amount: string | null;
  total_status: BomTotalStatus;
  items: BomItem[];
}

export interface Provenance {
  input_mode: string;
  catalog_version: string;
  generation_mode: GenerationMode;
  notes: string[];
}

export interface BuildPlan {
  schema_version: string;
  build_id: string;
  revision: number;
  project_family: string;
  title: string;
  status: PlanStatus;
  components: PlanComponent[];
  connections?: unknown[];
  verification: { overall: PlanStatus; findings: VerificationFinding[] };
  assembly_steps: AssemblyStep[];
  bom: Bom;
  provenance: Provenance;
  [key: string]: unknown;
}

export interface RevisionSummary {
  revision: number;
  created_at?: string | null;
  status?: PlanStatus | null;
  label?: string | null;
  title?: string | null;
}
