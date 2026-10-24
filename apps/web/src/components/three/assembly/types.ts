/**
 * Narrow structural views of the BuildPlan wire format (implementation.md §3.3).
 * Only the fields this module reads are declared, so the full BuildPlan type from
 * `src/lib/contracts.ts` (once merged) is assignable without importing it here.
 */

export type Vec3 = readonly [number, number, number];

export interface AssemblyPose {
  readonly position_mm: Vec3 | readonly number[];
  readonly rotation_deg: Vec3 | readonly number[];
}

export interface AssemblyComponent {
  readonly instance_id: string;
  readonly catalog_id: string;
  readonly role: string;
  readonly parent_instance_id: string | null;
  readonly pose: AssemblyPose;
  readonly render_overrides?: { readonly visible?: boolean | null; readonly [key: string]: unknown } | null;
}

export interface AssemblyStep {
  readonly step: number;
  readonly title: string;
  readonly instance_ids: readonly string[];
  readonly instructions?: string;
  readonly safety_notes?: readonly string[];
}

export interface AssemblyPlan {
  readonly build_id?: string;
  readonly revision?: number;
  readonly components: readonly AssemblyComponent[];
  readonly assembly_steps: readonly AssemblyStep[];
}

/** Catalog `physical.dimensions_mm`, keyed by `catalog_id` (optional input). */
export interface Dimensions {
  readonly x: number | null;
  readonly y: number | null;
  readonly z: number | null;
}
export type DimensionsByCatalogId = Readonly<Record<string, Dimensions | null | undefined>>;

export type AssemblyMode = 'assembled' | 'exploded' | 'step';

/** How components installed in earlier steps are presented in `step` mode. */
export type PreviousComponentsDisplay = 'solid' | 'dimmed' | 'hidden';

export interface AssemblyViewOptions {
  readonly mode: AssemblyMode;
  /**
   * `exploded`: explode amount in [0, 1].
   * `step`: transition into `step` in [0, 1]; 0 = parts still at their exploded
   * offset and ghosted, 1 = parts seated. Defaults to 1.
   */
  readonly progress?: number;
  /** `step` mode only: 0 = empty/prep, `stepCount` = final assembly. */
  readonly step?: number;
  readonly ghostFuture?: boolean;
  readonly previous?: PreviousComponentsDisplay;
  readonly ghostOpacity?: number;
  readonly dimmedOpacity?: number;
}

export type AssemblyItemState =
  /** Present in the canonical assembly (assembled / exploded modes). */
  | 'assembled'
  /** First added in an earlier step. */
  | 'installed'
  /** First added in the current step. */
  | 'added'
  /** Already installed, referenced again by the current step (e.g. "Inspect wiring"). */
  | 'revisited'
  /** First added in a later step. */
  | 'future'
  /** Not referenced by any assembly step. */
  | 'unscheduled';

export type AssemblyVisibility = 'visible' | 'ghost' | 'hidden';

export interface AssemblyItemView {
  readonly instance_id: string;
  readonly role: string;
  readonly state: AssemblyItemState;
  readonly visibility: AssemblyVisibility;
  readonly opacity: number;
  readonly highlighted: boolean;
  /** Presentation-only displacement; add to `pose.position_mm`. Never written back. */
  readonly offset_mm: Vec3;
  readonly display_position_mm: Vec3;
  /** Unchanged canonical rotation. */
  readonly rotation_deg: Vec3;
  /** Number of the first `assembly_steps[].step` that references this instance. */
  readonly first_step: number | null;
}

export interface AssemblyStepSummary {
  /** Timeline index: 1..stepCount (0 is the prep state). */
  readonly index: number;
  readonly step: number;
  readonly title: string;
  /** Resolved, de-duplicated instance IDs referenced by this step. */
  readonly instance_ids: readonly string[];
  /** Subset of `instance_ids` that appear for the first time in this step. */
  readonly added_instance_ids: readonly string[];
}

export interface AssemblyDiagnostics {
  /** Step references that do not resolve to a component in this plan. */
  readonly missing_instance_ids: readonly { readonly step: number; readonly instance_id: string }[];
  /** Components never referenced by any step. */
  readonly unscheduled_instance_ids: readonly string[];
  /** Repeated `components[].instance_id` (only the first occurrence is used). */
  readonly duplicate_component_ids: readonly string[];
  /** Non-null `parent_instance_id` that does not resolve (treated as a root). */
  readonly unresolved_parent_ids: readonly { readonly instance_id: string; readonly parent_instance_id: string }[];
}

export interface AssemblyView {
  readonly mode: AssemblyMode;
  readonly stepIndex: number;
  readonly stepCount: number;
  readonly progress: number;
  /** null in prep (step 0) and in non-step modes. */
  readonly currentStep: AssemblyStepSummary | null;
  readonly steps: readonly AssemblyStepSummary[];
  /** One entry per unique component, in plan order. */
  readonly items: readonly AssemblyItemView[];
  readonly byInstanceId: Readonly<Record<string, AssemblyItemView>>;
  readonly diagnostics: AssemblyDiagnostics;
}

/**
 * What a renderer needs per `instance_id`. A `PartNode` should apply
 * `position_offset_mm` on top of its canonical pose and keep its own geometry.
 */
export interface AssemblyPoseOverride {
  readonly position_offset_mm: Vec3;
  readonly opacity: number;
  readonly visible: boolean;
  readonly ghost: boolean;
  readonly highlighted: boolean;
}
export type AssemblyPoseOverrides = Readonly<Record<string, AssemblyPoseOverride>>;
