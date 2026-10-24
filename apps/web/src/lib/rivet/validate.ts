/**
 * Dependency-free runtime validation for the Rivet v1 wire contract.
 * Validators collect every issue with a precise path and fail closed.
 */
import { RivetContractError, RivetError, type ValidationIssue } from "./errors";
import {
  BOM_TOTAL_STATUSES,
  BUILD_STATUSES,
  COMPILE_STATUSES,
  CONNECTION_KINDS,
  FINDING_RESULTS,
  FINDING_SEVERITIES,
  GENERATION_MODES,
  INPUT_KINDS,
  JOB_STAGES,
  JOB_STATUSES,
  LINK_STATUSES,
  PROJECT_FAMILIES,
  REQUESTED_BEHAVIORS,
  ROVER_OBSTACLE_PROFILE_ID,
  SCHEMA_VERSION,
  SIMULATION_KINDS,
  STAGE_ACTORS,
  STAGE_EVENT_STATUSES,
  SUPPORT_STATUSES,
  type ApiErrorBody,
  type BuildPlan,
  type CatalogComponent,
  type CatalogResponse,
  type EditRequest,
  type EditResponse,
  type EstelleGroundResponse,
  type EstelleStatusResponse,
  type GenerateRequest,
  type GenerateResponse,
  type HealthResponse,
  type IntentSpec,
  type JobResponse,
  type RevisionsResponse,
  type SavedExamplesResponse,
  type StageEvent,
  type UploadedImageAsset,
  type VerificationFinding,
} from "./types";

export type { ValidationIssue };

export type Check<T> = (value: unknown, path: string, issues: ValidationIssue[]) => T;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; issues: ValidationIssue[] };

const describe = (v: unknown): string =>
  v === null ? "null" : Array.isArray(v) ? "array" : typeof v === "string" ? `"${v.slice(0, 40)}"` : typeof v;

const fail = (issues: ValidationIssue[], path: string, message: string) => {
  issues.push({ path, message });
};

// ---------------------------------------------------------------------------
// Primitive combinators
// ---------------------------------------------------------------------------

export const str: Check<string> = (v, p, issues) => {
  if (typeof v !== "string") fail(issues, p, `expected string, got ${describe(v)}`);
  return v as string;
};

export const nonEmptyStr: Check<string> = (v, p, issues) => {
  if (typeof v !== "string" || v.trim() === "") fail(issues, p, `expected non-empty string, got ${describe(v)}`);
  return v as string;
};

export const num: Check<number> = (v, p, issues) => {
  if (typeof v !== "number" || !Number.isFinite(v)) fail(issues, p, `expected finite number, got ${describe(v)}`);
  return v as number;
};

export const int: Check<number> = (v, p, issues) => {
  if (typeof v !== "number" || !Number.isInteger(v)) fail(issues, p, `expected integer, got ${describe(v)}`);
  return v as number;
};

export const positiveInt: Check<number> = (v, p, issues) => {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) fail(issues, p, `expected integer >= 1, got ${describe(v)}`);
  return v as number;
};

export const bool: Check<boolean> = (v, p, issues) => {
  if (typeof v !== "boolean") fail(issues, p, `expected boolean, got ${describe(v)}`);
  return v as boolean;
};

const DECIMAL_RE = /^-?\d+(\.\d+)?$/;
export const decimalString: Check<string> = (v, p, issues) => {
  if (typeof v !== "string" || !DECIMAL_RE.test(v)) fail(issues, p, `expected decimal string like "12.50", got ${describe(v)}`);
  return v as string;
};

const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]00:00)$/;
export const isoUtc: Check<string> = (v, p, issues) => {
  if (typeof v !== "string" || !ISO_UTC_RE.test(v) || Number.isNaN(Date.parse(v)))
    fail(issues, p, `expected ISO-8601 UTC timestamp, got ${describe(v)}`);
  return v as string;
};

const ISO_DATE_OR_UTC_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]00:00))?$/;
export const isoDateOrUtc: Check<string> = (v, p, issues) => {
  if (typeof v !== "string" || !ISO_DATE_OR_UTC_RE.test(v) || Number.isNaN(Date.parse(v)))
    fail(issues, p, `expected ISO-8601 date or UTC timestamp, got ${describe(v)}`);
  return v as string;
};

export const literal =
  <T extends string>(expected: T): Check<T> =>
  (v, p, issues) => {
    if (v !== expected) fail(issues, p, `expected "${expected}", got ${describe(v)}`);
    return v as T;
  };

