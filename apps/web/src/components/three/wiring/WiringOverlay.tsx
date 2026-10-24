import { Html } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useState } from 'react';
import {
  CubicBezierCurve3,
  Material,
  MathUtils,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SphereGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import { knownDimensions } from './anchors';
import { ANCHOR_OBJECT_PREFIX, HIGHLIGHT_OBJECT_PREFIX, WIRE_OBJECT_PREFIX } from './constants';
import { connectedInstanceIds, filterWires } from './filter';
import { buildWiringLayout, type WiringLayoutOptions } from './layout';
import type {
  Vec3,
  WireRoute,
  WiringCatalogComponent,
  WiringFilter,
  WiringLayout,
  WiringPalette,
  WiringPlanInput,
  WiringWarning,
} from './types';
import { WireLabel, WiringStatusPanel } from './WiringStatusPanel';

export interface WiringOverlayProps {
  plan: WiringPlanInput;
  catalog: readonly WiringCatalogComponent[];
  visible?: boolean;
  filter?: WiringFilter | null;
  /** Wires touching these instances are emphasised; others dim when `dimUnselected`. */
  selectedInstanceIds?: readonly string[];
  dimUnselected?: boolean;
  /** Controlled active wire. When omitted, the overlay tracks pointer hover itself. */
  activeConnectionId?: string | null;
  /** Outline the two components joined by the active wire. */
  highlightConnected?: boolean;
  showLabels?: boolean;
  showStatus?: boolean;
  /** Scene units per millimetre; BuildPlan poses are millimetres. */
  unitsPerMm?: number;
  wireRadiusMm?: number;
  tubularSegments?: number;
  radialSegments?: number;
  palette?: WiringPalette;
  layoutOptions?: Omit<WiringLayoutOptions, 'palette'>;
  onWireHover?: (wire: WireRoute | null) => void;
  onWireSelect?: (wire: WireRoute) => void;
  onHighlightInstances?: (instanceIds: string[]) => void;
  onWarnings?: (warnings: readonly WiringWarning[], layout: WiringLayout) => void;
}

type WireState = 'normal' | 'active' | 'dimmed';

const toVector = (p: Vec3) => new Vector3(p[0], p[1], p[2]);

function makeMaterial(color: string, state: WireState): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color,
    roughness: 0.55,
    metalness: 0.05,
    emissive: state === 'active' ? color : '#000000',
    emissiveIntensity: state === 'active' ? 0.6 : 0,
    transparent: state === 'dimmed',
    opacity: state === 'dimmed' ? 0.22 : 1,
    depthWrite: state !== 'dimmed',
  });
}

/**
 * Electrical wiring overlay driven only by `plan.connections` (kind `electrical`),
 * catalog `ports` and component `pose`. Mount inside any R3F scene; it has no
 * dependency on the studio scene graph.
 */
