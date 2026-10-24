/**
 * Canonical Rivet wire types (implementation.md §3.1–3.6).
 * Field names are the exact snake_case JSON contract; do not add camelCase aliases.
 */

export const SCHEMA_VERSION = "1.0" as const;
export type SchemaVersion = typeof SCHEMA_VERSION;

/** [x, y, z] in millimetres (positions) or degrees (rotations, XYZ order). */
export type Vec3 = [number, number, number];

/** Decimal amount serialized as a string, e.g. "12.50". */
export type DecimalString = string;

/** ISO-8601 UTC timestamp string. */
export type IsoTimestamp = string;

/** A string enum that also tolerates values not yet named in the contract. */
export type OpenString<Known extends string> = Known | (string & {});

// ---------------------------------------------------------------------------
// §3.4 enumerations
// ---------------------------------------------------------------------------

export const BUILD_STATUSES = ["verified", "verified_with_warnings", "needs_review", "unbuildable"] as const;
export type BuildStatus = (typeof BUILD_STATUSES)[number];

export const FINDING_RESULTS = ["PASS", "WARN", "FAIL", "UNKNOWN"] as const;
export type FindingResult = (typeof FINDING_RESULTS)[number];

export const FINDING_SEVERITIES = ["blocking", "advisory"] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

export const COMPILE_STATUSES = ["passed", "failed", "not_checked", "not_supported"] as const;
export type CompileStatus = (typeof COMPILE_STATUSES)[number];

export const BOM_TOTAL_STATUSES = ["complete", "incomplete", "not_available"] as const;
export type BomTotalStatus = (typeof BOM_TOTAL_STATUSES)[number];

export const LINK_STATUSES = ["verified_product", "manufacturer_reference_only", "not_available"] as const;
export type LinkStatus = (typeof LINK_STATUSES)[number];

export const SIMULATION_KINDS = ["differential_drive_2d", "none"] as const;
export type SimulationKind = (typeof SIMULATION_KINDS)[number];

export const GENERATION_MODES = ["live", "fixture", "fallback", "manual_template"] as const;
export type GenerationMode = (typeof GENERATION_MODES)[number];

export const CONNECTION_KINDS = ["electrical", "mechanical"] as const;
export type ConnectionKind = (typeof CONNECTION_KINDS)[number];

// §3.1 enumerations
export const PROJECT_FAMILIES = ["rover", "rc_car", "drone", "robot_arm", "iot", "unknown"] as const;
export type ProjectFamily = (typeof PROJECT_FAMILIES)[number];

export const SUPPORT_STATUSES = ["supported", "limited", "planned", "unsupported"] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

export const REQUESTED_BEHAVIORS = ["manual_drive", "obstacle_avoidance", "line_following", "none", "unknown"] as const;
export type RequestedBehavior = (typeof REQUESTED_BEHAVIORS)[number];

export const INPUT_KINDS = ["image", "text", "image_and_text"] as const;
export type InputKind = (typeof INPUT_KINDS)[number];