export const oneOf =
  <T extends string>(allowed: readonly T[]): Check<T> =>
  (v, p, issues) => {
    if (typeof v !== "string" || !(allowed as readonly string[]).includes(v))
      fail(issues, p, `expected one of ${allowed.join("|")}, got ${describe(v)}`);
    return v as T;
  };

export const nullable =
  <T>(check: Check<T>): Check<T | null> =>
  (v, p, issues) =>
    v === null ? null : check(v, p, issues);

/** Accepts a missing key (undefined); otherwise applies `check`. */
export const optional =
  <T>(check: Check<T>): Check<T | undefined> =>
  (v, p, issues) =>
    v === undefined ? undefined : check(v, p, issues);

export const union =
  <A, B>(a: Check<A>, b: Check<B>, label: string): Check<A | B> =>
  (v, p, issues) => {
    const first: ValidationIssue[] = [];
    a(v, p, first);
    if (first.length === 0) return v as A;
    const second: ValidationIssue[] = [];
    b(v, p, second);
    if (second.length === 0) return v as B;
    fail(issues, p, `expected ${label}, got ${describe(v)}`);
    return v as A;
  };

export const arrayOf =
  <T>(item: Check<T>): Check<T[]> =>
  (v, p, issues) => {
    if (!Array.isArray(v)) {
      fail(issues, p, `expected array, got ${describe(v)}`);
      return v as T[];
    }
    v.forEach((el, i) => item(el, `${p}[${i}]`, issues));
    return v as T[];
  };

export const vec3: Check<[number, number, number]> = (v, p, issues) => {
  if (!Array.isArray(v) || v.length !== 3) {
    fail(issues, p, `expected [x, y, z] number triple, got ${describe(v)}`);
    return v as [number, number, number];
  }
  v.forEach((el, i) => num(el, `${p}[${i}]`, issues));
  return v as [number, number, number];
};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export const plainObject: Check<Record<string, unknown>> = (v, p, issues) => {
  if (!isPlainObject(v)) fail(issues, p, `expected object, got ${describe(v)}`);
  return v as Record<string, unknown>;
};

type Shape<T> = { [K in keyof T]-?: Check<T[K]> };

/** Validates listed keys; unknown extra keys are tolerated for forward compatibility. */
export const object =
  <T>(shape: Shape<T>): Check<T> =>
  (v, p, issues) => {
    if (!isPlainObject(v)) {
      fail(issues, p, `expected object, got ${describe(v)}`);
      return v as T;
    }
    for (const key of Object.keys(shape) as (keyof T & string)[]) {
      const check = shape[key] as Check<unknown>;
      check(v[key], `${p}.${key}`, issues);
    }
    return v as T;
  };

export const recordOf =
  <T>(value: Check<T>): Check<Record<string, T>> =>
  (v, p, issues) => {
    if (!isPlainObject(v)) {
      fail(issues, p, `expected object, got ${describe(v)}`);
      return v as Record<string, T>;
    }
    for (const [k, el] of Object.entries(v)) value(el, `${p}.${k}`, issues);
    return v as Record<string, T>;
  };

const unknownValue: Check<unknown> = (v) => v;
const strArray = arrayOf(str);
const schemaVersion = literal(SCHEMA_VERSION);

// ---------------------------------------------------------------------------
// Contract validators
// ---------------------------------------------------------------------------

export const intentSpecCheck: Check<IntentSpec> = object<IntentSpec>({
  schema_version: schemaVersion,
  intent_id: nonEmptyStr,
  input: object({
    kind: oneOf(INPUT_KINDS),
    image_asset_id: nullable(str),
    user_text: str,
    image_interpretation_is_approximate: optional(bool),
  }),
  project_family: oneOf(PROJECT_FAMILIES),
  requested_behavior: oneOf(REQUESTED_BEHAVIORS),
  visual_features: strArray,
  requirements: object({
    max_budget: nullable(union(decimalString, num, "decimal string or number")),
    currency: str,
    max_length_mm: nullable(num),
    max_width_mm: nullable(num),
    preferred_controller_catalog_id: nullable(str),
    required_capabilities: strArray,
    preferred_color: nullable(str),
  }),
  assumptions: strArray,
  unknowns: strArray,
  confidence: str,
  support_status: oneOf(SUPPORT_STATUSES),
});

