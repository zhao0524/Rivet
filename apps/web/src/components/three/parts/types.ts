/**
 * Minimal structural views of the canonical contracts (implementation.md §3.2, §3.3).
 * Kept local so this module does not depend on another task branch; any object that
 * satisfies the full `BuildPlan` / `CatalogComponent` types also satisfies these.
 */

export type Vec3 = [number, number, number];

export interface PartPose {
  position_mm: Vec3;
  rotation_deg: Vec3;
}

export interface PartMountItem {
  mount_id: string;
  position_mm?: Vec3;
}

export interface PartCatalogItem {
  catalog_id: string;
  identity?: {
    manufacturer?: string | null;
    model?: string | null;
    sku?: string | null;
    category?: string | null;
  } | null;
  physical?: {
    dimensions_mm?: { x: number; y: number; z: number } | null;
    mass_g?: number | null;
    bounds_verified?: boolean | null;
    geometry_kind?: string | null;
    asset_path?: string | null;
    material_preset?: string | null;
  } | null;
  mounts?: readonly PartMountItem[] | null;
}

export interface PlanComponentOccurrence {
  instance_id: string;
  catalog_id: string;
  role?: string | null;
  parent_instance_id?: string | null;
  own_mount_id?: string | null;
  attached_to_mount_id?: string | null;
  pose: PartPose;
  render_overrides?: { color?: string | null; [key: string]: unknown } | null;
}

export interface PartPlan {
  schema_version?: string;
  build_id?: string;
  revision?: number;
  components: readonly PlanComponentOccurrence[];
}

/** `true`/`'visible'` render normally, `'ghost'` renders translucent, `false`/`'hidden'` hides. */
export type PartVisibility = boolean | 'visible' | 'ghost' | 'hidden';

export interface PoseOverride {
  position_mm?: Vec3;
  rotation_deg?: Vec3;
}

export interface Size3 {
  x: number;
  y: number;
  z: number;
}

export type PartSide = 'left' | 'right' | 'center';

export interface RecipeProps {
  /** Catalog bounding dimensions in mm (local x/y/z). */
  size: Size3;
  /** `render_overrides.color` when provided. */
  color?: string;
  side: PartSide;
  catalogItem?: PartCatalogItem;
}

export interface PartSelectEvent {
  instanceId: string;
  catalogId: string;
}
