/** Separately versioned design domain; never extends the frozen BuildPlan wire format. */
export type DesignMode = 'concept_only' | 'engineered';
export type BodyKind = 'purchased' | 'fabricated' | 'concept_visual';
export type V3 = [number, number, number];
export interface DesignPart {
  body_id: string;
  name?: string;
  kind?: BodyKind;
  parent_id?: string | null;
  asset_url?: string;
  bounds_mm?: { min: V3; max: V3 };
  transform_mm?: number[] | number[][];
  geometry_digest?: string;
  material?: unknown;
  mass_g?: number | null;
  provenance?: unknown;
  anchors?: unknown;
  [key: string]: unknown;
}
export interface VisualReview {
  scores: Record<string, number>;
  overall: number;
  summary: string;
  subjective: true;
  issues: Array<{ body_id: string | null; view: string; severity: string; observed: string; target: string; proposed_change: string }>;
  judge_model?: string;
  metrics?: Record<string, unknown>;
}
export interface DesignClaims {
  visual_similarity: { score: number | null; subjective: true };
  geometric_validity: 'valid' | 'invalid';
  manufacturability: string;
  electrical: string;
  firmware: 'supported' | 'not_supported';
  buildability: 'concept_only' | 'needs_review' | 'unsupported' | 'unbuildable';
}
export interface DesignReference { id: string; view: string; image_url: string; source: 'upload' | 'generated' | 'render'; camera?: unknown }
export interface DesignCandidate {
  id: string; strategy: string; status: 'complete' | 'failed';
  spec: Record<string, unknown> | null; scene_asset_url: string | null;
  part_manifest: DesignPart[]; geometry_digest: string | null;
  shots: Array<{ view: string; image_url: string; camera?: unknown }>;
  mechanical: Record<string, unknown>; functional: Record<string, unknown>;
  visual: VisualReview | null; feasible: boolean; error: unknown;
  claims?: DesignClaims; previews?: Array<{ index: number; url: string; is_partial: boolean; body_ids: string[] }>;
  manufacturing_assets?: Array<{ body_id: string | null; kind: string; url: string | null; unavailable?: string }>;
  iterations?: Array<Record<string, unknown>>; joints?: Array<Record<string, unknown>>;
}
export interface VisualQuality {
  target: number; achieved: boolean; score: number | null; critical_issues: number; refinement_rounds: number; judge: string; statement: string;
}
export interface DesignBundle {
  schema_version: '2.0'; build_id: string; revision: number; job_id: string;
  title: string; mode: DesignMode; status: 'complete' | 'needs_review' | 'unbuildable';
  original_request: { text: string; image_asset_id: string | null };
  // limitations and providers are listed under provenance
  distilled: { subject: string; summary: string; signature_features: string[]; mechanical_constraints?: string[]; uncertainties?: string[]; unsupported?: string[]; simplifications?: string[]; archetype?: string; source?: 'model' | 'rules' };
  references: DesignReference[]; candidates: DesignCandidate[]; selected_candidate_id: string | null;
  recommendation?: { candidate_id: string | null; rationale: string }; change?: Record<string, unknown>;
  exports?: Record<string, unknown>; generation_trace_url?: string | null;
  scene_asset_url: string | null; assembly: DesignPart[]; model_versions: Record<string, string>;
  /** Subjective visual verdict against the configured target; never part of buildability. */
  visual_quality?: VisualQuality;
  provenance: { generation_mode: 'live' | 'fixture'; cached: boolean; replay_of: string | null; limitations?: string[]; providers?: Record<string, string> };
  budget: { limit_usd: number; spent_usd: number; reserved_usd: number };
  parent_revision: number | null; created_at: string;
}
export interface GeometrySnapshot { scene_asset_url: string; part_manifest: DesignPart[]; geometry_digest: string; preview_revision: number; is_partial: boolean }
export interface DesignEvent {
  schema_version: '2.0'; event_id: number; job_id: string; timestamp: string;
  stage: string; actor: string; status: string; message: string;
  candidate_id: string | null; build_id: string | null; revision: number | null;
  references: Array<{ type: string; id: string; url: string }>;
  preview_revision: number | null; is_partial: boolean; snapshot?: GeometrySnapshot;
}
export interface DesignJob { job_id: string; build_id: string; status: string; stage?: string; revision?: number; error?: { message?: string; code?: string } | null }
export interface DesignRequest {
  input: { user_text: string; image_asset_id: string | null }; mode: DesignMode; quality: 'full';
  candidate_count: 3; review_rounds: number; allow_cached: boolean; generation_budget_usd: number;
  constraints: Record<string, unknown>;
}
export interface SavedDesign { build_id: string; revision: number; title: string; status: string; created_at: string }
