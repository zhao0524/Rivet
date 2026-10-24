/**
 * Millimeter <-> scene unit adapter for the Rivet stage.
 *
 * Canonical data (`BuildPlan`, `CatalogComponent`) stores lengths in millimeters
 * with a right-handed, Y-up frame: x right, y up, z toward the rover front, and
 * Euler rotations in degrees applied XYZ (implementation.md §3).
 *
 * Inside the stage, one scene unit is one meter (the simulator unit), which keeps
 * camera clipping planes, shadows and fog numerically well behaved. Children of
 * `RivetStage` are authored directly in millimeters: the stage wraps them in a
 * group scaled by `SCENE_UNITS_PER_MM`. Every helper here returns new values and
 * never mutates its input.
 */

export type Vec3 = [number, number, number];
export type ReadonlyVec3 = readonly [number, number, number];

export interface Bounds3 {
  min: Vec3;
  max: Vec3;
}

export interface BoundsMm {
  min: ReadonlyVec3;
  max: ReadonlyVec3;
}

export const MM_PER_SCENE_UNIT = 1000;
export const SCENE_UNITS_PER_MM = 1 / MM_PER_SCENE_UNIT;

export function mmToScene(mm: number): number {
  return mm * SCENE_UNITS_PER_MM;
}

export function sceneToMm(sceneUnits: number): number {
  return sceneUnits * MM_PER_SCENE_UNIT;
}

export function vec3MmToScene(v: ReadonlyVec3): Vec3 {
  return [mmToScene(v[0]), mmToScene(v[1]), mmToScene(v[2])];
}

export function vec3SceneToMm(v: ReadonlyVec3): Vec3 {
  return [sceneToMm(v[0]), sceneToMm(v[1]), sceneToMm(v[2])];
}

export function boundsMmToScene(bounds: BoundsMm): Bounds3 {
  return { min: vec3MmToScene(bounds.min), max: vec3MmToScene(bounds.max) };
}

export function boundsSceneToMm(bounds: Bounds3): Bounds3 {
  return { min: vec3SceneToMm(bounds.min), max: vec3SceneToMm(bounds.max) };
}

/** `rotation_deg` (XYZ Euler, degrees) to radians for a three.js `rotation` prop. */
export function rotationDegToRad(rotationDeg: ReadonlyVec3): Vec3 {
  const k = Math.PI / 180;
  return [rotationDeg[0] * k, rotationDeg[1] * k, rotationDeg[2] * k];
}
