import { memo, useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import { useExplodeAnimator } from '../assembly/ExplodeAnimator';
import { cachedGeometry } from './geometry';
import { PartRenderContext } from './materials';
import { RECIPES, resolveRecipe, resolveSide, resolveSize } from './recipes';
import { GlbPart, isLocalModelPath } from './recipes/GlbPart';
import type { PartCatalogItem, PartSelectEvent, PartVisibility, PlanComponentOccurrence, PoseOverride, Vec3 } from './types';

const DEG = Math.PI / 180;
const MOUNT_COLOR = '#34d399';
/** Pointer travel (px) between press and release above which a click is an orbit/pan drag. */
export const PART_CLICK_DRAG_THRESHOLD_PX = 4;
const mountDotMat = new THREE.MeshBasicMaterial({ color: MOUNT_COLOR, depthTest: false, transparent: true, opacity: 0.9 });
const mountDotGeom = () => cachedGeometry('mount-dot-sphere', () => new THREE.SphereGeometry(1.6, 10, 8));

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
  /** False draws the part but lets pointer events pass through it (e.g. a see-through shell). */
  interactive?: boolean;
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
  interactive: pickable = true,
  onSelect,
  onHover,
}: HardwarePartProps) {
  const rootRef = useRef<THREE.Group>(null);
  const visualRef = useRef<THREE.Group>(null);
  const explode = useExplodeAnimator();
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

  const procedural = <Recipe size={size} color={color} side={side} catalogItem={catalogItem} overrides={component.render_overrides} />;
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
  }, [recipeId, size, side, mode]);

  // Exploded view: the animator owns this group's position while bound. The whole
  // PartNode moves as one rigid body, so child meshes keep their local transforms.
  const offset = poseOverride?.explode_offset_mm;
  const bound = explode != null && offset != null;
  const [px, py, pz] = position;
  const [ox, oy, oz] = offset ?? [0, 0, 0];
  const staticPosition = useRef(position);
  staticPosition.current = position;
  useLayoutEffect(() => {
    const g = rootRef.current;
    if (!bound || !explode || !g) return;
    const unregister = explode.register(g, [px, py, pz], [ox, oy, oz]);
    return () => {
      unregister();
      // Unbound: fall back to the static presentation pose (re-registering overwrites this).
      const [x, y, z] = staticPosition.current;
      g.position.set(x, y, z);
    };
    // Keyed on the numbers, not array identity, so re-renders do not re-register.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [explode, bound, px, py, pz, ox, oy, oz]);

  const handleClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      // A press that travelled is an orbit/pan drag, not a pick.
      if ((e.delta ?? 0) > PART_CLICK_DRAG_THRESHOLD_PX) return;
      onSelect?.({ instanceId: component.instance_id, catalogId: component.catalog_id });
    },
    [onSelect, component.instance_id, component.catalog_id],
  );
  const handleOver = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      onHover?.(component.instance_id);
    },
    [onHover, component.instance_id],
  );
  const handleOut = useCallback(() => {
    onHover?.(null);
  }, [onHover]);

  const interactive = mode !== 'hidden' && pickable;
  const mounts = catalogItem?.mounts ?? [];

  return (
    <group
      ref={rootRef}
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
        selected,
        highlighted,
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
