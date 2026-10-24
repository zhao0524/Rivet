'use client';

import { useCallback, useMemo, useState, type CSSProperties } from 'react';
import { buildDimensionsByCatalogId, computePlanBoundsMm } from '../../lib/geometry';
import type { BuildPlan, CatalogComponent } from '../../lib/rivet/types';
import {
  computeAssemblyView,
  type AssemblyMode,
  type AssemblyView,
  type PreviousComponentsDisplay,
} from './assembly';
import {
  PartSelectionProvider,
  usePartSelection,
  type PartSelectionApi,
} from './interactions';
import { PartAssembly, type PartSelectEvent, type PartVisibility, type PoseOverride } from './parts';
import {
  DEFAULT_VIEW,
  RivetStage,
  graphiteStageTheme,
  studioLightStageTheme,
  type CameraView,
  type StageTheme,
} from './stage';
import {
  WiringOverlay,
  type WireRoute,
  type WiringCatalogComponent,
  type WiringFilter,
  type WiringLayout,
  type WiringPlanInput,
  type WiringWarning,
} from './wiring';

export interface RoverSceneProps {
  plan: BuildPlan;
  catalog: readonly CatalogComponent[];
  /** Optional external selection controller hook from `usePartSelection(plan)`. */
  selection?: PartSelectionApi;
  /** Assembly presentation mode (`assembled`, `exploded`, or `step`). */
  assemblyMode?: AssemblyMode;
  /** Explode fraction in [0, 1] when `assemblyMode === 'exploded'`, or step seat progress when `assemblyMode === 'step'`. */
  assemblyProgress?: number;
  /** Active step index (0..stepCount) when `assemblyMode === 'step'`. */
  assemblyStep?: number;
  ghostFutureSteps?: boolean;
  previousStepsDisplay?: PreviousComponentsDisplay;
  /** Precomputed assembly view if the parent already computed it. */
  assemblyView?: AssemblyView;
  /** Show 3D electrical wiring overlay. */
  showWiring?: boolean;
  wiringFilter?: WiringFilter | null;
  activeConnectionId?: string | null;
  onWireSelect?: (wire: WireRoute) => void;
  onWireHover?: (wire: WireRoute | null) => void;
  onWiringWarnings?: (warnings: readonly WiringWarning[], layout: WiringLayout) => void;
  /** Render parts in wireframe mode. */
  wireframe?: boolean;
  /** Render catalog mounting frame markers on parts. */
  showMounts?: boolean;
  /** Show floor millimeter grid. */
  showGrid?: boolean;
  /** Show debug telemetry overlay in the corner of the stage. */
  showDebugOverlay?: boolean;
  /** Stage lighting/color theme preset or custom overrides. */
  themeMode?: 'dark' | 'light';
  themeOverrides?: Partial<StageTheme>;
  /** Camera angle preset (`DEFAULT_VIEW` hero angle by default). */
  cameraView?: CameraView;
  /** Signal to reset/re-fit camera. */
  resetSignal?: unknown;
  /** Pause WebGL render loop when hidden or when the Simulator canvas is active. */
  active?: boolean;
  /** How non-isolated parts are rendered when an instance is isolated (`ghost` or `hide`). */
  isolatedOutBehavior?: 'ghost' | 'hide';
  className?: string;
  style?: CSSProperties;
}

