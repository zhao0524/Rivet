import * as THREE from 'three';
import { cachedGeometry, roundedBox } from '../geometry';
import { type MaterialKind, useMat } from '../materials';
import type { RecipeProps } from '../types';

const UNKNOWN_EDGE = new THREE.LineBasicMaterial({ color: '#e0a030' });

function edges(w: number, h: number, d: number): THREE.BufferGeometry {
  return cachedGeometry(`edges:${w}:${h}:${d}`, () => new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)));
}

/** Catalog item without a dedicated recipe: honest neutral block in its catalog material. */
export function GenericPartRecipe({ size, color, kind }: RecipeProps & { kind: MaterialKind }) {
  const mat = useMat(kind, color);
  return (
    <group name="generic-visual">
      <mesh geometry={roundedBox(size.x, size.y, size.z, Math.min(size.x, size.y, size.z) * 0.12, 3)} material={mat} />
    </group>
  );
}

/** Missing catalog entry: translucent placeholder with an amber cage so it never reads as a real part. */
export function UnknownPartRecipe({ size }: RecipeProps) {
  const mat = useMat('unknown');
  return (
    <group name="unknown-visual" userData={{ fallback: true }}>
      <mesh geometry={roundedBox(size.x, size.y, size.z, Math.min(size.x, size.y, size.z) * 0.08, 2)} material={mat} />
      <lineSegments geometry={edges(size.x * 1.01, size.y * 1.01, size.z * 1.01)} material={UNKNOWN_EDGE} />
    </group>
  );
}
