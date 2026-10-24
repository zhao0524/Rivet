import type { WiringCatalogComponent, WiringPlanInput } from '../types';
import catalogJson from './seed-components.json';
import planJson from './rover_obstacle_v1.json';

/**
 * Private copies of docs/implementation.md Appendix A.1 / A.2 (synthetic demo data),
 * per §3.7. Replace with imports from `fixtures/` once the shared files land.
 */
export function roverPlan(): WiringPlanInput {
  return structuredClone(planJson) as unknown as WiringPlanInput;
}

export function seedCatalog(): WiringCatalogComponent[] {
  return structuredClone(catalogJson) as unknown as WiringCatalogComponent[];
}
