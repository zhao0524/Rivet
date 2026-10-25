'use client';

import { useLayoutEffect, useMemo, useRef } from 'react';
import type { Group } from 'three';
import { explodeOffsetsMm, productBoundsMm } from '../../lib/sandbox/layout';
import type { SandboxPart, SandboxProduct } from '../../lib/sandbox/types';
import { ExplodeAnimator, useExplodeAnimator } from '../three/assembly';
import {
  PartSelectionProvider,
  SelectablePart,
  SelectionOutline,
  resolvePartHighlight,
  type PartSelectionApi,
} from '../three/interactions';
import { RivetStage, graphiteStageTheme, studioLightStageTheme } from '../three/stage';

const DEG = Math.PI / 180;

function PartShape({ part, emissive, intensity, opacity }: { part: SandboxPart; emissive: string | null; intensity: number; opacity: number }) {
  const [x, y, z] = part.size_mm;
  const rot = part.rotation_deg ?? [0, 0, 0];
  return (
    <mesh rotation={[rot[0] * DEG, rot[1] * DEG, rot[2] * DEG]} castShadow receiveShadow>
      {part.shape === 'box' ? <boxGeometry args={[x, y, z]} /> : null}
      {part.shape === 'cylinder' ? <cylinderGeometry args={[x / 2, x / 2, y, 32]} /> : null}
      {part.shape === 'sphere' ? <sphereGeometry args={[x / 2, 28, 20]} /> : null}
      <meshStandardMaterial
        color={part.color}
        roughness={0.55}
        metalness={0.12}
        emissive={emissive ?? '#000000'}
        emissiveIntensity={intensity}
        transparent={opacity < 1}
        opacity={opacity}
        depthWrite={opacity >= 1}
      />
    </mesh>
  );
}

/** One placed part. Its position is driven by the explode animator, never by React state. */
function PlacedPart({ part, offset }: { part: SandboxPart; offset: readonly [number, number, number] }) {
  const ref = useRef<Group>(null);
  const explode = useExplodeAnimator();
  const [px, py, pz] = part.position_mm;
  const [ox, oy, oz] = offset;
  useLayoutEffect(() => {
    const g = ref.current;
    if (!g || !explode) return;
    const unregister = explode.register(g, [px, py, pz], [ox, oy, oz]);
    return () => {
      unregister();
      g.position.set(px, py, pz);
    };
  }, [explode, px, py, pz, ox, oy, oz]);

  return (
    <SelectablePart instanceId={part.part_id} isolatedOutBehavior="ghost">
      {(state) => {
        const look = resolvePartHighlight(state);
        return (
          <group ref={ref} position={[px, py, pz]}>
            <PartShape part={part} emissive={look.emissive} intensity={look.emissive_intensity} opacity={look.opacity} />
          </group>
        );
      }}
    </SelectablePart>
  );
}

export interface SandboxSceneProps {
  product: SandboxProduct;
  selection: PartSelectionApi;
  exploded: boolean;
  themeMode: 'dark' | 'light';
  resetSignal?: unknown;
}

/** The product on the shared Rivet stage: click, hover, hide and isolate come from the same selection hook as the Parts step. */
export function SandboxScene({ product, selection, exploded, themeMode, resetSignal }: SandboxSceneProps) {
  const offsets = useMemo(() => explodeOffsetsMm(product.parts), [product.parts]);
  const isolated = selection.state.isolated_instance_id;
  // Frame the product where it will be drawn: spread out when exploded, so nothing leaves the view.
  const boundsMm = useMemo(() => {
    const placed = exploded
      ? product.parts.map((p) => {
          const o = offsets[p.part_id] ?? [0, 0, 0];
          return { ...p, position_mm: [p.position_mm[0] + o[0], p.position_mm[1] + o[1], p.position_mm[2] + o[2]] as const };
        })
      : product.parts;
    return productBoundsMm(placed, isolated ? new Set([isolated]) : undefined);
  }, [product.parts, offsets, exploded, isolated]);
  const theme = themeMode === 'light' ? studioLightStageTheme : graphiteStageTheme;

  return (
    <div data-testid="sandbox-scene" data-product-id={product.product_id} style={{ position: 'relative', width: '100%', height: '100%', minHeight: 320 }}>
      <PartSelectionProvider value={selection.context}>
        <RivetStage
          boundsMm={boundsMm}
          resetSignal={resetSignal ?? product.product_id}
          showGrid={false}
          theme={theme}
          onCanvasPointerDown={selection.canvasProps.onPointerDown}
          onBackgroundClick={selection.canvasProps.onPointerMissed}
          label={`3D model of ${product.name}. Click a part to select it.`}
        >
          <ExplodeAnimator target={exploded ? 1 : 0}>
            {product.parts.map((part) => (
              <PlacedPart key={part.part_id} part={part} offset={offsets[part.part_id] ?? [0, 0, 0]} />
            ))}
          </ExplodeAnimator>
          <SelectionOutline selectedInstanceId={selection.selectedInstanceId} hoveredInstanceId={selection.hoveredInstanceId} />
        </RivetStage>
      </PartSelectionProvider>
    </div>
  );
}
