/**
 * Minimal structural view of a `BuildPlan` (contracts §3.3) needed for part
 * interaction. Any full `BuildPlan` type is assignable to it, so this module
 * never depends on another module's renderer or data layer.
 */
export interface SelectablePlanComponent {
  readonly instance_id: string;
  readonly catalog_id: string;
  readonly role: string;
  readonly parent_instance_id?: string | null;
}

export interface SelectableBomItem {
  readonly catalog_id: string;
  readonly quantity: number;
  readonly instance_ids: readonly string[];
}

export interface SelectablePlan {
  readonly build_id: string;
  readonly revision: number;
  readonly components: readonly SelectablePlanComponent[];
  readonly bom?: { readonly items: readonly SelectableBomItem[] } | null;
}

/** Snapshot of the interaction state. Treat as immutable. */
export interface PartSelectionState {
  readonly build_id: string | null;
  readonly revision: number | null;
  readonly selected_instance_id: string | null;
  readonly hovered_instance_id: string | null;
  /** Instances hidden by the user. */
  readonly hidden_instance_ids: ReadonlySet<string>;
  /** When set, every other instance is isolated out (not shown or raycastable). */
  readonly isolated_instance_id: string | null;
}

export type SelectionChangeReason =
  | "pointer"
  | "api"
  | "background"
  | "keyboard"
  | "hidden"
  | "plan_change";

/** Payload consumed by BOM / inspector panels. */
export interface PartSelectionChangeEvent {
  readonly build_id: string | null;
  readonly revision: number | null;
  readonly instance_id: string | null;
  readonly previous_instance_id: string | null;
  /** The selected plan component, or `null` when the selection was cleared. */
  readonly component: SelectablePlanComponent | null;
  readonly reason: SelectionChangeReason;
}

export interface PartHoverChangeEvent {
  readonly build_id: string | null;
  readonly revision: number | null;
  readonly instance_id: string | null;
  readonly previous_instance_id: string | null;
  readonly component: SelectablePlanComponent | null;
  /** Human-readable label for a hover tooltip, `null` when nothing is hovered. */
  readonly label: string | null;
}

export interface PartVisibilityChangeEvent {
  readonly build_id: string | null;
  readonly revision: number | null;
  readonly hidden_instance_ids: readonly string[];
  readonly isolated_instance_id: string | null;
}

export interface PartSelectionCallbacks {
  onSelectionChange?: (event: PartSelectionChangeEvent) => void;
  onHoverChange?: (event: PartHoverChangeEvent) => void;
  onVisibilityChange?: (event: PartVisibilityChangeEvent) => void;
}

export type PartLabelResolver = (component: SelectablePlanComponent) => string;

/** Per-part flags used by renderers to pick highlight / outline styles. */
export interface PartVisualState {
  readonly instance_id: string;
  /** Instance exists in the current plan. */
  readonly known: boolean;
  readonly selected: boolean;
  readonly hovered: boolean;
  /** Explicitly hidden by the user. */
  readonly hidden: boolean;
  /** Another instance is isolated, so this one is out of focus. */
  readonly isolated_out: boolean;
  /** Should be drawn at all (`!hidden && !isolated_out`). */
  readonly visible: boolean;
  /** Can receive pointer events / raycasts. */
  readonly interactive: boolean;
}
