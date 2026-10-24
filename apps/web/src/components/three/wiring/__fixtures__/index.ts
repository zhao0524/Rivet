import type { WiringCatalogComponent, WiringPlanInput } from '../types';
import catalogJson from '../../../../../../../fixtures/catalog/seed-components.json';
import planJson from '../../../../../../../fixtures/plans/rover_obstacle_v1.json';

/** Shared synthetic Appendix A fixtures (repo `fixtures/`), cloned per call. */
export function roverPlan(): WiringPlanInput {
  return structuredClone(planJson) as unknown as WiringPlanInput;
}

export function seedCatalog(): WiringCatalogComponent[] {
  return structuredClone(catalogJson) as unknown as WiringCatalogComponent[];
}
