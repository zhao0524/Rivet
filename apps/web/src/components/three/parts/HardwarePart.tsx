import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import { cachedGeometry } from './geometry';
import { PartRenderContext } from './materials';
import { RECIPES, resolveRecipe, resolveSide, resolveSize } from './recipes';
import { GlbPart, isLocalModelPath } from './recipes/GlbPart';
import type { PartCatalogItem, PartSelectEvent, PartVisibility, PlanComponentOccurrence, PoseOverride, Vec3 } from './types';

const DEG = Math.PI / 180;
const SELECT_COLOR = '#4f9dff';
const HOVER_COLOR = '#9cc8ff';
const STEP_HIGHLIGHT_COLOR = '#fbbf24';
const MOUNT_COLOR = '#34d399';
const selectLine = new THREE.LineBasicMaterial({ color: SELECT_COLOR, depthTest: false, transparent: true, opacity: 0.95 });
const hoverLine = new THREE.LineBasicMaterial({ color: HOVER_COLOR, depthTest: false, transparent: true, opacity: 0.55 });
const stepHighlightLine = new THREE.LineBasicMaterial({ color: STEP_HIGHLIGHT_COLOR, depthTest: false, transparent: true, opacity: 0.85 });
const mountDotMat = new THREE.MeshBasicMaterial({ color: MOUNT_COLOR, depthTest: false, transparent: true, opacity: 0.9 });
const unitEdges = () => cachedGeometry('unit-box-edges', () => new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)));
const mountDotGeom = () => cachedGeometry('mount-dot-sphere', () => new THREE.SphereGeometry(1.6, 10, 8));

/** Bounds of every mesh under `root`, expressed in `root`'s local frame. */
function localBounds(root: THREE.Object3D): THREE.Box3 {
  root.updateMatrixWorld(true);
  const toLocal = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const box = new THREE.Box3();
  const m = new THREE.Matrix4();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh & Partial<THREE.InstancedMesh>;
    if (!mesh.isMesh || !mesh.geometry) return;
    let local: THREE.Box3 | null;
    if (mesh.isInstancedMesh) {
      if (!mesh.boundingBox) mesh.computeBoundingBox!();
      local = mesh.boundingBox ?? null;
    } else {
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      local = mesh.geometry.boundingBox;
    }
    if (local && !local.isEmpty()) box.union(local.clone().applyMatrix4(m.multiplyMatrices(toLocal, mesh.matrixWorld)));
  });
  return box;
}

export function toRadians(deg: Vec3): Vec3 {
  return [deg[0] * DEG, deg[1] * DEG, deg[2] * DEG];
}

export function normalizeVisibility(
  v: PartVisibility | undefined,
  renderOverrides?: { visible?: unknown } | null,
): 'visible' | 'ghost' | 'hidden' {
  if (v === false || v === 'hidden') return 'hidden';
  if (v === 'ghost') return 'ghost';
  if (v === true || v === 'visible') return 'visible';
  if (renderOverrides && renderOverrides.visible === false) return 'hidden';
  return 'visible';
}

export interface HardwarePartProps {
  component: PlanComponentOccurrence;
  catalogItem?: PartCatalogItem;
  selected?: boolean;
  highlighted?: boolean;
  wireframe?: boolean;
  showMounts?: boolean;
  visibility?: PartVisibility;
  /** Presentation-only transform (exploded view, ghost preview); never written back to the plan. */
  poseOverride?: PoseOverride;
  onSelect?: (event: PartSelectEvent) => void;
  onHover?: (instanceId: string | null) => void;
}

/**
 * One selectable `PartNode` per BuildPlan occurrence. The outer group carries the real pose (mm, XYZ
 * Euler degrees); all screws, traces and other cosmetic details live beneath it and are not parts.
 */