export const catalogComponentCheck: Check<CatalogComponent> = object<CatalogComponent>({
  schema_version: schemaVersion,
  catalog_id: nonEmptyStr,
  identity: object({ manufacturer: str, model: str, sku: nullable(str), category: nonEmptyStr }),
  physical: object({
    dimensions_mm: object({ x: num, y: num, z: num }),
    mass_g: nullable(num),
    bounds_verified: bool,
    geometry_kind: nonEmptyStr,
    asset_path: nullable(str),
    material_preset: str,
  }),
  mounts: arrayOf(
    object({ mount_id: nonEmptyStr, kind: str, position_mm: vec3, rotation_deg: vec3, allowed_mates: strArray }),
  ),
  ports: arrayOf(
    object({
      port_id: nonEmptyStr,
      signal: str,
      voltage_min_v: nullable(num),
      voltage_max_v: nullable(num),
      current_limit_a: nullable(num),
      logic_level_v: nullable(num),
      notes: nullable(str),
    }),
  ),
  sourcing: object({
    manufacturer_reference_url: nullable(str),
    datasheet_url: nullable(str),
    purchase_url: nullable(str),
    purchase_url_verified_at: nullable(isoDateOrUtc),
    price_amount: nullable(decimalString),
    price_currency: nullable(str),
    price_checked_at: nullable(isoDateOrUtc),
    availability_status: str,
  }),
  evidence: object({ dimensions: str, electrical: str, price: str, notes: strArray }),
});

export const catalogResponseCheck: Check<CatalogResponse> = object<CatalogResponse>({
  schema_version: schemaVersion,
  components: arrayOf(catalogComponentCheck),
});

export const verificationFindingCheck: Check<VerificationFinding> = object<VerificationFinding>({
  rule_id: nonEmptyStr,
  result: oneOf(FINDING_RESULTS),
  severity: oneOf(FINDING_SEVERITIES),
  affected_instance_ids: strArray,
  message: str,
  evidence_urls: strArray,
});

const endpointCheck = object({ instance_id: nonEmptyStr, port_id: optional(nullable(str)), mount_id: optional(nullable(str)) });

const behaviorParamValue: Check<number | string | boolean | null> = (v, p, issues) => {
  if (v !== null && !["number", "string", "boolean"].includes(typeof v))
    fail(issues, p, `expected number, string, boolean or null, got ${describe(v)}`);
  return v as number | string | boolean | null;
};

const behaviorCheck: Check<BuildPlan["behavior"]> = (v, p, issues) => {
  if (v === null) return null;
  const b = object<NonNullable<BuildPlan["behavior"]>>({
    profile_id: nonEmptyStr,
    controller_catalog_id: nonEmptyStr,
    parameters: recordOf(behaviorParamValue),
  })(v, p, issues);
  if (isPlainObject(b) && b.profile_id === ROVER_OBSTACLE_PROFILE_ID && isPlainObject(b.parameters)) {
    for (const key of ["obstacle_stop_distance_m", "turn_duration_ms", "forward_speed_fraction"]) {
      num(b.parameters[key], `${p}.parameters.${key}`, issues);
    }
  }
  return b;
};

const simulationCheck: Check<BuildPlan["simulation"]> = (v, p, issues) => {
  const s = object<BuildPlan["simulation"]>({
    kind: oneOf(SIMULATION_KINDS),
    enabled: bool,
    wheel_radius_m: nullable(num),
    wheel_base_m: nullable(num),
    max_wheel_speed_mps: nullable(num),
    sensor_range_m: nullable(num),
    sensor_fov_deg: nullable(num),
    limitations: strArray,
  })(v, p, issues);
  if (isPlainObject(s) && s.kind === "differential_drive_2d" && s.enabled === true) {
    for (const key of ["wheel_radius_m", "wheel_base_m", "max_wheel_speed_mps", "sensor_range_m", "sensor_fov_deg"] as const) {
      const val = s[key];
      if (typeof val !== "number" || !(val > 0)) fail(issues, `${p}.${key}`, `enabled differential_drive_2d simulation requires a positive number, got ${describe(val)}`);
    }
  }
  return s;
};

