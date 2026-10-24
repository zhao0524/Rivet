import catalogJson from "../../../../../../fixtures/catalog/seed-components.json";
import planJson from "../../../../../../fixtures/plans/rover_obstacle_v1.json";
import intentJson from "../../../../../../fixtures/intent/rover_obstacle_v1.json";

/** Fresh mutable deep copies of the raw fixture JSON for per-test corruption. */
export const rawPlan = (): any => structuredClone(planJson);
export const rawCatalog = (): any[] => structuredClone(catalogJson) as any[];
export const rawIntent = (): any => structuredClone(intentJson);
