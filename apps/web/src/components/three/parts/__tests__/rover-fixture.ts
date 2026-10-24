/** Shared synthetic Appendix A fixtures (repo `fixtures/`, docs/implementation.md A.1/A.2). */
import type { PartCatalogItem, PartPlan } from '../types';
import catalogJson from '../../../../../../../fixtures/catalog/seed-components.json';
import planJson from '../../../../../../../fixtures/plans/rover_obstacle_v1.json';

export const roverCatalog = catalogJson as unknown as PartCatalogItem[];

export const roverPlan = planJson as unknown as PartPlan;