export const buildPlanCheck: Check<BuildPlan> = object<BuildPlan>({
  schema_version: schemaVersion,
  build_id: nonEmptyStr,
  revision: positiveInt,
  project_family: oneOf(PROJECT_FAMILIES),
  title: str,
  source_intent_id: nullable(str),
  created_at: isoUtc,
  status: oneOf(BUILD_STATUSES),
  components: arrayOf(
    object({
      instance_id: nonEmptyStr,
      catalog_id: nonEmptyStr,
      role: nonEmptyStr,
      parent_instance_id: nullable(str),
      attached_to_mount_id: nullable(str),
      own_mount_id: nullable(str),
      pose: object({ position_mm: vec3, rotation_deg: vec3 }),
      render_overrides: plainObject as Check<BuildPlan["components"][number]["render_overrides"]>,
    }),
  ),
  connections: arrayOf(
    object({
      connection_id: nonEmptyStr,
      kind: oneOf(CONNECTION_KINDS),
      from: endpointCheck,
      to: endpointCheck,
      net_name: optional(nullable(str)),
      notes: optional(nullable(str)),
    }),
  ),
  verification: object({ overall: oneOf(BUILD_STATUSES), findings: arrayOf(verificationFindingCheck) }),
  assembly_steps: arrayOf(
    object({ step: positiveInt, title: str, instance_ids: strArray, instructions: str, safety_notes: strArray }),
  ),
  bom: object({
    currency: nonEmptyStr,
    known_subtotal_amount: nullable(decimalString),
    total_status: oneOf(BOM_TOTAL_STATUSES),
    items: arrayOf(
      object({
        catalog_id: nonEmptyStr,
        quantity: positiveInt,
        instance_ids: strArray,
        unit_price_amount: nullable(decimalString),
        purchase_url: nullable(str),
        link_status: oneOf(LINK_STATUSES),
      }),
    ),
  }),
  behavior: behaviorCheck,
  simulation: simulationCheck,
  firmware: object({
    target: str,
    profile_id: nullable(str),
    pin_map: recordOf(unknownValue),
    compile_status: oneOf(COMPILE_STATUSES),
  }),
  provenance: object({
    input_mode: oneOf(INPUT_KINDS),
    catalog_version: nonEmptyStr,
    generation_mode: oneOf(GENERATION_MODES),
    notes: strArray,
  }),
});

export const apiErrorBodyCheck: Check<ApiErrorBody> = object<ApiErrorBody>({
  code: nonEmptyStr,
  message: str,
  details: optional(nullable(plainObject)),
  retryable: optional(bool),
});

export const healthResponseCheck: Check<HealthResponse> = object<HealthResponse>({
  ok: bool,
  mode: oneOf(["fixture", "live"] as const),
});

export const generateRequestCheck: Check<GenerateRequest> = (v, p, issues) => {
  const req = object<GenerateRequest>({
    input: object({ kind: oneOf(INPUT_KINDS), image_asset_id: nullable(nonEmptyStr), user_text: nullable(str) }),
    requirements: optional(plainObject) as Check<GenerateRequest["requirements"]>,
  })(v, p, issues);
  const input = isPlainObject(req) && isPlainObject(req.input) ? req.input : null;
  if (input) {
    if ((input.kind === "image" || input.kind === "image_and_text") && input.image_asset_id === null)
      fail(issues, `${p}.input.image_asset_id`, `input.kind "${input.kind}" requires an uploaded image_asset_id`);
    if (
      (input.kind === "text" || input.kind === "image_and_text") &&
      (input.user_text === null || (typeof input.user_text === "string" && input.user_text.trim() === ""))
    )
      fail(issues, `${p}.input.user_text`, `input.kind "${input.kind}" requires non-empty user_text`);
  }
  return req;
};

export const uploadedImageAssetCheck: Check<UploadedImageAsset> = object<UploadedImageAsset>({
  asset_id: nonEmptyStr,
  mime_type: nonEmptyStr,
  size_bytes: int,
  preview_url: str,
});

export const savedExamplesResponseCheck: Check<SavedExamplesResponse> = object<SavedExamplesResponse>({
  examples: arrayOf(
    object({
      example_id: nonEmptyStr,
      title: str,
      project_family: optional(nullable(str)),
      status: optional(nullable(str)),
      generation_mode: optional(nullable(str)),
    }),
  ),
});

export const revisionsResponseCheck: Check<RevisionsResponse> = object<RevisionsResponse>({
  build_id: nonEmptyStr,
  revisions: arrayOf(
    object({
      revision: positiveInt,
      created_at: optional(nullable(str)),
      status: optional(nullable(oneOf(BUILD_STATUSES))),
      title: optional(nullable(str)),
      label: optional(nullable(str)),
    }),
  ),
});

const ESTELLE_STATUS_VALUES = ["ok", "ungrounded", "unavailable"] as const;

export const estelleStatusResponseCheck: Check<EstelleStatusResponse> = object<EstelleStatusResponse>({
  status: oneOf(ESTELLE_STATUS_VALUES),
  enabled: bool,
  mode: str,
  cli_found: bool,
  repo_valid: bool,
  reason: str,
});

export const estelleGroundResponseCheck: Check<EstelleGroundResponse> = object<EstelleGroundResponse>({
  status: oneOf(ESTELLE_STATUS_VALUES),
  tool: nullable(str),
  question: str,
  timestamp: str,
  exit_code: nullable(int),
  citations: arrayOf(
    object({
      path: str,
      line: int,
      symbol_in_file: bool,
    }),
  ),
  raw_output_tail: str,
  reason: str,
  evidence_file: nullable(str),
});

