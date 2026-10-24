import type { ReactElement } from 'react';
import * as THREE from 'three';
import { box, cachedGeometry, cylinder, lathe, roundedBox, sphere, torus } from '../geometry';
import { type MaterialKind, useMat } from '../materials';
import type { RecipeProps } from '../types';
import { WheelRecipe } from './Wheel';

/** `physical.geometry_kind` of concept parts is `concept:<shape>` (services/api/rivet_api/concept). */
export const CONCEPT_GEOMETRY_PREFIX = 'concept:';

const MATERIALS: Readonly<Record<string, MaterialKind>> = {
  plastic: 'polymer',
  glossy_plastic: 'polymerGloss',
  rubber: 'rubber',
  metal: 'metal',
  aluminum: 'aluminum',
  chrome: 'chrome',
  pcb: 'pcb',
  glass: 'glass',
  fabric: 'fabric',
  wood: 'wood',
  carbon: 'carbon',
};

export function conceptShape(geometryKind: string | null | undefined): string | null {
  return geometryKind?.startsWith(CONCEPT_GEOMETRY_PREFIX) ? geometryKind.slice(CONCEPT_GEOMETRY_PREFIX.length) : null;
}

const hemisphere = () =>
  cachedGeometry('concept:hemisphere', () => new THREE.SphereGeometry(0.5, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2));
const cone = () => cachedGeometry('concept:cone', () => new THREE.ConeGeometry(0.5, 1, 32));
const tube = () =>
  lathe('concept:tube', [
    [0.36, -0.5],
    [0.5, -0.5],
    [0.5, 0.5],
    [0.36, 0.5],
    [0.36, -0.5],
  ]);

/** Two pitched, tapered blades around a hub, in the local x-z plane; diameter = size.x. */
function Propeller({ size, mat, hubMat }: { size: RecipeProps['size']; mat: THREE.Material; hubMat: THREE.Material }) {
  const D = Math.max(size.x, size.z);
  const t = Math.max(0.6, size.y);
  const hubR = Math.max(2, D * 0.06);
  return (
    <group name="concept-propeller">
      <mesh geometry={cylinder(hubR, hubR, t * 2.4, 24)} material={hubMat} />
      {[0, Math.PI].map((yaw) => (
        <group key={yaw} rotation={[0, yaw, 0]}>
          <mesh
            geometry={sphere(0.5, 24)}
            material={mat}
            position={[D / 4 + hubR / 2, 0, 0]}
            rotation={[0.18, 0, 0]}
            scale={[D / 2 - hubR / 2, t, D * 0.1]}
          />
        </group>
      ))}
    </group>
  );
}

/**
 * Appearance-only part from a concept model: one primitive (or a propeller / wheel) filling the
 * catalog bounding box, in the colour and material read from the photo. Not a sourced product.
 */
/** A wire through `path_mm` (points relative to the part origin), as a smooth tube. */
function Cable({ path, thickness, mat }: { path: readonly (readonly number[])[]; thickness: number; mat: THREE.Material }) {
  const key = `concept:cable:${thickness}:${path.map((p) => p.join(',')).join(';')}`;
  const geo = cachedGeometry(key, () => {
    const points = path.map(([x, y, z]) => new THREE.Vector3(x, y, z));
    const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
    return new THREE.TubeGeometry(curve, Math.max(8, points.length * 12), thickness / 2, 8, false);
  });
  return <mesh geometry={geo} material={mat} />;
}

function cablePath(value: unknown): number[][] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const ok = value.every((p) => Array.isArray(p) && p.length === 3 && p.every((v) => typeof v === 'number' && Number.isFinite(v)));
  return ok ? (value as number[][]) : null;
}

export function ConceptPartRecipe({ size, color, side, catalogItem, overrides }: RecipeProps) {
  const shape = conceptShape(catalogItem?.physical?.geometry_kind) ?? 'box';
  const kind = MATERIALS[catalogItem?.physical?.material_preset ?? ''] ?? 'polymer';
  const mat = useMat(kind, color);
  const hubMat = useMat('aluminum');
  const { x, y, z } = size;

  let body: ReactElement;
  switch (shape) {
    case 'rounded_box':
      body = <mesh geometry={roundedBox(x, y, z, Math.min(x, y, z) * 0.18, 3)} material={mat} />;
      break;
    case 'cylinder':
      body = <mesh geometry={cylinder(0.5, 0.5, 1, 40)} material={mat} scale={[x, y, z]} />;
      break;
    case 'tube':
      body = <mesh geometry={tube()} material={mat} scale={[x, y, z]} />;
      break;
    case 'sphere':
      body = <mesh geometry={sphere(0.5, 32)} material={mat} scale={[x, y, z]} />;
      break;
    case 'hemisphere':
      body = <mesh geometry={hemisphere()} material={mat} position={[0, -y / 2, 0]} scale={[x, 2 * y, z]} />;
      break;
    case 'cone':
      body = <mesh geometry={cone()} material={mat} scale={[x, y, z]} />;
      break;
    case 'capsule': {
      const radius = Math.min(x, z) / 2;
      const length = Math.max(0, y - 2 * radius);
      const geo = cachedGeometry(`concept:capsule:${radius.toFixed(2)}:${length.toFixed(2)}`, () =>
        new THREE.CapsuleGeometry(radius, length, 8, 24),
      );
      body = <mesh geometry={geo} material={mat} scale={[x / (2 * radius), 1, z / (2 * radius)]} />;
      break;
    }
    case 'torus': {
      const t = Math.min(y, x / 2) / 2;
      body = <mesh geometry={torus(x / 2 - t, t, 16, 48)} material={mat} rotation={[Math.PI / 2, 0, 0]} scale={[1, z / x, 1]} />;
      break;
    }
    case 'propeller':
      body = <Propeller size={size} mat={mat} hubMat={hubMat} />;
      break;
    case 'cable': {
      const path = cablePath(overrides?.path_mm);
      const thickness = typeof overrides?.thickness_mm === 'number' ? overrides.thickness_mm : Math.min(x, y, z);
      body = path ? <Cable path={path} thickness={thickness} mat={mat} /> : <mesh geometry={box(x, y, z)} material={mat} />;
      break;
    }
    case 'wheel':
      return <WheelRecipe size={size} color={color} side={side} catalogItem={catalogItem} />;
    case 'box':
    default:
      body = <mesh geometry={box(x, y, z)} material={mat} />;
  }
  return (
    <group name="concept-visual" userData={{ conceptShape: shape }}>
      {body}
    </group>
  );
}
