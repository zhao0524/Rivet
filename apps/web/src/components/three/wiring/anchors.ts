import { Euler, MathUtils, Vector3 } from 'three';
import type {
  AnchorSource,
  Vec3,
  WireAnchor,
  WiringCatalogComponent,
  WiringComponentInstance,
  WiringPort,
} from './types';

/** Lift anchors slightly off the top face so tubes don't z-fight with part meshes. */
export const ANCHOR_STANDOFF_MM = 1;

export function isFiniteVec3(value: unknown): value is Vec3 {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((n) => typeof n === 'number' && Number.isFinite(n))
  );
}

export function knownDimensions(component: WiringCatalogComponent): Vec3 | null {
  const d = component.physical.dimensions_mm;
  if (!d) return null;
  const dims: unknown = [d.x, d.y, d.z];
  return isFiniteVec3(dims) && dims.every((n) => n > 0) ? dims : null;
}

/** Pose → world transform: translate `position_mm`, rotate Euler degrees in XYZ order. */
export function localToWorld(local: Vec3, pose: WiringComponentInstance['pose']): Vec3 {
  const [rx, ry, rz] = pose.rotation_deg as Vec3;
  const v = new Vector3(local[0], local[1], local[2]).applyEuler(
    new Euler(MathUtils.degToRad(rx), MathUtils.degToRad(ry), MathUtils.degToRad(rz), 'XYZ'),
  );
  const [px, py, pz] = pose.position_mm as Vec3;
  return [v.x + px, v.y + py, v.z + pz];
}

/**
 * Deterministic schematic slot for a port: ports keep catalog order and are spread
 * evenly along the x axis of the component's top face. Two instances of the same
 * catalog item get the same local slots, transformed by their own poses.
 */
export function schematicLocalAnchor(dims: Vec3, portIndex: number, portCount: number): Vec3 {
  const [dx, dy] = dims;
  const x = -dx / 2 + (dx * (portIndex + 1)) / (portCount + 1);
  return [x, dy / 2 + ANCHOR_STANDOFF_MM, 0];
}

export function resolveAnchor(
  instance: WiringComponentInstance,
  component: WiringCatalogComponent,
  port: WiringPort,
): WireAnchor {
  const portIndex = component.ports.findIndex((p) => p.port_id === port.port_id);
  const dims = knownDimensions(component);
  let local: Vec3;
  let source: AnchorSource;

  if (isFiniteVec3(port.position_mm)) {
    local = port.position_mm;
    source = component.physical.bounds_verified
      ? 'catalog_port_position'
      : 'catalog_port_position_unverified';
  } else if (dims) {
    local = schematicLocalAnchor(dims, portIndex, component.ports.length);
    source = 'schematic_bounds';
  } else {
    local = [0, 0, 0];
    source = 'pose_origin';
  }

  return {
    instance_id: instance.instance_id,
    port_id: port.port_id,
    catalog_id: component.catalog_id,
    signal: port.signal,
    position_mm: localToWorld(local, instance.pose),
    source,
    approximate: source !== 'catalog_port_position',
  };
}
