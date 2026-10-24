import type {
  SelectableBomItem,
  SelectablePlan,
  SelectablePlanComponent,
} from "./types";

/** Read-only lookup of plan components by `instance_id`. Never mutates the plan. */
export function indexPlanComponents(
  plan: SelectablePlan | null | undefined,
): ReadonlyMap<string, SelectablePlanComponent> {
  const index = new Map<string, SelectablePlanComponent>();
  if (!plan) return index;
  for (const component of plan.components) {
    if (!index.has(component.instance_id)) index.set(component.instance_id, component);
  }
  return index;
}

/** BOM row that references `instanceId`, so a BOM panel can highlight the selected part. */
export function findBomItemForInstance(
  plan: SelectablePlan | null | undefined,
  instanceId: string | null | undefined,
): SelectableBomItem | null {
  if (!plan?.bom || !instanceId) return null;
  return plan.bom.items.find((item) => item.instance_ids.includes(instanceId)) ?? null;
}

/** All instance IDs of one catalog item, in plan order (e.g. both `demo.tt_motor` motors). */
export function instanceIdsForCatalogId(
  plan: SelectablePlan | null | undefined,
  catalogId: string,
): string[] {
  if (!plan) return [];
  return plan.components
    .filter((component) => component.catalog_id === catalogId)
    .map((component) => component.instance_id);
}

export const defaultPartLabel = (component: SelectablePlanComponent): string =>
  `${component.role.replace(/_/g, " ")} · ${component.instance_id}`;
