import type { DimensionsByCatalogId } from '../components/three/assembly/types';
import type { BoundsMm, Vec3 } from '../components/three/stage/units';
import type { BuildPlan, CatalogComponent, PlanComponent } from './rivet/types';

export {
  boundsMmToScene,
  boundsSceneToMm,
  MM_PER_SCENE_UNIT,
  mmToScene,
  rotationDegToRad,
  SCENE_UNITS_PER_MM,
  sceneToMm,
  vec3MmToScene,
  vec3SceneToMm,
  type Bounds3,
  type BoundsMm,
  type Vec3,
} from '../components/three/stage/units';

const DEFAULT_HALF_MM: Vec3 = [15, 10, 15];

export function buildDimensionsByCatalogId(catalog: readonly CatalogComponent[]): DimensionsByCatalogId {
  const out: Record<string, { x: number | null; y: number | null; z: number | null }> = {};
  for (const item of catalog) {
    if (item.physical?.dimensions_mm) {
      out[item.catalog_id] = {
        x: item.physical.dimensions_mm.x ?? null,
        y: item.physical.dimensions_mm.y ?? null,
        z: item.physical.dimensions_mm.z ?? null,
      };
    }
  }
  return out;
}

function halfExtentsMm(component: PlanComponent, catalogById: ReadonlyMap<string, CatalogComponent>): Vec3 {
  const entry = catalogById.get(component.catalog_id);
  const d = entry?.physical?.dimensions_mm;
  const hx = d && Number.isFinite(d.x) && d.x > 0 ? d.x / 2 : DEFAULT_HALF_MM[0];
  const hy = d && Number.isFinite(d.y) && d.y > 0 ? d.y / 2 : DEFAULT_HALF_MM[1];
  const hz = d && Number.isFinite(d.z) && d.z > 0 ? d.z / 2 : DEFAULT_HALF_MM[2];
  const [rx, ry, rz] = component.pose.rotation_deg;
  if (Math.abs(rx % 360) > 1e-4 || Math.abs(ry % 360) > 1e-4 || Math.abs(rz % 360) > 1e-4) {
    const r = Math.hypot(hx, hy, hz);
    return [r, r, r];
  }
  return [hx, hy, hz];
}

export interface ComputePlanBoundsOptions {
  instanceIds?: readonly string[] | null;
  positionOverridesMm?: Readonly<Record<string, readonly [number, number, number]>>;
}

/**
 * Computes conservative millimeter bounds (`BoundsMm`) for a BuildPlan (or a subset of
 * instances, such as an isolated/focused component).
 */
export function computePlanBoundsMm(
  plan: Pick<BuildPlan, 'components'>,
  catalog: readonly CatalogComponent[],
  options: ComputePlanBoundsOptions = {},
): BoundsMm | undefined {
  const catalogById = new Map(catalog.map((c) => [c.catalog_id, c]));
  const filterSet =
    options.instanceIds && options.instanceIds.length > 0 ? new Set(options.instanceIds) : null;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let count = 0;

  for (const comp of plan.components) {
    if (filterSet && !filterSet.has(comp.instance_id)) continue;
    if (!filterSet && comp.render_overrides?.visible === false) continue;
    const pos = options.positionOverridesMm?.[comp.instance_id] ?? comp.pose.position_mm;
    const half = halfExtentsMm(comp, catalogById);
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], pos[i] - half[i]);
      max[i] = Math.max(max[i], pos[i] + half[i]);
    }
    count++;
  }

  if (count === 0) return undefined;
  return { min, max };
}
