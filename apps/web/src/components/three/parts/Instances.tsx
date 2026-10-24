import { useLayoutEffect, useRef } from 'react';
import * as THREE from 'three';
import type { Vec3 } from './types';

export interface InstanceTransform {
  p: Vec3;
  /** Euler radians, XYZ. */
  r?: Vec3;
  s?: Vec3;
  /** Euler order for `r`; defaults to three's 'XYZ'. */
  order?: THREE.EulerOrder;
}

interface InstancesProps {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  transforms: readonly InstanceTransform[];
  name?: string;
}

const tmpObject = new THREE.Object3D();

/** Repeated cosmetic detail (pins, lugs, pads) drawn as one InstancedMesh. */
export function Instances({ geometry, material, transforms, name }: InstancesProps) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    transforms.forEach((t, i) => {
      tmpObject.position.set(t.p[0], t.p[1], t.p[2]);
      tmpObject.rotation.set(t.r?.[0] ?? 0, t.r?.[1] ?? 0, t.r?.[2] ?? 0, t.order ?? 'XYZ');
      tmpObject.scale.set(t.s?.[0] ?? 1, t.s?.[1] ?? 1, t.s?.[2] ?? 1);
      tmpObject.updateMatrix();
      mesh.setMatrixAt(i, tmpObject.matrix);
    });
    mesh.count = transforms.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
  }, [transforms]);
  if (transforms.length === 0) return null;
  return (
    <instancedMesh
      key={transforms.length}
      ref={ref}
      name={name}
      args={[geometry, material, transforms.length]}
      castShadow
      receiveShadow
    />
  );
}

/** Evenly spaced positions along X, centred on `cx`. */
export function rowX(count: number, pitch: number, cx: number, y: number, z: number): InstanceTransform[] {
  const start = cx - ((count - 1) * pitch) / 2;
  return Array.from({ length: count }, (_, i) => ({ p: [start + i * pitch, y, z] as Vec3 }));
}
