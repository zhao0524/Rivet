import catalogJson from "../fixtures/synthetic-seed-components.json";
import planJson from "../fixtures/synthetic-rover-obstacle-v1.json";
import intentJson from "../fixtures/synthetic-intent-rover-obstacle-v1.json";

/** Fresh mutable deep copies of the raw fixture JSON for per-test corruption. */
export const rawPlan = (): any => structuredClone(planJson);
export const rawCatalog = (): any[] => structuredClone(catalogJson) as any[];
export const rawIntent = (): any => structuredClone(intentJson);
