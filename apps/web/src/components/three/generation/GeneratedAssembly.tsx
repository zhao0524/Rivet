'use client';

import { useEffect, useLayoutEffect, useMemo, useState, Suspense } from 'react';
import * as THREE from 'three';
import { useLoader, type ThreeEvent } from '@react-three/fiber';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { BodyKind } from '../../../lib/rivet/design-v2-types';

export type LayerMode = 'visible' | 'ghost' | 'hidden';
export type LayerState = Record<BodyKind | 'internal', LayerMode>;
export const DEFAULT_LAYERS: LayerState = { purchased: 'visible', fabricated: 'visible', concept_visual: 'visible', internal: 'visible' };
const M_TO_MM = 1000;

export interface AssemblyBody {
  bodyId: string;
  kind: BodyKind;
  role: string;
  name: string;
  internal: boolean;
}

export interface GeneratedAssemblyProps {
  /** Same-origin asset URL of a Rivet GLB (metres, one node per body with `body_id` extras). */
  url: string;
  selectedBodyId?: string | null;
  layers?: LayerState;
  /** 0 = assembled, 1 = fully exploded. */
  explode?: number;
  onSelect?: (bodyId: string | null) => void;
  onBodies?: (bodies: AssemblyBody[]) => void;
  onBounds?: (bounds: { min: [number, number, number]; max: [number, number, number] }) => void;
}

/** Body id of the nearest ancestor that carries Rivet body extras. */
export function bodyIdOf(object: THREE.Object3D | null): string | null {
  for (let o: THREE.Object3D | null = object; o; o = o.parent) {
    const id = (o.userData as { body_id?: unknown }).body_id;
    if (typeof id === 'string') return id;
  }
  return null;
}

function Assembly({ url, selectedBodyId = null, layers = DEFAULT_LAYERS, explode = 0, onSelect, onBodies, onBounds }: GeneratedAssemblyProps) {
  const gltf = useLoader(GLTFLoader, url);
  const { root, nodes, centre, scale } = useMemo(() => {
    const clone = gltf.scene.clone(true);
    const found: Array<{ node: THREE.Object3D; body: AssemblyBody; base: THREE.Vector3; dir: THREE.Vector3; materials: THREE.MeshStandardMaterial[] }> = [];
    clone.updateMatrixWorld(true);
    const whole = new THREE.Box3().setFromObject(clone);
    const c = whole.getCenter(new THREE.Vector3());
    const size = whole.getSize(new THREE.Vector3()).length() || 1;
    clone.traverse((o) => {
      const data = o.userData as { body_id?: string; kind?: BodyKind; role?: string; name?: string; internal?: boolean };
      if (typeof data.body_id !== 'string') return;
      const materials: THREE.MeshStandardMaterial[] = [];
      o.traverse((m) => {
        const mesh = m as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        const own = (mesh.material as THREE.MeshStandardMaterial).clone();
        mesh.material = own;
        materials.push(own);
      });
      const box = new THREE.Box3().setFromObject(o);
      const dir = box.getCenter(new THREE.Vector3()).sub(c);
      found.push({ node: o, body: { bodyId: data.body_id, kind: data.kind ?? 'concept_visual', role: data.role ?? 'body', name: data.name ?? data.body_id, internal: !!data.internal },
        base: o.position.clone(), dir, materials });
    });
    return { root: clone, nodes: found, centre: c, scale: size };
  }, [gltf]);

  useEffect(() => {
    onBodies?.(nodes.map((n) => n.body));
    const box = new THREE.Box3().setFromObject(root);
    onBounds?.({ min: box.min.clone().multiplyScalar(M_TO_MM).toArray() as [number, number, number], max: box.max.clone().multiplyScalar(M_TO_MM).toArray() as [number, number, number] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, root]);

  useLayoutEffect(() => {
    for (const { node, body, base, dir, materials } of nodes) {
      const mode = body.internal && layers.internal !== 'visible' ? layers.internal : layers[body.kind];
      node.visible = mode !== 'hidden';
      node.position.copy(base).addScaledVector(dir, explode * 1.2);
      const selected = body.bodyId === selectedBodyId;
      for (const m of materials) {
        m.transparent = mode === 'ghost';
        m.opacity = mode === 'ghost' ? 0.22 : 1;
        m.depthWrite = mode !== 'ghost';
        m.emissive = new THREE.Color(selected ? '#3b82f6' : '#000000');
        m.emissiveIntensity = selected ? 0.45 : 0;
        m.needsUpdate = true;
      }
    }
  }, [nodes, layers, explode, selectedBodyId, centre, scale]);

  const click = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if ((e.delta ?? 0) > 4) return;
    onSelect?.(bodyIdOf(e.object));
  };
  return (
    <group name="generated-assembly" scale={M_TO_MM} userData={{ assetUrl: url }}>
      <primitive object={root} onClick={click} />
    </group>
  );
}

/** Renders an actual generated assembly GLB with stable body ids, layers, ghosting and explode. */
export function GeneratedAssembly(props: GeneratedAssemblyProps) {
  return (
    <Suspense fallback={null}>
      <Assembly {...props} />
    </Suspense>
  );
}

function Preload({ url, onReady }: { url: string; onReady: () => void }) {
  useLoader(GLTFLoader, url);
  useEffect(onReady, [url]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/**
 * Shows the latest geometry snapshot. The previous snapshot stays on screen until the next one
 * has loaded, so streaming previews never blank the view or reset the camera and selection.
 */
export function PreviewSwapper({ url, ...rest }: Omit<GeneratedAssemblyProps, 'url'> & { url: string | null }) {
  const [shown, setShown] = useState<string | null>(url);
  useEffect(() => {
    if (shown === null && url) setShown(url);
  }, [url, shown]);
  return (
    <>
      {shown ? <GeneratedAssembly url={shown} {...rest} /> : null}
      {url && url !== shown ? (
        <Suspense fallback={null}>
          <Preload url={url} onReady={() => setShown(url)} />
        </Suspense>
      ) : null}
    </>
  );
}

/** Frame bounds that only grow (in 10 mm steps), so new snapshots do not refit the camera. */
export function growBounds(
  previous: { min: [number, number, number]; max: [number, number, number] } | null,
  next: { min: [number, number, number]; max: [number, number, number] },
): { min: [number, number, number]; max: [number, number, number] } {
  const q = (v: number, up: boolean) => (up ? Math.ceil(v / 10) * 10 : Math.floor(v / 10) * 10);
  const min = next.min.map((v, i) => q(Math.min(v, previous?.min[i] ?? v), false)) as [number, number, number];
  const max = next.max.map((v, i) => q(Math.max(v, previous?.max[i] ?? v), true)) as [number, number, number];
  if (previous && min.every((v, i) => v === previous.min[i]) && max.every((v, i) => v === previous.max[i])) return previous;
  return { min, max };
}