export const generateResponseCheck: Check<GenerateResponse> = object<GenerateResponse>({
  job_id: nonEmptyStr,
  status: oneOf(JOB_STATUSES),
  build_id: nullable(str),
});

export const editRequestCheck: Check<EditRequest> = object<EditRequest>({
  base_revision: positiveInt,
  instruction: nonEmptyStr,
  operation: optional(plainObject),
});

export const editResponseCheck: Check<EditResponse> = object<EditResponse>({
  accepted: bool,
  build_id: nonEmptyStr,
  revision: optional(nullable(positiveInt)),
  finding: optional(nullable(verificationFindingCheck)),
  job_id: optional(nullable(str)),
});

export const jobResponseCheck: Check<JobResponse> = object<JobResponse>({
  job_id: nonEmptyStr,
  status: oneOf(JOB_STATUSES),
  stage: nullable(oneOf(JOB_STAGES)),
  progress: (v, p, issues) => {
    if (v === undefined || v === null) return null;
    num(v, p, issues);
    return v as number;
  },
  error: optional(nullable(union(apiErrorBodyCheck, str, "error object or string"))),
  build_id: optional(nullable(str)),
  revision: optional(nullable(positiveInt)),
});

export const stageEventCheck: Check<StageEvent> = object<StageEvent>({
  event_id: int,
  job_id: nonEmptyStr,
  stage: oneOf(JOB_STAGES),
  actor: oneOf(STAGE_ACTORS),
  status: oneOf(STAGE_EVENT_STATUSES),
  message: str,
  timestamp: isoUtc,
  references: arrayOf(unknownValue),
});

// ---------------------------------------------------------------------------
// Parse entry points
// ---------------------------------------------------------------------------

export function safeParse<T>(check: Check<T>, value: unknown): ParseResult<T> {
  const issues: ValidationIssue[] = [];
  const out = check(value, "$", issues);
  return issues.length === 0 ? { ok: true, value: out } : { ok: false, issues };
}

/** Validates and throws `RivetContractError` listing every issue path. */
export function parseOrThrow<T>(check: Check<T>, value: unknown, what: string): T {
  const result = safeParse(check, value);
  if (!result.ok) throw new RivetContractError(what, result.issues);
  return result.value;
}

export const parseIntentSpec = (v: unknown) => parseOrThrow(intentSpecCheck, v, "IntentSpec");
export const parseCatalogComponent = (v: unknown) => parseOrThrow(catalogComponentCheck, v, "CatalogComponent");
export const parseCatalogComponents = (v: unknown) => parseOrThrow(arrayOf(catalogComponentCheck), v, "CatalogComponent[]");
export const parseCatalogResponse = (v: unknown) => parseOrThrow(catalogResponseCheck, v, "catalog response");
export const parseBuildPlan = (v: unknown) => parseOrThrow(buildPlanCheck, v, "BuildPlan");
export const parseGenerateRequest = (v: unknown) => parseOrThrow(generateRequestCheck, v, "GenerateRequest");
export const parseGenerateResponse = (v: unknown) => parseOrThrow(generateResponseCheck, v, "generate response");
export const parseEditRequest = (v: unknown) => parseOrThrow(editRequestCheck, v, "EditRequest");
export const parseEditResponse = (v: unknown) => parseOrThrow(editResponseCheck, v, "edit response");
export const parseJobResponse = (v: unknown) => parseOrThrow(jobResponseCheck, v, "job response");
export const parseStageEvent = (v: unknown) => parseOrThrow(stageEventCheck, v, "stage event");
export const parseHealthResponse = (v: unknown) => parseOrThrow(healthResponseCheck, v, "health response");

/** Extracts `{ error: {...} }` from an HTTP error body, or null if it doesn't match the contract. */
export function extractApiErrorBody(value: unknown): ApiErrorBody | null {
  if (!isPlainObject(value)) return null;
  const r = safeParse(apiErrorBodyCheck, value.error);
  return r.ok ? r.value : null;
}

/** Validates an outgoing request; throws a `bad_request` RivetError before any network/fixture call. */
export function assertValidRequest<T>(check: Check<T>, value: unknown, what: string): T {
  const result = safeParse(check, value);
  if (result.ok) return result.value;
  const contract = new RivetContractError(what, result.issues);
  throw new RivetError({
    kind: "bad_request",
    code: "INVALID_REQUEST",
    message: contract.message,
    hint: "Fix the listed request fields; nothing was sent.",
    issues: result.issues,
  });
}
