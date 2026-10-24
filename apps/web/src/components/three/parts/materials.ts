import { createContext, useContext, useMemo } from 'react';
import * as THREE from 'three';

export type MaterialKind =
  | 'polymer'
  | 'polymerGloss'
  | 'rubber'
  | 'metal'
  | 'chrome'
  | 'brass'
  | 'aluminum'
  | 'pcb'
  | 'gold'
  | 'tin'
  | 'blackPlastic'
  | 'epoxy'
  | 'silkscreen'
  | 'ceramic'
  | 'mesh'
  | 'led'
  | 'hole'
  | 'glass'
  | 'fabric'
  | 'wood'
  | 'carbon'
  | 'unknown';

interface Preset {
  color: string;
  roughness: number;
  metalness: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
}

const PRESETS: Record<MaterialKind, Preset> = {
  polymer: { color: '#3a3f47', roughness: 0.58, metalness: 0, clearcoat: 0.12, clearcoatRoughness: 0.6 },
  polymerGloss: { color: '#d6a935', roughness: 0.38, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.4 },
  rubber: { color: '#232527', roughness: 0.93, metalness: 0 },
  metal: { color: '#b9bec4', roughness: 0.34, metalness: 0.92 },
  chrome: { color: '#e2e6ea', roughness: 0.16, metalness: 1 },
  brass: { color: '#c09a5b', roughness: 0.32, metalness: 1 },
  aluminum: { color: '#a3aab1', roughness: 0.42, metalness: 0.88 },
  pcb: { color: '#1c5746', roughness: 0.46, metalness: 0, clearcoat: 0.55, clearcoatRoughness: 0.32 },
  gold: { color: '#d8ae52', roughness: 0.26, metalness: 1 },
  tin: { color: '#cdd1d5', roughness: 0.3, metalness: 1 },
  blackPlastic: { color: '#17181a', roughness: 0.6, metalness: 0 },
  epoxy: { color: '#1c1d20', roughness: 0.42, metalness: 0, clearcoat: 0.2, clearcoatRoughness: 0.5 },
  silkscreen: { color: '#eeeeea', roughness: 0.75, metalness: 0 },
  ceramic: { color: '#b48d61', roughness: 0.55, metalness: 0 },
  mesh: { color: '#3b3e42', roughness: 0.8, metalness: 0.5 },
  led: { color: '#ff3b30', roughness: 0.25, metalness: 0, emissiveIntensity: 1.4 },
  hole: { color: '#0b0c0d', roughness: 0.9, metalness: 0 },
  glass: { color: '#9fc4d8', roughness: 0.06, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, transparent: true, opacity: 0.55 },
  fabric: { color: '#5a5f66', roughness: 0.96, metalness: 0 },
  wood: { color: '#a0744a', roughness: 0.72, metalness: 0 },
  carbon: { color: '#1d1f22', roughness: 0.32, metalness: 0.25, clearcoat: 0.7, clearcoatRoughness: 0.25 },
  unknown: { color: '#c9ccd1', roughness: 0.7, metalness: 0, transparent: true, opacity: 0.55 },
};

/** Maps catalog `physical.material_preset` values to a base material kind. */
export function kindForCatalogPreset(preset: string | null | undefined): MaterialKind {
  switch (preset) {
    case 'metal':
      return 'metal';
    case 'rubber':
      return 'rubber';
    case 'pcb':
      return 'pcb';
    case 'polymer':
    default:
      return 'polymer';
  }
}

export interface PartRenderState {
  ghost: boolean;
  wireframe?: boolean;
}

export const PartRenderContext = createContext<PartRenderState>({ ghost: false, wireframe: false });

const cache = new Map<string, THREE.MeshPhysicalMaterial>();

export function getPartMaterial(
  kind: MaterialKind,
  color?: string,
  ghost = false,
  wireframe = false,
): THREE.MeshPhysicalMaterial {
  const preset = PRESETS[kind];
  const resolved = color ?? preset.color;
  const key = `${kind}|${resolved}|${ghost ? 'g' : 's'}|${wireframe ? 'w' : 'f'}`;
  let mat = cache.get(key);
  if (!mat) {
    const base = new THREE.Color(resolved);
    mat = new THREE.MeshPhysicalMaterial({
      color: base,
      roughness: preset.roughness,
      metalness: preset.metalness,
      clearcoat: preset.clearcoat ?? 0,
      clearcoatRoughness: preset.clearcoatRoughness ?? 0,
      envMapIntensity: 1,
      wireframe,
    });
    if (preset.emissiveIntensity) {
      mat.emissive = base.clone();
      mat.emissiveIntensity = preset.emissiveIntensity;
      mat.toneMapped = false;
    }
    if (preset.transparent) {
      mat.transparent = true;
      mat.opacity = preset.opacity ?? 1;
    }
    if (ghost) {
      mat.transparent = true;
      mat.opacity = 0.16;
      mat.depthWrite = false;
    }
    mat.name = `rivet-part:${key}`;
    cache.set(key, mat);
  }
  return mat;
}

/** Shared, memoized material honouring the current ghost state of the enclosing part. */
export function useMat(kind: MaterialKind, color?: string): THREE.MeshPhysicalMaterial {
  const { ghost, wireframe } = useContext(PartRenderContext);
  return useMemo(() => getPartMaterial(kind, color, ghost, wireframe ?? false), [kind, color, ghost, wireframe]);
}

export function disposePartMaterials(): void {
  cache.forEach((m) => m.dispose());
  cache.clear();
}

/** Mixes a hex colour toward white (amount > 0) or black (amount < 0). */
export function shade(hex: string, amount: number): string {
  const c = new THREE.Color(hex);
  const target = amount >= 0 ? new THREE.Color('#ffffff') : new THREE.Color('#000000');
  c.lerp(target, Math.min(1, Math.abs(amount)));
  return `#${c.getHexString()}`;
}