export const HardwarePart = memo(function HardwarePart({
  component,
  catalogItem,
  selected = false,
  highlighted = false,
  wireframe = false,
  showMounts = false,
  visibility,
  poseOverride,
  onSelect,
  onHover,
}: HardwarePartProps) {
  const visualRef = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);
  const [bounds, setBounds] = useState<THREE.Box3 | null>(null);
  const mode = normalizeVisibility(visibility, component.render_overrides);
  const recipeId = resolveRecipe(component, catalogItem);
  const Recipe = RECIPES[recipeId];
  const size = useMemo(() => resolveSize(catalogItem), [catalogItem]);
  const side = resolveSide(component);
  const color = component.render_overrides?.color ?? undefined;
  const position = poseOverride?.position_mm ?? component.pose.position_mm;
  const rotation = useMemo(
    () => toRadians(poseOverride?.rotation_deg ?? component.pose.rotation_deg),
    [poseOverride?.rotation_deg, component.pose.rotation_deg],
  );
  const renderState = useMemo(() => ({ ghost: mode === 'ghost', wireframe }), [mode, wireframe]);

  const procedural = <Recipe size={size} color={color} side={side} catalogItem={catalogItem} />;
  const physical = catalogItem?.physical;
  const useAsset = physical?.geometry_kind === 'glb' && isLocalModelPath(physical.asset_path);

  useLayoutEffect(() => {
    const g = visualRef.current;
    if (!g) return;
    g.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = mode === 'visible';
        mesh.receiveShadow = true;
      }
    });
    const box = localBounds(g);
    setBounds(box.isEmpty() ? null : box);
  }, [recipeId, size, side, mode]);

  const handleClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      onSelect?.({ instanceId: component.instance_id, catalogId: component.catalog_id });
    },
    [onSelect, component.instance_id, component.catalog_id],
  );
  const handleOver = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      setHovered(true);
      onHover?.(component.instance_id);
    },
    [onHover, component.instance_id],
  );
  const handleOut = useCallback(() => {
    setHovered(false);
    onHover?.(null);
  }, [onHover]);

  const interactive = mode !== 'hidden';
  const outline = interactive && bounds && (selected || hovered || highlighted);
  const center = bounds?.getCenter(new THREE.Vector3()).toArray();
  const extent = bounds?.getSize(new THREE.Vector3()).addScalar(1.2).toArray();
  const mounts = catalogItem?.mounts ?? [];

  return (
    <group
      name={`part:${component.instance_id}`}
      position={position}
      rotation={rotation}
      visible={mode !== 'hidden'}
      userData={{
        partNode: true,
        instanceId: component.instance_id,
        catalogId: component.catalog_id,
        role: component.role ?? null,
        recipe: recipeId,
        fallback: recipeId === 'unknown',
      }}
      onClick={interactive ? handleClick : undefined}
      onPointerOver={interactive ? handleOver : undefined}
      onPointerOut={interactive ? handleOut : undefined}
    >
      <PartRenderContext.Provider value={renderState}>
        <group ref={visualRef} name="visual" userData={{ decorative: true }}>
          {useAsset ? <GlbPart path={physical!.asset_path!} size={size} fallback={procedural} /> : procedural}
        </group>
      </PartRenderContext.Provider>
      {outline && center && extent ? (
        <lineSegments
          name="selection-outline"
          geometry={unitEdges()}
          material={selected ? selectLine : hovered ? hoverLine : stepHighlightLine}
          position={center}
          scale={extent}
          renderOrder={10}
          raycast={() => null}
          userData={{ decorative: true }}
        />
      ) : null}
      {showMounts && interactive && mounts.length > 0 ? (
        <group name="mount-frames" userData={{ decorative: true }}>
          {mounts.map((m) => (
            <mesh
              key={m.mount_id}
              name={`mount:${m.mount_id}`}
              geometry={mountDotGeom()}
              material={mountDotMat}
              position={m.position_mm ?? [0, 0, 0]}
              raycast={() => null}
              userData={{ decorative: true, mountId: m.mount_id }}
            />
          ))}
        </group>
      ) : null}
    </group>
  );
});