// §3.5 job enumerations
export const JOB_STATUSES = ["queued", "running", "complete", "failed"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_STAGES = [
  "upload",
  "understand",
  "catalog_selection",
  "assembly",
  "validate",
  "repair",
  "render_ready",
  "firmware",
  "complete",
  "failed",
] as const;
export type JobStage = (typeof JOB_STAGES)[number];

export const STAGE_ACTORS = ["vision", "planner", "engineer", "validator", "repair", "firmware", "system"] as const;
export type StageActor = (typeof STAGE_ACTORS)[number];

export const STAGE_EVENT_STATUSES = ["running", "ok", "warning", "failed"] as const;
export type StageEventStatus = (typeof STAGE_EVENT_STATUSES)[number];

// ---------------------------------------------------------------------------
// §3.1 IntentSpec
// ---------------------------------------------------------------------------

export interface IntentInput {
  kind: InputKind;
  image_asset_id: string | null;
  user_text: string;
  image_interpretation_is_approximate?: boolean;
}

export interface IntentRequirements {
  /** `null` means no hard budget, not zero. */
  max_budget: DecimalString | number | null;
  currency: string;
  max_length_mm: number | null;
  max_width_mm: number | null;
  preferred_controller_catalog_id: string | null;
  required_capabilities: string[];
  preferred_color: string | null;
}

export type IntentConfidence = OpenString<"low" | "medium" | "high">;

export interface IntentSpec {
  schema_version: SchemaVersion;
  intent_id: string;
  input: IntentInput;
  project_family: ProjectFamily;
  requested_behavior: RequestedBehavior;
  visual_features: string[];
  requirements: IntentRequirements;
  assumptions: string[];
  unknowns: string[];
  confidence: IntentConfidence;
  support_status: SupportStatus;
}

// ---------------------------------------------------------------------------
// §3.2 CatalogComponent
// ---------------------------------------------------------------------------

export interface CatalogIdentity {
  manufacturer: string;
  model: string;
  sku: string | null;
  category: string;
}

export interface CatalogPhysical {
  dimensions_mm: { x: number; y: number; z: number };
  mass_g: number | null;
  bounds_verified: boolean;
  geometry_kind: OpenString<"procedural" | "asset">;
  asset_path: string | null;
  material_preset: string;
}

export interface CatalogMount {
  mount_id: string;
  kind: string;
  position_mm: Vec3;
  rotation_deg: Vec3;
  allowed_mates: string[];
}

export interface CatalogPort {
  port_id: string;
  signal: string;
  voltage_min_v: number | null;
  voltage_max_v: number | null;
  current_limit_a: number | null;
  logic_level_v: number | null;
  notes: string | null;
}

export interface CatalogSourcing {
  manufacturer_reference_url: string | null;
  datasheet_url: string | null;
  purchase_url: string | null;
  purchase_url_verified_at: IsoTimestamp | null;
  price_amount: DecimalString | null;
  price_currency: string | null;
  price_checked_at: IsoTimestamp | null;
  availability_status: OpenString<"unknown" | "in_stock" | "out_of_stock">;
}

export type EvidenceLevel = OpenString<"verified" | "unverified" | "synthetic_approximation" | "unknown">;

export interface CatalogEvidence {
  dimensions: EvidenceLevel;
  electrical: EvidenceLevel;
  price: EvidenceLevel;
  notes: string[];
}

export interface CatalogComponent {
  schema_version: SchemaVersion;
  catalog_id: string;
  identity: CatalogIdentity;
  physical: CatalogPhysical;
  mounts: CatalogMount[];
  ports: CatalogPort[];
  sourcing: CatalogSourcing;
  evidence: CatalogEvidence;
}

/** `GET /api/catalog` response envelope. */
export interface CatalogResponse {
  schema_version: SchemaVersion;
  components: CatalogComponent[];
}

// ---------------------------------------------------------------------------
// §3.3 BuildPlan
// ---------------------------------------------------------------------------

export interface Pose {
  position_mm: Vec3;
  rotation_deg: Vec3;
}

export interface RenderOverrides {
  color?: string;
  [key: string]: unknown;
}

export interface PlanComponent {
  instance_id: string;
  catalog_id: string;
  role: string;
  parent_instance_id: string | null;
  attached_to_mount_id: string | null;
  own_mount_id: string | null;
  pose: Pose;
  render_overrides: RenderOverrides;
}

export interface ConnectionEndpoint {
  instance_id: string;
  /** Required for electrical connections. */
  port_id?: string | null;
  /** Optional for mechanical connections. */
  mount_id?: string | null;
}

export interface Connection {
  connection_id: string;
  kind: ConnectionKind;
  from: ConnectionEndpoint;
  to: ConnectionEndpoint;
  net_name?: string | null;
  notes?: string | null;
}

export interface VerificationFinding {
  rule_id: string;
  result: FindingResult;
  severity: FindingSeverity;
  affected_instance_ids: string[];
  message: string;
  evidence_urls: string[];
}

export interface Verification {
  overall: BuildStatus;
  findings: VerificationFinding[];
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
  unit_price_amount: DecimalString | null;
  purchase_url: string | null;
  link_status: LinkStatus;
}

export interface Bom {
  currency: string;
  known_subtotal_amount: DecimalString | null;
  total_status: BomTotalStatus;
  items: BomItem[];
}

export interface RoverObstacleAvoidanceParameters {
  obstacle_stop_distance_m: number;
  turn_duration_ms: number;
  forward_speed_fraction: number;
}

export type BehaviorParameters = Partial<RoverObstacleAvoidanceParameters> & {
  [key: string]: number | string | boolean | null | undefined;
};

/** §3.6 BehaviorSpec. */
export interface BehaviorSpec {
  profile_id: string;
  controller_catalog_id: string;
  parameters: BehaviorParameters;
}

export const ROVER_OBSTACLE_PROFILE_ID = "rover.obstacle_avoidance.v1" as const;

export interface SimulationSpec {
  kind: SimulationKind;
  enabled: boolean;
  wheel_radius_m: number | null;
  wheel_base_m: number | null;
  max_wheel_speed_mps: number | null;
  sensor_range_m: number | null;
  sensor_fov_deg: number | null;
  limitations: string[];
}

export interface FirmwareSpec {
  target: string;
  profile_id: string | null;
  pin_map: Record<string, unknown>;
  compile_status: CompileStatus;
}

export interface Provenance {
  input_mode: InputKind;
  catalog_version: string;
  generation_mode: GenerationMode;
  notes: string[];
}

export interface BuildPlan {
  schema_version: SchemaVersion;
  build_id: string;
  revision: number;
  project_family: ProjectFamily;
  title: string;
  source_intent_id: string | null;
  created_at: IsoTimestamp;
  status: BuildStatus;
  components: PlanComponent[];
  connections: Connection[];
  verification: Verification;
  assembly_steps: AssemblyStep[];
  bom: Bom;
  behavior: BehaviorSpec | null;
  simulation: SimulationSpec;
  firmware: FirmwareSpec;
  provenance: Provenance;
}

// ---------------------------------------------------------------------------
// §3.5 API requests / responses
// ---------------------------------------------------------------------------

export interface HealthResponse {
  ok: boolean;
  mode: "fixture" | "live";
}

export interface GenerateRequest {
  input: {
    kind: InputKind;
    image_asset_id: string | null;
    user_text: string | null;
  };
  requirements?: Partial<IntentRequirements>;
}

export interface UploadedImageAsset {
  asset_id: string;
  mime_type: string;
  size_bytes: number;
  preview_url: string;
}

export interface SavedExampleSummary {
  example_id: string;
  title: string;
  project_family?: ProjectFamily | string | null;
  status?: BuildStatus | string | null;
  generation_mode?: GenerationMode | string | null;
}

export interface SavedExamplesResponse {
  examples: SavedExampleSummary[];
}

export interface RevisionSummary {
  revision: number;
  created_at?: IsoTimestamp | null;
  status?: BuildStatus | null;
  title?: string | null;
  label?: string | null;
}

export interface RevisionsResponse {
  build_id: string;
  revisions: RevisionSummary[];
}

export type EstelleStatusValue = "ok" | "ungrounded" | "unavailable";

export interface EstelleCitation {
  path: string;
  line: number;
  symbol_in_file: boolean;
}

export interface EstelleStatusResponse {
  status: EstelleStatusValue;
  enabled: boolean;
  mode: string;
  cli_found: boolean;
  repo_valid: boolean;
  reason: string;
}

export interface EstelleGroundRequest {
  kind: "locate" | "dependencies";
  name: string;
}

export interface EstelleGroundResponse {
  status: EstelleStatusValue;
  tool: string | null;
  question: string;
  timestamp: string;
  exit_code: number | null;
  citations: EstelleCitation[];
  raw_output_tail: string;
  reason: string;
  evidence_file: string | null;
}

export interface GenerateResponse {
  job_id: string;
  status: JobStatus;
  build_id: string | null;
}

/** Structured operation for an edit; exact shape is owned by the API lane. */
export type EditOperation = Record<string, unknown>;

export interface EditRequest {
  base_revision: number;
  instruction: string;
  operation?: EditOperation;
}

export interface EditResponse {
  accepted: boolean;
  build_id: string;
  revision?: number | null;
  finding?: VerificationFinding | null;
  job_id?: string | null;
}

/** HTTP error envelope body (`{ "error": ApiErrorBody }`). */
export interface ApiErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown> | null;
  retryable?: boolean;
}

export interface ApiErrorEnvelope {
  error: ApiErrorBody;
}

export interface JobResponse {
  job_id: string;
  status: JobStatus;
  stage: JobStage | null;
  /** Only ever reported by the server; clients must not invent percentages. */
  progress: number | null;
  error?: ApiErrorBody | string | null;
  build_id?: string | null;
  revision?: number | null;
}

export interface StageEvent {
  event_id: number;
  job_id: string;
  stage: JobStage;
  actor: StageActor;
  status: StageEventStatus;
  message: string;
  timestamp: IsoTimestamp;
  references: unknown[];
}
