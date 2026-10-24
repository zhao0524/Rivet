'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStudioPlanStore, type StudioActionMode } from '../../lib/plan-store';
import type { RivetDataSource } from '../../lib/rivet';
import { SimView } from '../sim';
import { RoverScene } from '../three/RoverScene';
import {
  computeAssemblyView,
  scrubToStep,
  type AssemblyMode,
} from '../three/assembly';
import { usePartSelection } from '../three/interactions';
import { DEFAULT_VIEW, type CameraView } from '../three/stage';
import { useWiringOverlayState } from '../three/wiring';
import { Inspector, type InspectorTab } from './Inspector';
import { PartsPanel } from './PartsPanel';
import { StepTimeline } from './StepTimeline';
import { StudioShell } from './StudioShell';
import { Toolbar } from './Toolbar';
import { BuildIntake } from './intake';
import { buildDimensionsByCatalogId } from '../../lib/geometry';

export interface StudioProps {
  initialDataSource?: RivetDataSource;
  initialMode?: StudioActionMode;
  initialIntakeOpen?: boolean;
}

export function Studio({
  initialDataSource,
  initialMode = 'design',
  initialIntakeOpen = false,
}: StudioProps) {
  const store = useStudioPlanStore({ initialDataSource, initialMode });
  const { plan, catalog, trust, activeMode, setActiveMode } = store;

  const [intakeOpen, setIntakeOpen] = useState(initialIntakeOpen);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('part');

  // 3D Stage & Assembly Timeline State
  const [assemblyMode, setAssemblyMode] = useState<AssemblyMode>('assembled');
  const [explodeAmount, setExplodeAmount] = useState<number>(0);
  const [scrubPosition, setScrubPosition] = useState<number>(plan.assembly_steps.length);
  const [timelinePlaying, setTimelinePlaying] = useState<boolean>(false);
  const [ghostFutureSteps, setGhostFutureSteps] = useState<boolean>(true);

  // Camera & Visual Toggles
  const [cameraView, setCameraView] = useState<CameraView>(DEFAULT_VIEW);
  const [resetTick, setResetTick] = useState<number>(0);
  const [showMounts, setShowMounts] = useState<boolean>(false);
  const [wireframe, setWireframe] = useState<boolean>(false);
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [showDebug, setShowDebug] = useState<boolean>(false);
  const [themeMode, setThemeMode] = useState<'dark' | 'light'>('dark');

  const wiringState = useWiringOverlayState({ visible: false });

  // Reset timeline scrub position to full assembly when a new build/revision loads
  useEffect(() => {
    setScrubPosition(plan.assembly_steps.length);
    setTimelinePlaying(false);
  }, [plan.build_id, plan.revision, plan.assembly_steps.length]);

  // Synchronize Bottom Action Mode with Scene / Inspector views
  const handleModeChange = useCallback(
    (nextMode: StudioActionMode) => {
      setActiveMode(nextMode);
      if (nextMode === 'wiring') {
        wiringState.setVisible(true);
        setInspectorTab('wiring');
      } else if (nextMode === 'assemble') {
        setAssemblyMode('step');
      } else if (nextMode === 'inspect') {
        setInspectorTab(
          selection.selectedInstanceId ? 'part' : 'bom',
        );
      } else if (nextMode === 'design') {
        setAssemblyMode(explodeAmount > 0 ? 'exploded' : 'assembled');
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setActiveMode, wiringState, explodeAmount],
  );

  const catalogById = useMemo(
    () => new Map(catalog.map((c) => [c.catalog_id, c])),
    [catalog],
  );

  const selection = usePartSelection(plan, {
    getLabel: (comp) => {
      const entry = catalogById.get(comp.catalog_id);
      return `${entry?.identity?.model ?? comp.catalog_id} (${comp.instance_id})`;
    },
  });

  const handleSelectInstance = useCallback(
    (instanceId: string) => {
      selection.select(instanceId, { reason: 'api', reveal: true });
      if (inspectorTab !== 'part' && inspectorTab !== 'bom') {
        setInspectorTab('part');
      }
    },
    [selection, inspectorTab],
  );

  const stepPos = useMemo(
    () => scrubToStep(scrubPosition, plan.assembly_steps.length),
    [scrubPosition, plan.assembly_steps.length],
  );

  const dimensionsByCatalogId = useMemo(
    () => buildDimensionsByCatalogId(catalog),
    [catalog],
  );

  const assemblyView = useMemo(
    () =>
      computeAssemblyView(plan, {
        mode: assemblyMode,
        progress: assemblyMode === 'exploded' ? explodeAmount : stepPos.progress,
        step: stepPos.step,
        ghostFuture: ghostFutureSteps,
        dimensionsByCatalogId,
      }),
    [plan, assemblyMode, explodeAmount, stepPos, ghostFutureSteps, dimensionsByCatalogId],
  );

  const isSelectedHidden = selection.selectedInstanceId
    ? selection.state.hidden_instance_ids.has(selection.selectedInstanceId)
    : false;

  const headerNode = (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Link
          href="/"
          style={{
            color: '#f8fafc',
            textDecoration: 'none',
            fontWeight: 700,
            fontSize: 16,
            letterSpacing: '-0.02em',
          }}
        >
          RIVET
        </Link>
        <span style={{ color: '#475569' }}>/</span>
        <div>
          <span
            data-testid="studio-build-title"
            style={{ fontWeight: 600, fontSize: 14, color: '#f1f5f9' }}
          >
            {plan.title}
          </span>
          <span
            data-testid="studio-build-identity"
            style={{
              marginLeft: 8,
              fontSize: 12,
              color: '#94a3b8',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            }}
          >
            {plan.build_id} · rev {plan.revision} · status: {plan.status}
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        {/* Data Source Mode Toggle (Fixture vs Live HTTP API) */}
        <div
          role="group"
          aria-label="Data source mode"
          data-testid="datasource-toggle"
          style={{
            display: 'inline-flex',
            background: '#181c26',
            border: '1px solid #283040',
            borderRadius: 6,
            padding: 2,
          }}
        >
          <button
            type="button"
            data-testid="datasource-mode-fixture"
            aria-pressed={store.sourceMode === 'fixture'}
            onClick={() => void store.setSourceMode('fixture')}
            style={{
              background: store.sourceMode === 'fixture' ? '#2563eb' : 'transparent',
              color: store.sourceMode === 'fixture' ? '#ffffff' : '#94a3b8',
              border: 'none',
              borderRadius: 4,
              padding: '3px 8px',
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            Fixture Mode
          </button>
          <button
            type="button"
            data-testid="datasource-mode-http"
            aria-pressed={store.sourceMode === 'http'}
            onClick={() => void store.setSourceMode('http')}
            style={{
              background: store.sourceMode === 'http' ? '#2563eb' : 'transparent',
              color: store.sourceMode === 'http' ? '#ffffff' : '#94a3b8',
              border: 'none',
              borderRadius: 4,
              padding: '3px 8px',
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            Live API Mode
          </button>
        </div>

        <button
          type="button"
          data-testid="header-toggle-intake"
          aria-expanded={intakeOpen}
          onClick={() => setIntakeOpen((o) => !o)}
          style={{
            background: intakeOpen ? '#1e3a8a' : '#181c26',
            color: '#e2e8f0',
            border: '1px solid #3b82f6',
            borderRadius: 6,
            padding: '4px 10px',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          {intakeOpen ? 'Close intake' : 'Upload / Prompt'}
        </button>
      </div>
    </div>
  );

  const bannerNode = (
    <div
      role="status"
      data-testid="provenance-trust-banner"
      data-trust-label={trust.label}
      data-synthetic={trust.isSynthetic ? 'true' : 'false'}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        fontSize: 12,
        color: trust.isSynthetic ? '#fde68a' : '#bae6fd',
      }}
    >
      <div>
        <strong>{trust.label}</strong>
        {trust.reasons.length > 0 ? ` — ${trust.reasons.join(' · ')}` : ''}
      </div>
      {store.contractError && (
        <span role="alert" data-testid="studio-contract-error" style={{ color: '#fca5a5' }}>
          Contract error: {store.contractError}
        </span>
      )}
    </div>
  );

  const intakeJob = useMemo(() => {
    if (!store.job) return null;
    const err = store.job.error;
    return {
      ...store.job,
      error:
        typeof err === 'string'
          ? { code: 'JOB_ERROR', message: err }
          : err ?? null,
    };
  }, [store.job]);

  const intakeNode = intakeOpen ? (
    <BuildIntake
      onUpload={store.uploadImage}
      onGenerate={store.startGeneration}
      job={intakeJob}
      events={store.jobEvents}
      onCancelJob={store.cancelJob}
      savedExamples={store.savedExamples}
      onLoadSavedExample={(id) => {
        void store.loadSavedExample(id);
      }}
      loadedExampleId={store.loadedExampleId}
      currency={plan.bom.currency || 'USD'}
    />
  ) : null;

  const toolbarNode =
    activeMode !== 'simulate' ? (
      <Toolbar
        assemblyMode={assemblyMode}
        explodeAmount={explodeAmount}
        onAssemblyModeChange={(mode) => {
          setTimelinePlaying(false);
          setAssemblyMode(mode);
          if (mode === 'exploded' && explodeAmount === 0) {
            setExplodeAmount(0.75);
          }
        }}
        onExplodeAmountChange={setExplodeAmount}
        selectedInstanceId={selection.selectedInstanceId}
        isolatedInstanceId={selection.state.isolated_instance_id}
        hiddenCount={selection.state.hidden_instance_ids.size}
        isSelectedHidden={isSelectedHidden}
        onFitCamera={() => setResetTick((t) => t + 1)}
        onSelectCameraPreset={(view) => {
          setCameraView(view);
          setResetTick((t) => t + 1);
        }}
        onToggleIsolateSelected={() => selection.isolate()}
        onExitIsolation={() => selection.exitIsolation()}
        onToggleHideSelected={() => {
          if (selection.selectedInstanceId) {
            selection.toggleHidden(selection.selectedInstanceId);
          }
        }}
        onShowAllHidden={() => selection.showAll()}
        showWiring={wiringState.state.visible}
        onToggleWiring={wiringState.toggle}
        showMounts={showMounts}
        onToggleMounts={() => setShowMounts((m) => !m)}
        wireframe={wireframe}
        onToggleWireframe={() => setWireframe((w) => !w)}
        showGrid={showGrid}
        onToggleGrid={() => setShowGrid((g) => !g)}
        showDebug={showDebug}
        onToggleDebug={() => setShowDebug((d) => !d)}
        themeMode={themeMode}
        onToggleTheme={() => setThemeMode((t) => (t === 'dark' ? 'light' : 'dark'))}
      />
    ) : null;

  const sceneNode = (
    <RoverScene
      plan={plan}
      catalog={catalog}
      selection={selection}
      assemblyView={assemblyView}
      showWiring={wiringState.state.visible}
      wiringFilter={wiringState.state.filter}
      activeConnectionId={wiringState.state.active_connection_id}
      onWireSelect={(w) => {
        wiringState.setActive(w.connection_id);
        setInspectorTab('wiring');
      }}
      wireframe={wireframe}
      showMounts={showMounts}
      showGrid={showGrid}
      showDebugOverlay={showDebug}
      themeMode={themeMode}
      cameraView={cameraView}
      resetSignal={resetTick}
      active={activeMode !== 'simulate'}
    />
  );

  const timelineNode =
    activeMode !== 'simulate' ? (
      <StepTimeline
        plan={plan}
        assemblyMode={assemblyMode}
        scrubPosition={scrubPosition}
        playing={timelinePlaying}
        explodeAmount={explodeAmount}
        ghostFutureSteps={ghostFutureSteps}
        selectedInstanceId={selection.selectedInstanceId}
        onScrubChange={(pos) => {
          setAssemblyMode('step');
          setScrubPosition(pos);
        }}
        onPlayingChange={(play) => {
          if (play) setAssemblyMode('step');
          setTimelinePlaying(play);
        }}
        onExplodeChange={(exp) => {
          setTimelinePlaying(false);
          setExplodeAmount(exp);
          setAssemblyMode(exp > 0 ? 'exploded' : 'assembled');
        }}
        onGhostFutureChange={setGhostFutureSteps}
        onResetToFullAssembly={() => {
          setTimelinePlaying(false);
          setExplodeAmount(0);
          setScrubPosition(plan.assembly_steps.length);
          setAssemblyMode('assembled');
        }}
        onSelectInstance={handleSelectInstance}
      />
    ) : null;

  const simNode =
    activeMode === 'simulate' ? (
      <div style={{ padding: 12 }}>
        <SimView plan={plan} height={460} />
      </div>
    ) : null;

  const sidebarNode = (
    <PartsPanel
      plan={plan}
      catalog={catalog}
      revisions={store.revisions}
      selection={selection}
      revisionPending={store.loading}
      revisionError={store.revisionError}
      onSelectRevision={(rev) => void store.loadBuild(plan.build_id, rev)}
      editPending={store.editPending}
      lastEditResponse={store.lastEditResponse}
      editError={store.editError}
      onSubmitEdit={store.submitEdit}
      onOpenIntake={() => setIntakeOpen(true)}
    />
  );

  const inspectorNode = (
    <Inspector
      plan={plan}
      catalog={catalog}
      selectedInstanceId={selection.selectedInstanceId}
      onSelectInstance={handleSelectInstance}
      activeTab={inspectorTab}
      onTabChange={setInspectorTab}
      wiringFilter={wiringState.state.filter}
      onToggleSignalFilter={wiringState.toggleSignal}
      onClearWiringFilter={wiringState.clearFilter}
      activeConnectionId={wiringState.state.active_connection_id}
      onSelectConnectionId={wiringState.setActive}
      dataSource={store.dataSource}
      estelleStatus={store.estelleStatus}
      estelleGroundResult={store.estelleGroundResult}
      estelleLoading={store.estelleLoading}
      estelleError={store.estelleError}
      onGroundSymbol={store.runEstelleGround}
    />
  );

  return (
    <StudioShell
      header={headerNode}
      banner={bannerNode}
      intakeOverlay={intakeNode}
      toolbar={toolbarNode}
      sidebar={sidebarNode}
      scene={sceneNode}
      timeline={timelineNode}
      bottomPanel={simNode}
      inspector={inspectorNode}
      mode={activeMode}
      onModeChange={handleModeChange}
    />
  );
}
