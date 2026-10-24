/**
 * Which BOM lines the assembly steps reach. A plan's steps should name every part
 * at least once; older or hand-edited plans may not, and the UI must say so rather
 * than let a bought part silently drop out of the instructions.
 */

export interface CoverageComponent {
  readonly instance_id: string;
  readonly catalog_id: string;
  readonly render_overrides?: { readonly visible?: boolean | null; readonly [key: string]: unknown } | null;
}

export interface CoverageStep {
  readonly step: number;
  readonly title: string;
  readonly instance_ids: readonly string[];
  readonly instructions?: string;
}

export interface CoverageBomItem {
  readonly catalog_id: string;
  readonly quantity: number;
  readonly instance_ids: readonly string[];
}

export interface CoveragePlan {
  readonly components: readonly CoverageComponent[];
  readonly assembly_steps: readonly CoverageStep[];
  readonly bom: { readonly items: readonly CoverageBomItem[] };
}

export interface BomLineCoverage {
  readonly catalog_id: string;
  readonly instance_ids: readonly string[];
  /** BOM instances that no step references. Empty when the line is covered. */
  readonly missing_instance_ids: readonly string[];
  /** `step` numbers that reference at least one instance of the line, in order. */
  readonly steps: readonly number[];
  readonly covered: boolean;
}

export interface StepCoverage {
  readonly lines: readonly BomLineCoverage[];
  readonly uncovered: readonly BomLineCoverage[];
  readonly coveredCount: number;
  readonly total: number;
  /** True when every BOM line has every instance in at least one step. */
  readonly complete: boolean;
}

/** Loose kit items (wires, cells, adapters) carry `render_overrides.visible = false`: no 3D model. */
export function isUnmodeledKitItem(component: CoverageComponent | null | undefined): boolean {
  return component?.render_overrides?.visible === false;
}

export function computeStepCoverage(plan: CoveragePlan): StepCoverage {
  const stepsOf = new Map<string, number[]>();
  const ordered = [...plan.assembly_steps].sort((a, b) => a.step - b.step);
  for (const s of ordered) {
    for (const id of s.instance_ids) {
      const list = stepsOf.get(id) ?? [];
      if (!list.includes(s.step)) list.push(s.step);
      stepsOf.set(id, list);
    }
  }
  const lines = plan.bom.items.map((item): BomLineCoverage => {
    const missing = item.instance_ids.filter((id) => !stepsOf.has(id));
    const steps = [...new Set(item.instance_ids.flatMap((id) => stepsOf.get(id) ?? []))].sort((a, b) => a - b);
    return {
      catalog_id: item.catalog_id,
      instance_ids: item.instance_ids,
      missing_instance_ids: missing,
      steps,
      covered: item.instance_ids.length > 0 && missing.length === 0,
    };
  });
  const uncovered = lines.filter((l) => !l.covered);
  return {
    lines,
    uncovered,
    coveredCount: lines.length - uncovered.length,
    total: lines.length,
    complete: uncovered.length === 0,
  };
}

/**
 * The sentences of a step's instructions that name `instanceId` (the engine writes
 * e.g. "Use the jumper wires (accessory-2) for the others."). Null when no sentence
 * names it; the step's own instructions then apply as a whole.
 */
export function instructionFor(step: CoverageStep, instanceId: string): string | null {
  const text = step.instructions ?? '';
  if (!text) return null;
  // Split after ". " before a capital letter; dots inside "driver-1.vm" do not end a sentence.
  const parts = text.split(/([.!?])\s+(?=[A-Z])/);
  const sentences: string[] = [];
  for (let i = 0; i < parts.length; i += 2) sentences.push(parts[i] + (parts[i + 1] ?? ''));
  const pattern = new RegExp(`(^|[^A-Za-z0-9_-])${instanceId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z0-9_-]|$)`);
  const hits = sentences.filter((s) => pattern.test(s));
  return hits.length ? hits.join(' ') : null;
}