export function WiringOverlay({
  plan,
  catalog,
  visible = true,
  filter,
  selectedInstanceIds,
  dimUnselected = true,
  activeConnectionId,
  highlightConnected = true,
  showLabels = true,
  showStatus = true,
  unitsPerMm = 1,
  wireRadiusMm = 1.2,
  tubularSegments = 24,
  radialSegments = 6,
  palette,
  layoutOptions,
  onWireHover,
  onWireSelect,
  onHighlightInstances,
  onWarnings,
}: WiringOverlayProps) {
  const layout = useMemo(
    () => buildWiringLayout(plan, catalog, { ...layoutOptions, palette }),
    [plan, catalog, palette, layoutOptions],
  );
  const shown = useMemo(() => filterWires(layout.wires, filter), [layout, filter]);

  useEffect(() => {
    onWarnings?.(layout.warnings, layout);
  }, [layout, onWarnings]);

  const [hoverId, setHoverId] = useState<string | null>(null);
  const activeId = activeConnectionId !== undefined ? activeConnectionId : hoverId;
  const active = shown.find((w) => w.connection_id === activeId) ?? null;

  const curves = useMemo(
    () =>
      new Map(
        shown.map((w) => {
          const [a, b, c, d] = w.control_points_mm.map(toVector) as [Vector3, Vector3, Vector3, Vector3];
          return [w.connection_id, new CubicBezierCurve3(a, b, c, d)] as const;
        }),
      ),
    [shown],
  );

  const geometries = useMemo(
    () =>
      new Map(
        [...curves].map(([id, curve]) => [
          id,
          new TubeGeometry(curve, tubularSegments, wireRadiusMm, radialSegments, false),
        ]),
      ),
    [curves, tubularSegments, wireRadiusMm, radialSegments],
  );
  useEffect(() => () => geometries.forEach((g) => g.dispose()), [geometries]);

  const anchorGeometry = useMemo(() => new SphereGeometry(wireRadiusMm * 1.8, 10, 8), [wireRadiusMm]);
  useEffect(() => () => anchorGeometry.dispose(), [anchorGeometry]);

  const materials = useMemo(() => {
    const cache = new Map<string, MeshStandardMaterial>();
    return {
      get(color: string, state: WireState) {
        const key = `${color}|${state}`;
        let m = cache.get(key);
        if (!m) cache.set(key, (m = makeMaterial(color, state)));
        return m;
      },
      dispose: () => cache.forEach((m) => m.dispose()),
    };
  }, []);
  useEffect(() => () => materials.dispose(), [materials]);

  const highlightMaterial = useMemo<Material>(
    () => new MeshBasicMaterial({ color: '#FDE68A', wireframe: true, transparent: true, opacity: 0.9 }),
    [],
  );
  useEffect(() => () => highlightMaterial.dispose(), [highlightMaterial]);

  const highlightIds = useMemo(() => connectedInstanceIds(active), [active]);
  useEffect(() => {
    onHighlightInstances?.(highlightIds);
  }, [highlightIds, onHighlightInstances]);

  const selected = useMemo(() => new Set(selectedInstanceIds ?? []), [selectedInstanceIds]);

  const instancesById = useMemo(() => new Map(plan.components.map((c) => [c.instance_id, c] as const)), [plan]);
  const catalogById = useMemo(() => new Map(catalog.map((c) => [c.catalog_id, c] as const)), [catalog]);

  if (!visible) return null;

  const stateOf = (w: WireRoute): WireState => {
    if (active?.connection_id === w.connection_id) return 'active';
    const touchesSelection = selected.has(w.from.instance_id) || selected.has(w.to.instance_id);
    if (selected.size > 0 && dimUnselected && !touchesSelection) return 'dimmed';
    if (active && dimUnselected) return 'dimmed';
    return touchesSelection ? 'active' : 'normal';
  };

  const hover = (w: WireRoute | null) => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHoverId(w?.connection_id ?? null);
    onWireHover?.(w);
  };

  return (
    <group name="wiring-overlay" scale={unitsPerMm} userData={{ approximate: layout.approximate }}>
      {shown.map((w) => {
        const material = materials.get(w.color, stateOf(w));
        return (
          <group key={w.connection_id} name={`wire-group:${w.connection_id}`}>
            <mesh
              name={`${WIRE_OBJECT_PREFIX}${w.connection_id}`}
              geometry={geometries.get(w.connection_id)}
              material={material}
              userData={{ connection_id: w.connection_id, approximate: w.approximate }}
              onPointerOver={hover(w)}
              onPointerOut={hover(null)}
              onClick={(e: ThreeEvent<MouseEvent>) => {
                e.stopPropagation();
                onWireSelect?.(w);
              }}
            />
            {(['from', 'to'] as const).map((end) => (
              <mesh
                key={end}
                name={`${ANCHOR_OBJECT_PREFIX}${w.connection_id}:${end}`}
                geometry={anchorGeometry}
                material={material}
                position={w[end].position_mm as [number, number, number]}
                userData={{ source: w[end].source, approximate: w[end].approximate }}
              />
            ))}
          </group>
        );
      })}

      {highlightConnected &&
        highlightIds.map((id) => {
          const instance = instancesById.get(id);
          const component = instance && catalogById.get(instance.catalog_id);
          const dims = component && knownDimensions(component);
          if (!instance || !dims) return null;
          const [rx, ry, rz] = instance.pose.rotation_deg;
          return (
            <mesh
              key={id}
              name={`${HIGHLIGHT_OBJECT_PREFIX}${id}`}
              material={highlightMaterial}
              position={instance.pose.position_mm as [number, number, number]}
              rotation={[MathUtils.degToRad(rx ?? 0), MathUtils.degToRad(ry ?? 0), MathUtils.degToRad(rz ?? 0), 'XYZ']}
              raycast={() => null}
            >
              <boxGeometry args={[dims[0] + 2, dims[1] + 2, dims[2] + 2]} />
            </mesh>
          );
        })}

      {showLabels && active && (
        <Html position={curves.get(active.connection_id)!.getPoint(0.5)} center zIndexRange={[20, 10]}>
          <WireLabel wire={active} />
        </Html>
      )}

      {showStatus && (layout.approximate || layout.warnings.length > 0) && (
        <Html calculatePosition={() => [12, 12]} zIndexRange={[30, 20]}>
          <WiringStatusPanel layout={layout} shownCount={shown.length} />
        </Html>
      )}
    </group>
  );
}
