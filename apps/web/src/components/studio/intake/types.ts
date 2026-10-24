// Local mirrors of the wire shapes in docs/implementation.md §3.5 (API contract
// and job events). Kept inside this folder so the intake UI does not depend on
// unmerged shared adapters; swap for `src/lib/contracts.ts` types once merged.

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

export type JobEventActor =
  | "vision"
  | "planner"
  | "engineer"
  | "validator"
  | "repair"
  | "firmware"
  | "system";

export type JobEventStatus = "running" | "ok" | "warning" | "failed";

export interface JobEvent {
  event_id: number;
  job_id: string;
  stage: JobStage;
  actor: JobEventActor;
  status: JobEventStatus;
  message: string;
  timestamp: string;
  references: unknown[];
}

export type JobLifecycleStatus = "queued" | "running" | "complete" | "failed";

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown> | null;
  retryable?: boolean;
}

/** `GET /api/jobs/{job_id}` response. */
export interface JobStatus {
  job_id: string;
  status: JobLifecycleStatus;
  stage?: JobStage | null;
  /** 0–1 fraction of planned stages finished, as computed by the backend. Never synthesized here. */
  progress?: number | null;
  error?: ApiErrorBody | null;
  build_id?: string | null;
  revision?: number | null;
}

/** `POST /api/assets/images` response. */
export interface UploadedImageAsset {
  asset_id: string;
  mime_type: string;
  size_bytes: number;
  preview_url: string;
}

export type GenerateInputKind = "image" | "text" | "image_and_text";

export interface GenerateRequirements {
  /** `null` means no hard budget, not zero. */
  max_budget: number | null;
  currency: string;
  /** Longest side in mm the user stated; omitted or null means no limit. */
  max_length_mm?: number | null;
}

/** `POST /api/projects/generate` request body. */
export interface GenerateRequest {
  intent_id?: string;
  interpretation_choice?: "as_interpreted" | "closest_supported_rover";
  input: {
    kind: GenerateInputKind;
    image_asset_id: string | null;
    user_text: string | null;
  };
  requirements: GenerateRequirements;
}

/** Entry of `GET /api/projects/examples` → `{ examples: SavedExampleSummary[] }`. */
export interface SavedExampleSummary {
  example_id: string;
  title: string;
  project_family?: string | null;
  status?: string | null;
  generation_mode?: string | null;
}

export interface UploadOptions {
  signal?: AbortSignal;
}
