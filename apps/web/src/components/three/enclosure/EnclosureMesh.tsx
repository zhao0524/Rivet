'use client';

import { useThree } from '@react-three/fiber';
import { memo, useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import type { PartVisibility } from '../parts/types';
import { enclosureMeshes, type EnclosureMeshes } from './geometry';
import type { EnclosureSpec } from './layout';

export interface EnclosureMeshProps {
  spec: EnclosureSpec;
  /** Standoffs follow the part they hold up: hidden with it, see-through with it. */
  visibility?: Readonly<Record<string, PartVisibility>>;
  /** How the shell reads: `ghost` (see-through, the default) or `solid` printed plastic. */
  shell?: 'ghost' | 'solid';
  themeMode?: 'dark' | 'light';
}

/** Nothing printed should catch clicks meant for the parts inside it. */
const noRaycast = () => undefined;

function useMaterials(themeMode: 'dark' | 'light') {
  return useMemo(() => {
    const dark = themeMode === 'dark';
    const ghost = new THREE.MeshPhysicalMaterial({
      color: dark ? '#c9cfe0' : '#dfe4ee',
      roughness: 0.32,
      metalness: 0,
      clearcoat: 0.6,
      clearcoatRoughness: 0.25,
      transparent: true,
      opacity: dark ? 0.16 : 0.22,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const edges = new THREE.LineBasicMaterial({ color: dark ? '#e6e9f2' : '#5b6170', transparent: true, opacity: dark ? 0.5 : 0.45, depthWrite: false });
    const pla = new THREE.MeshStandardMaterial({ color: dark ? '#d9dce4' : '#eceef2', roughness: 0.55, metalness: 0 });
    const plaGhost = pla.clone();
    plaGhost.transparent = true;
    plaGhost.opacity = 0.25;
    plaGhost.depthWrite = false;
    return { ghost, edges, pla, plaGhost };
  }, [themeMode]);
}

/**
 * The printed body drawn around a build: a see-through shell showing the shape it closes into, and
 * printed standoffs under the boards. Built in WebAssembly on first use, then cached per layout.
 */
export const EnclosureMesh = memo(function EnclosureMesh({ spec, visibility, shell = 'ghost', themeMode = 'light' }: EnclosureMeshProps) {
  const [meshes, setMeshes] = useState<EnclosureMeshes | null>(null);
  const invalidate = useThree((s) => s.invalidate);
  const mats = useMaterials(themeMode);

  useEffect(() => {
    let live = true;
    enclosureMeshes(spec)
      .then((m) => {
        if (!live) return;
        setMeshes(m);
        invalidate();
      })
      .catch((error) => console.warn('Rivet: could not build the printed body', error));
    return () => {
      live = false;
    };
  }, [spec, invalidate]);

  const shellEdges = useMemo(() => (meshes ? new THREE.EdgesGeometry(meshes.shell.display, 28) : null), [meshes]);
  useEffect(() => () => shellEdges?.dispose(), [shellEdges]);
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);

  if (!meshes) return null;
  return (
    <group name="printed-body" userData={{ printedBody: true }}>
      <mesh
        name="printed-body-shell"
        geometry={meshes.shell.display}
        material={shell === 'ghost' ? mats.ghost : mats.pla}
        renderOrder={shell === 'ghost' ? 10 : 0}
        raycast={noRaycast}
        castShadow={shell === 'solid'}
      />
      {shell === 'ghost' && shellEdges ? (
        <lineSegments name="printed-body-edges" geometry={shellEdges} material={mats.edges} renderOrder={11} raycast={noRaycast} />
      ) : null}
      {meshes.posts.map((post) => {
        const v = post.forInstanceId ? visibility?.[post.forInstanceId] : 'visible';
        if (v === 'hidden' || v === false) return null;
        return (
          <mesh
            key={post.id}
            name={`printed-${post.id}`}
            geometry={post.display}
            material={v === 'ghost' ? mats.plaGhost : mats.pla}
            raycast={noRaycast}
            castShadow
          />
        );
      })}
    </group>
  );
});