export function RoverScene({
  plan,
  catalog,
  selection: externalSelection,
  assemblyMode = 'assembled',
  assemblyProgress = 1,
  assemblyStep = 0,
  ghostFutureSteps = true,
  previousStepsDisplay = 'solid',
  assemblyView: externalAssemblyView,
  showWiring = false,
  wiringFilter = null,
  activeConnectionId,
  onWireSelect,
  onWireHover,
  onWiringWarnings,
  wireframe = false,
  showMounts = false,
  showGrid = true,
  showDebugOverlay = false,
  themeMode = 'dark',
  themeOverrides,
  cameraView = DEFAULT_VIEW,
  resetSignal,
  active = true,
  isolatedOutBehavior = 'ghost',
  className,
  style,
}: RoverSceneProps) {
  const catalogById = useMemo(
    () => new Map(catalog.map((c) => [c.catalog_id, c])),
    [catalog],
  );

  const labelResolver = useCallback(
    (comp: { instance_id: string; catalog_id: string; role: string }) => {
      const item = catalogById.get(comp.catalog_id);
      const model = item?.identity?.model ?? comp.catalog_id;
      return `${model} (${comp.instance_id})`;
    },
    [catalogById],
  );

  const internalSelection = usePartSelection(plan, { getLabel: labelResolver });
  const selection = externalSelection ?? internalSelection;

  const dimensionsByCatalogId = useMemo(
    () => buildDimensionsByCatalogId(catalog),
    [catalog],
  );

  const computedView = useMemo(
    () =>
      externalAssemblyView ??
      computeAssemblyView(plan, {
        mode: assemblyMode,
        progress: assemblyProgress,
        step: assemblyStep,
        ghostFuture: ghostFutureSteps,
        previous: previousStepsDisplay,
        dimensionsByCatalogId,
      }),
    [
      externalAssemblyView,
      plan,
      assemblyMode,
      assemblyProgress,
      assemblyStep,
      ghostFutureSteps,
      previousStepsDisplay,
      dimensionsByCatalogId,
    ],
  );

  const [wireHighlightedIds, setWireHighlightedIds] = useState<string[]>([]);
  const [hoveredWire, setHoveredWire] = useState<WireRoute | null>(null);

  const { poseOverrides, visibilityMap, positionOverridesMm, highlightedIds, counts } = useMemo(() => {
    const poses: Record<string, PoseOverride> = {};
    const vis: Record<string, PartVisibility> = {};
    const posMm: Record<string, readonly [number, number, number]> = {};
    const highlights = new Set<string>(wireHighlightedIds);
    let visibleCount = 0;
    let ghostCount = 0;
    let hiddenCount = 0;

    for (const comp of plan.components) {
      const id = comp.instance_id;
      const asmItem = computedView.byInstanceId[id];
      const selVisual = selection.getVisualState(id);

      const displayPos: [number, number, number] = asmItem
        ? [asmItem.display_position_mm[0], asmItem.display_position_mm[1], asmItem.display_position_mm[2]]
        : [comp.pose.position_mm[0], comp.pose.position_mm[1], comp.pose.position_mm[2]];
      const displayRot: [number, number, number] = asmItem
        ? [asmItem.rotation_deg[0], asmItem.rotation_deg[1], asmItem.rotation_deg[2]]
        : [comp.pose.rotation_deg[0], comp.pose.rotation_deg[1], comp.pose.rotation_deg[2]];

      poses[id] = { position_mm: displayPos, rotation_deg: displayRot };
      posMm[id] = displayPos;

      let partVis: PartVisibility = 'visible';
      if (
        comp.render_overrides?.visible === false ||
        selVisual.hidden ||
        asmItem?.visibility === 'hidden'
      ) {
        partVis = 'hidden';
        hiddenCount++;
      } else if (selVisual.isolated_out) {
        if (isolatedOutBehavior === 'ghost') {
          partVis = 'ghost';
          ghostCount++;
        } else {
          partVis = 'hidden';
          hiddenCount++;
        }
      } else if (asmItem?.visibility === 'ghost') {
        partVis = 'ghost';
        ghostCount++;
      } else {
        partVis = 'visible';
        visibleCount++;
      }
      vis[id] = partVis;

      if (asmItem?.highlighted) {
        highlights.add(id);
      }
    }

    return {
      poseOverrides: poses,
      visibilityMap: vis,
      positionOverridesMm: posMm,
      highlightedIds: highlights,
      counts: { visibleCount, ghostCount, hiddenCount },
    };
  }, [plan.components, computedView, selection, isolatedOutBehavior, wireHighlightedIds]);

  const boundsMm = useMemo(() => {
    const isolatedId = selection.state.isolated_instance_id;
    const focusIds = isolatedId ? [isolatedId] : null;
    return computePlanBoundsMm(plan, catalog, {
      instanceIds: focusIds,
      positionOverridesMm,
    });
  }, [plan, catalog, selection.state.isolated_instance_id, positionOverridesMm]);

  const wiringPlan = useMemo<WiringPlanInput>(() => {
    const visibleComponents = plan.components
      .filter((c) => visibilityMap[c.instance_id] !== 'hidden')
      .map((c) => ({
        instance_id: c.instance_id,
        catalog_id: c.catalog_id,
        role: c.role,
        pose: {
          position_mm: positionOverridesMm[c.instance_id] ?? c.pose.position_mm,
          rotation_deg: c.pose.rotation_deg,
        },
      }));
    const visibleSet = new Set(visibleComponents.map((c) => c.instance_id));
    const connections = plan.connections
      .filter(
        (conn) =>
          conn.kind !== 'electrical' ||
          (visibleSet.has(conn.from.instance_id) && visibleSet.has(conn.to.instance_id)),
      )
      .map((conn) => ({
        connection_id: conn.connection_id,
        kind: conn.kind,
        from: {
          instance_id: conn.from.instance_id,
          port_id: conn.from.port_id ?? '',
        },
        to: {
          instance_id: conn.to.instance_id,
          port_id: conn.to.port_id ?? '',
        },
        net_name: conn.net_name ?? null,
        notes: conn.notes ?? null,
      }));
    return {
      build_id: plan.build_id,
      revision: plan.revision,
      components: visibleComponents,
      connections,
    };
  }, [plan, visibilityMap, positionOverridesMm]);

  const handlePartSelect = useCallback(
    (event: PartSelectEvent) => {
      selection.select(event.instanceId, { reason: 'pointer' });
    },
    [selection],
  );

  const handlePartHover = useCallback(
    (instanceId: string | null) => {
      if (instanceId) {
        selection.controller.hover(instanceId);
      } else {
        selection.controller.clearHover();
      }
    },
    [selection.controller],
  );

  const handleWireSelect = useCallback(
    (wire: WireRoute) => {
      onWireSelect?.(wire);
      selection.select(wire.from.instance_id, { reason: 'pointer', reveal: true });
    },
    [onWireSelect, selection],
  );

  const handleWireHover = useCallback(
    (wire: WireRoute | null) => {
      setHoveredWire(wire);
      onWireHover?.(wire);
    },
    [onWireHover],
  );

  const baseTheme = themeMode === 'light' ? studioLightStageTheme : graphiteStageTheme;
  const mergedTheme = useMemo(
    () => (themeOverrides ? { ...baseTheme, ...themeOverrides } : baseTheme),
    [baseTheme, themeOverrides],
  );

  const selectedIdsForWiring = useMemo(
    () => (selection.selectedInstanceId ? [selection.selectedInstanceId] : []),
    [selection.selectedInstanceId],
  );

  return (
    <div
      className={className}
      data-testid="rover-scene"
      data-build-id={plan.build_id}
      data-revision={plan.revision}
      data-assembly-mode={computedView.mode}
      style={{ position: 'relative', width: '100%', height: '100%', minHeight: 320, ...style }}
    >
      <PartSelectionProvider value={selection.context}>
        <RivetStage
          boundsMm={boundsMm}
          resetSignal={resetSignal}
          active={active}
          showGrid={showGrid}
          view={cameraView}
          theme={mergedTheme}
          onCanvasPointerDown={selection.canvasProps.onPointerDown}
          onBackgroundClick={selection.canvasProps.onPointerMissed}
          label={`3D assembly studio for ${plan.title} (${plan.build_id} rev ${plan.revision})`}
        >
          <PartAssembly
            plan={plan}
            catalog={catalog}
            selectedInstanceId={selection.selectedInstanceId}
            highlightedInstanceIds={highlightedIds}
            wireframe={wireframe}
            showMounts={showMounts}
            visibility={visibilityMap}
            poseOverrides={poseOverrides}
            onSelect={handlePartSelect}
            onHover={handlePartHover}
          />
          {showWiring ? (
            <WiringOverlay
              plan={wiringPlan}
              catalog={catalog as unknown as readonly WiringCatalogComponent[]}
              visible={showWiring}
              filter={wiringFilter}
              selectedInstanceIds={selectedIdsForWiring}
              activeConnectionId={activeConnectionId}
              showLabels
              showStatus={false}
              unitsPerMm={1}
              onWireHover={handleWireHover}
              onWireSelect={handleWireSelect}
              onHighlightInstances={setWireHighlightedIds}
              onWarnings={onWiringWarnings}
            />
          ) : null}
        </RivetStage>
      </PartSelectionProvider>

      {/* Hover Tooltip Pill */}
      {(selection.hoverLabel || hoveredWire) && (
        <div
          role="status"
          aria-live="polite"
          data-testid="scene-hover-tooltip"
          style={{
            position: 'absolute',
            left: 14,
            bottom: 14,
            zIndex: 15,
            pointerEvents: 'none',
            background: 'rgba(15, 17, 22, 0.88)',
            border: '1px solid rgba(255, 255, 255, 0.14)',
            borderRadius: 6,
            padding: '6px 10px',
            color: '#f4f4f5',
            fontSize: 12,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.35)',
          }}
        >
          {hoveredWire ? (
            <span>
              <strong style={{ color: hoveredWire.color }}>●</strong> Wire {hoveredWire.connection_id}:{' '}
              {hoveredWire.from.instance_id}:{hoveredWire.from.port_id} → {hoveredWire.to.instance_id}:
              {hoveredWire.to.port_id} ({hoveredWire.signal_label})
            </span>
          ) : (
            <span>
              <strong>{selection.hoverLabel}</strong>
              {selection.hoveredComponent ? ` · role: ${selection.hoveredComponent.role}` : ''}
            </span>
          )}
        </div>
      )}

      {/* Isolation Banner */}
      {selection.state.isolated_instance_id && (
        <div
          data-testid="scene-isolation-banner"
          style={{
            position: 'absolute',
            top: 12,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 15,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            background: 'rgba(30, 58, 138, 0.9)',
            border: '1px solid rgba(96, 165, 250, 0.5)',
            borderRadius: 999,
            padding: '5px 14px',
            color: '#eff6ff',
            fontSize: 12,
          }}
        >
          <span>
            Isolated: <code>{selection.state.isolated_instance_id}</code>
          </span>
          <button
            type="button"
            onClick={() => selection.exitIsolation()}
            data-testid="scene-exit-isolation"
            style={{
              background: 'rgba(255,255,255,0.16)',
              border: 'none',
              borderRadius: 999,
              padding: '2px 8px',
              color: '#ffffff',
              cursor: 'pointer',
              fontSize: 11,
            }}
          >
            Show all
          </button>
        </div>
      )}

      {/* Debug Telemetry Overlay */}
      {showDebugOverlay && (
        <div
          data-testid="scene-debug-overlay"
          style={{
            position: 'absolute',
            right: 12,
            bottom: 12,
            zIndex: 15,
            pointerEvents: 'none',
            background: 'rgba(12, 14, 18, 0.86)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: 6,
            padding: '8px 10px',
            color: '#cbd5e1',
            fontSize: 11,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            lineHeight: 1.45,
          }}
        >
          <div>
            Build: {plan.build_id} @ r{plan.revision} ({plan.provenance.generation_mode})
          </div>
          <div>
            Parts: {plan.components.length} total ({counts.visibleCount} visible, {counts.ghostCount} ghost,{' '}
            {counts.hiddenCount} hidden)
          </div>
          <div>
            Mode: {computedView.mode}
            {computedView.mode === 'step'
              ? ` · step ${computedView.stepIndex}/${computedView.stepCount}`
              : computedView.mode === 'exploded'
                ? ` · explode ${Math.round(computedView.progress * 100)}%`
                : ''}
          </div>
          {boundsMm && (
            <div>
              Bounds (mm): [{boundsMm.min.map((n) => Math.round(n)).join(', ')}] → [
              {boundsMm.max.map((n) => Math.round(n)).join(', ')}]
            </div>
          )}
        </div>
      )}
    </div>
  );
}
