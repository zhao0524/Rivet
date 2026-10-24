import type { AssemblyStep, BuildPlan, CatalogComponent, PlanComponent } from '../../../lib/rivet/types';
import { catalogIndex } from '../../../lib/flow/derive';

export interface StepPart {
  instanceId: string;
  catalogId: string;
  name: string;
  category: string;
  role: string;
}

const CONTROLLER = /board|controller|mcu|esp32|arduino|pico/i;
const POWER = /power|battery|batteries|lipo|cell|charger/i;

/** Assembly steps in order (plans already store them sorted; this guards against gaps). */
export function orderedSteps(plan: BuildPlan): AssemblyStep[] {
  return [...plan.assembly_steps].sort((a, b) => a.step - b.step);
}

/** Parts in one step, resolved against the catalog. Unknown instances are skipped. */
export function stepParts(step: AssemblyStep, plan: BuildPlan, catalog: readonly CatalogComponent[]): StepPart[] {
  const byId = catalogIndex(catalog);
  const comps = new Map<string, PlanComponent>(plan.components.map((c) => [c.instance_id, c]));
  return step.instance_ids.flatMap((id) => {
    const c = comps.get(id);
    if (!c) return [];
    const cat = byId.get(c.catalog_id);
    return [
      {
        instanceId: id,
        catalogId: c.catalog_id,
        name: cat?.identity.model ?? c.catalog_id,
        category: cat?.identity.category ?? '',
        role: c.role,
      },
    ];
  });
}

export function isControllerPart(part: StepPart): boolean {
  return CONTROLLER.test(`${part.category} ${part.role} ${part.catalogId}`);
}

export function isPowerPart(part: StepPart): boolean {
  return POWER.test(`${part.category} ${part.role} ${part.catalogId}`);
}

/** 1-based number of the first step that mounts the controller board, or null. */
export function firmwareStep(plan: BuildPlan, catalog: readonly CatalogComponent[]): number | null {
  for (const step of orderedSteps(plan)) {
    if (stepParts(step, plan, catalog).some(isControllerPart)) return step.step;
  }
  return null;
}

/** Next is gated behind "I've read the safety note" when the step has notes or touches power parts. */
export function needsSafetyAck(step: AssemblyStep, parts: readonly StepPart[]): boolean {
  return step.safety_notes.length > 0 || parts.some(isPowerPart);
}

/** Clamp a saved 1-based step into range; 0 (not started) becomes step 1. */
export function clampStep(saved: number, count: number): number {
  if (count === 0) return 0;
  return Math.min(Math.max(saved || 1, 1), count);
}

/** Readable firmware target, e.g. `esp32_arduino_platformio` → "ESP32 Arduino PlatformIO". */
export function firmwareTargetLabel(target: string): string {
  return target
    .split(/[_-]+/)
    .map((w) => (/^esp\d*$/i.test(w) ? w.toUpperCase() : w === 'platformio' ? 'PlatformIO' : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}
