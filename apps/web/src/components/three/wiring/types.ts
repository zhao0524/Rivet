/**
 * Structural subset of the v1 contracts (docs/implementation.md §3.2–3.4) that the
 * wiring overlay reads. Field names follow the wire format exactly (snake_case) so
 * full `CatalogComponent` / `BuildPlan` objects can be passed without mapping.
 */

export type Vec3 = readonly [number, number, number];

export interface WiringPort {
  port_id: string;
  signal: string;
  notes?: string | null;
  /**
   * Not part of the v1 schema. Read only if a future catalog revision supplies an
   * evidenced component-local port position (millimetres, same frame as `mounts`).
   */
  position_mm?: unknown;
}

export interface WiringDimensions {
  x: number | null;
  y: number | null;
  z: number | null;
}

export interface WiringCatalogComponent {
  catalog_id: string;
  identity?: { model?: string | null; category?: string | null };
  physical: {
    dimensions_mm: WiringDimensions | null;
    bounds_verified: boolean;
  };
  ports: readonly WiringPort[];
}

export interface WiringPose {
  position_mm: readonly number[];
  rotation_deg: readonly number[];
}

export interface WiringComponentInstance {
  instance_id: string;
  catalog_id: string;
  role?: string;
  pose: WiringPose;
}

export interface WiringEndpointRef {
  instance_id: string;
  port_id: string;
}

export interface WiringConnection {
  connection_id: string;
  kind: string;
  from: WiringEndpointRef;
  to: WiringEndpointRef;
  net_name?: string | null;
  notes?: string | null;
}

export interface WiringPlanInput {
  build_id?: string;
  revision?: number;
  components: readonly WiringComponentInstance[];
  connections: readonly WiringConnection[];
}

/**
 * `catalog_port_position`: the catalog supplied a local port position AND verified bounds.
 * `catalog_port_position_unverified`: a local position exists but bounds are unverified.
 * `schematic_bounds`: no position data; a deterministic slot on the component's top face.
 * `pose_origin`: component bounds are unknown, so the anchor sits on the instance origin.
 */
export type AnchorSource =
  | 'catalog_port_position'
  | 'catalog_port_position_unverified'
  | 'schematic_bounds'
  | 'pose_origin';

export interface WireAnchor {
  instance_id: string;
  port_id: string;
  catalog_id: string;
  signal: string;
  /** World-space position in millimetres (BuildPlan frame). */
  position_mm: Vec3;
  source: AnchorSource;
  approximate: boolean;
}

export interface WireRoute {
  connection_id: string;
  net_name: string | null;
  notes: string | null;
  from: WireAnchor;
  to: WireAnchor;
  /** e.g. `i2c` or `digital_output → pwm_input` when the two ends differ. */
  signal_label: string;
  color: string;
  /** Cubic bezier control points in world millimetres: [start, c1, c2, end]. */
  control_points_mm: readonly [Vec3, Vec3, Vec3, Vec3];
  /** Lane index among wires that join the same pair of instances. */
  lane: number;
  approximate: boolean;
}

export type WiringWarningCode =
  | 'UNKNOWN_INSTANCE'
  | 'AMBIGUOUS_INSTANCE'
  | 'UNKNOWN_CATALOG_COMPONENT'
  | 'UNKNOWN_PORT'
  | 'INVALID_POSE'
  | 'DUPLICATE_CONNECTION_ID'
  | 'SELF_CONNECTION'
  | 'UNKNOWN_BOUNDS';

export interface WiringWarning {
  code: WiringWarningCode;
  /** `blocking` warnings mean the wire was not drawn. */
  severity: 'blocking' | 'advisory';
  connection_id: string;
  endpoint: 'from' | 'to' | null;
  instance_id: string | null;
  port_id: string | null;
  catalog_id: string | null;
  wire_drawn: boolean;
  message: string;
}

export interface WiringLayout {
  build_id: string | null;
  revision: number | null;
  wires: readonly WireRoute[];
  warnings: readonly WiringWarning[];
  /** True if any drawn wire uses an approximate (schematic) anchor. */
  approximate: boolean;
  counts: {
    electrical_connections: number;
    drawn: number;
    rejected: number;
    non_electrical_skipped: number;
  };
}

export interface WiringFilter {
  signals?: readonly string[];
  instance_ids?: readonly string[];
  connection_ids?: readonly string[];
  net_names?: readonly string[];
}

export type WiringPalette = Readonly<Record<string, string>>;
