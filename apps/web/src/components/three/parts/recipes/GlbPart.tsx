import { Component, Suspense, useMemo, type ReactNode } from 'react';
import * as THREE from 'three';
import { useLoader } from '@react-three/fiber';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Size3 } from '../types';

const LOCAL_ASSET = /^\/models\/(?!.*\.\.)[\w\-./]+\.(glb|gltf)$/i;

/** Only checked-in, same-origin assets under `public/models/` are loaded; remote URLs are refused. */
export function isLocalModelPath(path: string | null | undefined): path is string {
  return typeof path === 'string' && LOCAL_ASSET.test(path);
}

class AssetBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function GlbModel({ path, size }: { path: string; size: Size3 }) {
  const gltf = useLoader(GLTFLoader, path);
  const object = useMemo(() => {
    const root = gltf.scene.clone(true);
    const bounds = new THREE.Box3().setFromObject(root);
    const extent = bounds.getSize(new THREE.Vector3());
    const target = Math.max(size.x, size.y, size.z);
    const actual = Math.max(extent.x, extent.y, extent.z) || 1;
    const scale = Math.abs(actual - target) / target > 0.05 ? target / actual : 1;
    root.scale.setScalar(scale);
    root.position.copy(bounds.getCenter(new THREE.Vector3()).multiplyScalar(-scale));
    return root;
  }, [gltf, size.x, size.y, size.z]);
  return <primitive object={object} />;
}

/** Loads a licensed local GLB/GLTF scaled to catalog bounds, showing the procedural recipe until (or instead of) it. */
export function GlbPart({ path, size, fallback }: { path: string; size: Size3; fallback: ReactNode }) {
  return (
    <AssetBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <GlbModel path={path} size={size} />
      </Suspense>
    </AssetBoundary>
  );
}
