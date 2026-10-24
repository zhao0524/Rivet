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
import { Dialog } from '../ui/Dialog';
import { ExportPanel } from './ExportPanel';
import { Inspector } from './Inspector';
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
  const [exportOpen, setExportOpen] = useState(false);

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

  // The studio mode is the single navigation: it decides the scene state and what the
  // right panel shows. Selection and revision are untouched by mode switches.
  const handleModeChange = useCallback(
    (nextMode: StudioActionMode) => {
      setActiveMode(nextMode);
      if (nextMode === 'wiring') {
        wiringState.setVisible(true);
      } else if (nextMode === 'assemble') {
        setAssemblyMode('step');
      } else if (nextMode === 'design') {
        setAssemblyMode(explodeAmount > 0 ? 'exploded' : 'assembled');
      }
    },
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
    },
    [selection],
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

  const selectedComponent = selection.selectedInstanceId
    ? plan.components.find((c) => c.instance_id === selection.selectedInstanceId)
    : undefined;
  const selectedLabel = selectedComponent
    ? catalogById.get(selectedComponent.catalog_id)?.identity?.model ?? selectedComponent.instance_id
    : null;

  const isSelectedHidden = selection.selectedInstanceId
    ? selection.state.hidden_instance_ids.has(selection.selectedInstanceId)
    : false;

  const headerNode = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
      <Link
        href="/"
        style={{
          flex: 'none',
          color: 'var(--rv-text-strong)',
          textDecoration: 'none',
          fontWeight: 700,
          fontSize: 'var(--rv-text-title)',
          letterSpacing: '-0.02em',
        }}
      >
        RIVET
      </Link>
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', lineHeight: 1.25 }}>
        <span
          data-testid="studio-build-title"
          title={plan.title}
          style={{
            fontWeight: 600,
            fontSize: 'var(--rv-text-section)',
            color: 'var(--rv-text-strong)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {plan.title}
        </span>
        <span
          data-testid="studio-build-identity"
          style={{
            fontSize: 11,
            color: 'var(--rv-text-muted)',
            fontFamily: 'var(--rv-font-mono)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {plan.build_id} · rev {plan.revision} · status: {plan.status}
        </span>
      </div>
    </div>
  );

  const headerActionsNode = (
    <>
      {/* Data Source Mode Toggle (Fixture vs Live HTTP API) */}
      <div
        role="group"
        aria-label="Data source mode"
        data-testid="datasource-toggle"
        className="rv-hide-phone"
        style={{
          display: 'inline-flex',
          background: 'var(--rv-bg)',
          border: '1px solid var(--rv-border)',
          borderRadius: 'var(--rv-radius-sm)',
          padding: 2,
        }}
      >
        <button
          type="button"
          data-testid="datasource-mode-fixture"
          aria-pressed={store.sourceMode === 'fixture'}
          onClick={() => void store.setSourceMode('fixture')}
          className="rv-btn rv-btn--ghost"
          style={{ minHeight: 24, padding: '2px 8px' }}
        >
          Fixture
        </button>
        <button
          type="button"
          data-testid="datasource-mode-http"
          aria-pressed={store.sourceMode === 'http'}
          onClick={() => void store.setSourceMode('http')}
          className="rv-btn rv-btn--ghost"
          style={{ minHeight: 24, padding: '2px 8px' }}
        >
          Live API
        </button>
      </div>
      <button
        type="button"
        className="rv-btn"
        data-testid="header-open-export"
        aria-haspopup="dialog"
        onClick={() => setExportOpen(true)}
      >
        Export
      </button>
      <button
        type="button"
        className="rv-btn rv-btn--primary"
        data-testid="header-toggle-intake"
        aria-expanded={intakeOpen}
        onClick={() => setIntakeOpen((o) => !o)}
      >
        {intakeOpen ? 'Close intake' : 'New build'}
      </button>
    </>
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
        color: trust.isSynthetic ? 'var(--rv-warn-text)' : '#bae6fd',
      }}
    >
      <div
        title={trust.reasons.join(' · ')}
        style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >
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
        selectedLabel={selectedLabel}
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
        setActiveMode('wiring');
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
    activeMode === 'assemble' ? (
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
      <div style={{ padding: 12, height: '100%', overflowY: 'auto' }}>
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
      mode={activeMode}
      selectedInstanceId={selection.selectedInstanceId}
      onSelectInstance={handleSelectInstance}
      wiringFilter={wiringState.state.filter}
      onToggleSignalFilter={wiringState.toggleSignal}
      onClearWiringFilter={wiringState.clearFilter}
      activeConnectionId={wiringState.state.active_connection_id}
      onSelectConnectionId={wiringState.setActive}
      activeStep={assemblyMode === 'step' ? stepPos.step : 0}
      onSelectStep={(step) => {
        setTimelinePlaying(false);
        setAssemblyMode('step');
        setScrubPosition(step);
      }}
    />
  );

  return (
    <>
    <StudioShell
      header={headerNode}
      headerActions={headerActionsNode}
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
      inspectorOpenSignal={selection.selectedInstanceId}
    />
    <Dialog
      open={exportOpen}
      onClose={() => setExportOpen(false)}
      title="Export build package"
      wide
      testId="export-dialog"
    >
      <ExportPanel
        plan={plan}
        dataSource={store.dataSource}
        estelleStatus={store.estelleStatus}
        estelleGroundResult={store.estelleGroundResult}
        estelleLoading={store.estelleLoading}
        estelleError={store.estelleError}
        onGroundSymbol={store.runEstelleGround}
      />
    </Dialog>
    </>
  );
}
