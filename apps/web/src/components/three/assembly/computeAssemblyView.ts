import { createAssemblyModel, type AssemblyModel, type AssemblyModelOptions } from './model';
import type {
  AssemblyItemState,
  AssemblyItemView,
  AssemblyPlan,
  AssemblyPoseOverrides,
  AssemblyView,
  AssemblyViewOptions,
  AssemblyVisibility,
  Vec3,
} from './types';

export const DEFAULT_GHOST_OPACITY = 0.18;
export const DEFAULT_DIMMED_OPACITY = 0.55;

export const clamp01 = (v: number | undefined, fallback: number): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return n < 0 ? 0 : n > 1 ? 1 : n;
};

/** Smoothstep easing used for explode and seat-in transitions. */
export const easeAssembly = (t: number): number => {
  const x = clamp01(t, 0);
  return x * x * (3 - 2 * x);
};

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const toVec3 = (p: readonly number[] | undefined): Vec3 => {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return [n(p?.[0]), n(p?.[1]), n(p?.[2])];
};

// Plan → model cache. Plans are immutable revisions, so identity is a safe key.
const modelCache = new WeakMap<object, WeakMap<object, AssemblyModel>>();
const NO_DIMS = {};

export function getAssemblyModel(
  plan: AssemblyPlan,
  options: AssemblyModelOptions = {},
): AssemblyModel {
  if (options.gapFraction !== undefined) return createAssemblyModel(plan, options);
  const dimsKey = (options.dimensionsByCatalogId as object | undefined) ?? NO_DIMS;
  let byDims = modelCache.get(plan);
  if (!byDims) {
    byDims = new WeakMap();
    modelCache.set(plan, byDims);
  }
  let model = byDims.get(dimsKey);
  if (!model) {
    model = createAssemblyModel(plan, options);
    byDims.set(dimsKey, model);
  }
  return model;
}

export type ComputeAssemblyViewOptions = AssemblyViewOptions & AssemblyModelOptions;

/**
 * Pure view engine: returns presentation-only offsets and visibility per
 * `instance_id`. The plan is never mutated; identical inputs give identical output.
 */
export function computeAssemblyView(
  plan: AssemblyPlan,
  options: ComputeAssemblyViewOptions,
): AssemblyView {
  const model = getAssemblyModel(plan, options);
  const mode = options.mode;
  const stepCount = model.steps.length;
  const ghostOpacity = clamp01(options.ghostOpacity, DEFAULT_GHOST_OPACITY);
  const dimmedOpacity = clamp01(options.dimmedOpacity, DEFAULT_DIMMED_OPACITY);
  const ghostFuture = options.ghostFuture ?? true;
  const previous = options.previous ?? 'solid';

  let stepIndex = 0;
  let progress: number;
  if (mode === 'step') {
    const raw = Number(options.step);
    stepIndex = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 0), stepCount) : 0;
    progress = clamp01(options.progress, 1);
  } else if (mode === 'exploded') {
    progress = clamp01(options.progress, 1);
  } else {
    progress = 1;
  }
  const eased = easeAssembly(progress);
  const currentStep = mode === 'step' && stepIndex > 0 ? model.steps[stepIndex - 1] : null;
  const inCurrent = new Set(currentStep?.instance_ids ?? []);

  const items: AssemblyItemView[] = [];
  const byInstanceId: Record<string, AssemblyItemView> = {};

  for (const c of model.components) {
    const id = c.instance_id;
    const full = model.explodeOffsets[id];
    const first = model.firstStepIndex[id];
    let state: AssemblyItemState;
    let visibility: AssemblyVisibility = 'visible';
    let opacity = 1;
    let highlighted = false;
    let k = 0; // fraction of the full explode offset applied

    if (mode === 'assembled') {
      state = 'assembled';
    } else if (mode === 'exploded') {
      state = 'assembled';
      k = eased;
    } else if (first == null) {
      state = 'unscheduled';
    } else if (first === stepIndex) {
      state = 'added';
      highlighted = true;
      k = 1 - eased;
      opacity = lerp(ghostOpacity, 1, eased);
    } else if (first < stepIndex) {
      state = inCurrent.has(id) ? 'revisited' : 'installed';
      highlighted = state === 'revisited';
    } else {
      state = 'future';
    }

    if (c.render_overrides?.visible === false) {
      visibility = 'hidden';
      opacity = 0;
      highlighted = false;
    } else if (state === 'future' || state === 'unscheduled') {
      visibility = ghostFuture ? 'ghost' : 'hidden';
      opacity = ghostFuture ? ghostOpacity : 0;
    } else if (state === 'installed' && previous !== 'solid') {
      visibility = previous === 'hidden' ? 'hidden' : 'visible';
      opacity = previous === 'hidden' ? 0 : dimmedOpacity;
    }

    const offset: Vec3 = k === 0 ? [0, 0, 0] : [full[0] * k, full[1] * k, full[2] * k];
    const pos = toVec3(c.pose?.position_mm);
    const item: AssemblyItemView = {
      instance_id: id,
      role: c.role,
      state,
      visibility,
      opacity,
      highlighted,
      offset_mm: offset,
      display_position_mm: [pos[0] + offset[0], pos[1] + offset[1], pos[2] + offset[2]],
      rotation_deg: toVec3(c.pose?.rotation_deg),
      first_step: first == null ? null : model.steps[first - 1].step,
    };
    items.push(item);
    byInstanceId[id] = item;
  }

  return {
    mode,
    stepIndex,
    stepCount,
    progress,
    currentStep,
    steps: model.steps,
    items,
    byInstanceId,
    diagnostics: model.diagnostics,
  };
}

/** Narrow per-instance overrides for a separate renderer. */
export function toPoseOverrides(view: AssemblyView): AssemblyPoseOverrides {
  const out: Record<string, AssemblyPoseOverrides[string]> = {};
  for (const item of view.items) {
    out[item.instance_id] = {
      position_offset_mm: item.offset_mm,
      opacity: item.opacity,
      visible: item.visibility !== 'hidden',
      ghost: item.visibility === 'ghost',
      highlighted: item.highlighted,
    };
  }
  return out;
}
