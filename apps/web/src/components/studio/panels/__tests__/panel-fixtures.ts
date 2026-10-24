import type { BuildPlan, CatalogComponent } from "../types";

// Test-local data shaped like the synthetic Appendix A fixture plus a sourced
// entry, so link/price states can be exercised without touching fixtures/**.

export function catalogEntry(id: string, overrides: Partial<CatalogComponent> = {}): CatalogComponent {
  return {
    schema_version: "1.0",
    catalog_id: id,
    identity: { manufacturer: "SYNTHETIC DEMO ONLY", model: `Model ${id}`, sku: null, category: "motor" },
    physical: {
      dimensions_mm: { x: 70, y: null, z: 22 },
      mass_g: null,
      bounds_verified: false,
      geometry_kind: "procedural",
      asset_path: null,
      material_preset: "polymer",
    },
    mounts: [],
    ports: [],
    sourcing: {
      manufacturer_reference_url: null,
      datasheet_url: null,
      purchase_url: null,
      purchase_url_verified_at: null,
      price_amount: null,
      price_currency: null,
      price_checked_at: null,
      availability_status: "unknown",
    },
    evidence: { dimensions: "synthetic_approximation", electrical: "unverified", price: "unknown", notes: ["Bootstrap only"] },
    ...overrides,
  };
}

export const catalog: CatalogComponent[] = [
  catalogEntry("demo.chassis_2wd", {
    identity: { manufacturer: "SYNTHETIC DEMO ONLY", model: "2WD Chassis", sku: null, category: "chassis" },
  }),
  catalogEntry("demo.tt_motor", {
    identity: { manufacturer: "SYNTHETIC DEMO ONLY", model: "TT Motor", sku: null, category: "motor" },
  }),
  catalogEntry("board.sourced_controller", {
    identity: { manufacturer: "Example Maker", model: "Controller Board", sku: "CB-100", category: "controller" },
    physical: { dimensions_mm: { x: 55, y: 13, z: 28 }, mass_g: 10, bounds_verified: true },
    sourcing: {
      manufacturer_reference_url: "https://maker.example/cb-100",
      datasheet_url: "https://maker.example/cb-100.pdf",
      purchase_url: "https://shop.example/cb-100",
      purchase_url_verified_at: "2026-10-20T00:00:00Z",
      price_amount: "9.50",
      price_currency: "USD",
      price_checked_at: "2026-10-20T00:00:00Z",
      availability_status: "listed",
    },
    evidence: { dimensions: "manufacturer_datasheet", electrical: "manufacturer_datasheet", price: "captured", notes: [] },
  }),
  catalogEntry("driver.reference_only", {
    identity: { manufacturer: "Example Maker", model: "Driver", sku: "DRV-1", category: "motor_driver" },
    sourcing: {
      manufacturer_reference_url: "https://maker.example/drv-1",
      datasheet_url: null,
      purchase_url: null,
      purchase_url_verified_at: null,
      price_amount: null,
      price_currency: null,
      price_checked_at: null,
      availability_status: "unknown",
    },
  }),
];

export function makePlan(overrides: Partial<BuildPlan> = {}): BuildPlan {
  return {
    schema_version: "1.0",
    build_id: "rivet-synthetic-rover-fixture",
    revision: 2,
    project_family: "rover",
    title: "Synthetic starter rover (NOT SOURCED)",
    status: "needs_review",
    components: [
      { instance_id: "chassis-1", catalog_id: "demo.chassis_2wd", role: "chassis", parent_instance_id: null, attached_to_mount_id: null, own_mount_id: null },
      { instance_id: "motor-left-1", catalog_id: "demo.tt_motor", role: "drive_motor_left", parent_instance_id: "chassis-1", attached_to_mount_id: "motor_left", own_mount_id: null },
      { instance_id: "motor-right-1", catalog_id: "demo.tt_motor", role: "drive_motor_right", parent_instance_id: "chassis-1", attached_to_mount_id: "motor_right", own_mount_id: null },
      { instance_id: "controller-1", catalog_id: "board.sourced_controller", role: "controller", parent_instance_id: "chassis-1", attached_to_mount_id: null, own_mount_id: null },
      { instance_id: "driver-1", catalog_id: "driver.reference_only", role: "motor_driver", parent_instance_id: "chassis-1", attached_to_mount_id: null, own_mount_id: null },
      { instance_id: "ghost-1", catalog_id: "demo.not_in_catalog", role: "unknown", parent_instance_id: null, attached_to_mount_id: null, own_mount_id: null },
    ],
    connections: [],
    verification: {
      overall: "needs_review",
      findings: [
        { rule_id: "electrical.motor_current", result: "FAIL", severity: "blocking", affected_instance_ids: ["driver-1", "motor-left-1"], message: "Driver current rating below motor stall current", evidence_urls: [] },
        { rule_id: "fixture.synthetic_not_sourced", result: "UNKNOWN", severity: "blocking", affected_instance_ids: ["chassis-1", "motor-left-1", "motor-right-1"], message: "Synthetic parts", evidence_urls: [] },
        { rule_id: "budget.partial", result: "WARN", severity: "advisory", affected_instance_ids: [], message: "Prices incomplete", evidence_urls: [] },
        { rule_id: "mechanical.fits_deck", result: "PASS", severity: "blocking", affected_instance_ids: ["controller-1"], message: "Fits", evidence_urls: ["https://maker.example/cb-100.pdf"] },
      ],
    },
    assembly_steps: [
      { step: 1, title: "Mount the chassis", instance_ids: ["chassis-1"], instructions: "", safety_notes: [] },
      { step: 2, title: "Attach the motors", instance_ids: ["motor-left-1", "motor-right-1"], instructions: "", safety_notes: [] },
      { step: 4, title: "Place controller and driver", instance_ids: ["controller-1", "driver-1"], instructions: "", safety_notes: [] },
    ],
    bom: {
      currency: "USD",
      known_subtotal_amount: "9.50",
      total_status: "incomplete",
      items: [
        { catalog_id: "demo.chassis_2wd", quantity: 1, instance_ids: ["chassis-1"], unit_price_amount: null, purchase_url: null, link_status: "not_available" },
        { catalog_id: "demo.tt_motor", quantity: 2, instance_ids: ["motor-left-1", "motor-right-1"], unit_price_amount: null, purchase_url: null, link_status: "not_available" },
        { catalog_id: "board.sourced_controller", quantity: 1, instance_ids: ["controller-1"], unit_price_amount: "9.50", purchase_url: "https://shop.example/cb-100", link_status: "verified_product" },
        { catalog_id: "driver.reference_only", quantity: 1, instance_ids: ["driver-1"], unit_price_amount: null, purchase_url: "https://maker.example/drv-1", link_status: "manufacturer_reference_only" },
        { catalog_id: "demo.missing_part", quantity: 1, instance_ids: ["wheel-left-1"], unit_price_amount: null, purchase_url: null, link_status: "verified_product" },
      ],
    },
    provenance: { input_mode: "image_and_text", catalog_version: "SYNTHETIC-BOOTSTRAP", generation_mode: "fixture", notes: [] },
    ...overrides,
  };
}
