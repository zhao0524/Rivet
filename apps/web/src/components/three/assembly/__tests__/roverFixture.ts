import type { AssemblyPlan, DimensionsByCatalogId } from '../types';
import catalogJson from '../../../../../../../fixtures/catalog/seed-components.json';
import planJson from '../../../../../../../fixtures/plans/rover_obstacle_v1.json';

// Shared synthetic Appendix A fixtures (repo `fixtures/`). Not sourced hardware.
export const roverPlan = planJson as unknown as AssemblyPlan;

// Appendix A.1 `physical.dimensions_mm`.
export const roverDimensions: DimensionsByCatalogId = Object.fromEntries(
  catalogJson.map((item) => [item.catalog_id, item.physical.dimensions_mm]),
);
