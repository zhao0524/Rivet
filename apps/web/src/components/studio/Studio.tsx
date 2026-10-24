'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStudioPlanStore, type StudioActionMode } from '../../lib/plan-store';
import { getSyntheticRoverIntent } from '../../lib/fixtures';
import type { BuildStatus, IntentSpec, RivetDataSource } from '../../lib/rivet';
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
import { MenuButton } from '../ui/MenuButton';
import { ExportPanel } from './ExportPanel';
import { Inspector } from './Inspector';
import { PartsPanel, type BuildRequestSummary } from './PartsPanel';
import type { GenerateRequest } from './intake';
import { StepTimeline } from './StepTimeline';
import { StudioShell } from './StudioShell';
import { Toolbar } from './Toolbar';
import { BuildIntake } from './intake';
import { buildDimensionsByCatalogId } from '../../lib/geometry';
import type { ResolveOutcome } from '../../lib/resolve/types';
import { ResolveDialogBody } from './resolve/ResolveDialogBody';
import type { OfferFixtureName } from '../../lib/offers/fixtures';
import { OffersDialogBody } from './offers/OffersDialogBody';

export interface StudioProps {
  initialDataSource?: RivetDataSource;
  initialMode?: StudioActionMode;
  initialIntakeOpen?: boolean;
  /** Which intake input gets focus when it opens initially (landing page "Describe a build" = prompt). */
  initialIntakeFocus?: 'image' | 'prompt';
  /** Show developer controls: data source switch, render stats, raw build id and revision (#54). */
  devMode?: boolean;
  /** Open the product-match dialog; in fixture mode it shows the saved example for this outcome. */
  initialResolveOutcome?: ResolveOutcome | null;
  /** Open the saved offers example with this fixture (fixture mode only). */
  initialOffersFixture?: OfferFixtureName | null;
}

const SAVED_INTENT: IntentSpec = getSyntheticRoverIntent();

function describeConstraints(requirements: {
  max_budget?: string | number | null;
  currency?: string | null;
  required_capabilities?: readonly string[];
} | null | undefined): string[] {
  if (!requirements) return [];
  const out = [
    requirements.max_budget != null
      ? `Budget up to ${requirements.max_budget} ${requirements.currency ?? ''}`.trim()
      : 'No budget limit',
  ];
  for (const capability of requirements.required_capabilities ?? []) {
    const words = capability.replace(/_/g, ' ');
    out.push(words.charAt(0).toUpperCase() + words.slice(1));
  }
  return out;
}

const STATUS_CHIP: Record<BuildStatus, { label: string; tone: 'ok' | 'warn' | 'bad' }> = {
  verified: { label: 'Verified', tone: 'ok' },
  verified_with_warnings: { label: 'Verified with warnings', tone: 'warn' },
  needs_review: { label: 'Needs review', tone: 'warn' },
  unbuildable: { label: 'Unbuildable', tone: 'bad' },
};

export function Studio({
  initialDataSource,
  initialMode = 'design',
  initialIntakeOpen = false,
  initialIntakeFocus = 'image',
  devMode = false,
  initialResolveOutcome = null,
  initialOffersFixture = null,
}: StudioProps) {
  const store = useStudioPlanStore({ initialDataSource, initialMode });
  const { plan, catalog, trust, activeMode, setActiveMode } = store;

  const [intakeOpen, setIntakeOpen] = useState(initialIntakeOpen);
  const [exportOpen, setExportOpen] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [offersOpen, setOffersOpen] = useState(false);
  // Opened after mount: the dialog portal must not render during hydration.
  useEffect(() => {
    if (initialResolveOutcome !== null) setResolveOpen(true);
    if (initialOffersFixture !== null) setOffersOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [trustDetailsOpen, setTrustDetailsOpen] = useState(false);

  // What was asked for in this session, so the left panel can show the prompt and image (#56).
  const uploadPreviews = useRef(new Map<string, string>());
  const [lastGeneration, setLastGeneration] = useState<{
    request: GenerateRequest;
    imageUrl: string | null;
    buildId: string | null;
  } | null>(null);
  useEffect(() => {
    const builtId = store.job?.status === 'complete' ? store.job.build_id : null;
    if (builtId) setLastGeneration((g) => (g && !g.buildId ? { ...g, buildId: builtId } : g));
  }, [store.job?.status, store.job?.build_id]);

  // Intake closes into the studio once the generated build is the one on screen.
  useEffect(() => {
    if (intakeOpen && store.job?.status === 'complete' && store.job.build_id === plan.build_id) {
      setIntakeOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.job?.status, store.job?.build_id, plan.build_id]);

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

  const statusChip = STATUS_CHIP[plan.status] ?? { label: plan.status, tone: 'warn' as const };

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
        {devMode ? (
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
        ) : null}
      </div>
      <span
        data-testid="studio-status-chip"
        data-status={plan.status}
        className={`rv-badge rv-badge--${statusChip.tone} rv-hide-phone`}
        title={`Build status: ${statusChip.label}`}
      >
        {statusChip.label}
      </span>
    </div>
  );

  const headerActionsNode = (
    <>
      {devMode ? (
        <MenuButton
          label="Developer"
          testId="developer-menu"
          buttonClassName="rv-btn rv-hide-phone"
          entries={[
            {
              id: 'fixture',
              label: 'Data: checked-in fixtures',
              checked: store.sourceMode === 'fixture',
              onSelect: () => void store.setSourceMode('fixture'),
              testId: 'datasource-mode-fixture',
            },
            {
              id: 'http',
              label: 'Data: live API',
              checked: store.sourceMode === 'http',
              onSelect: () => void store.setSourceMode('http'),
              testId: 'datasource-mode-http',
            },
            { kind: 'separator', id: 'sep' },
            {
              id: 'stats',
              label: 'Render stats overlay',
              checked: showDebug,
              onSelect: () => setShowDebug((d) => !d),
              testId: 'dev-toggle-stats',
            },
          ]}
        />
      ) : null}
      <button
        type="button"
        className="rv-btn rv-hide-phone"
        data-testid="header-open-resolve"
        aria-haspopup="dialog"
        onClick={() => setResolveOpen(true)}
      >
        Product match
      </button>
      {store.sourceMode === 'fixture' ? (
        <button
          type="button"
          className="rv-btn rv-hide-phone"
          data-testid="header-open-offers"
          aria-haspopup="dialog"
          onClick={() => setOffersOpen(true)}
        >
          Offers example
        </button>
      ) : null}
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
        aria-haspopup="dialog"
        aria-expanded={intakeOpen}
        onClick={() => setIntakeOpen(true)}
      >
        New build
      </button>
    </>
  );

  const blockingFindings = plan.verification.findings.filter(
    (f) => f.severity === 'blocking' && (f.result === 'FAIL' || f.result === 'UNKNOWN'),
  ).length;
  const trustShort = [
    trust.isSynthetic
      ? 'Saved example · synthetic parts, not sourced'
      : trust.isSaved
        ? 'Saved build · not freshly generated'
        : trust.label,
    blockingFindings > 0 ? `${blockingFindings} blocking check${blockingFindings === 1 ? '' : 's'} unresolved` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const bannerNode = (
    <div
      role="status"
      data-testid="provenance-trust-banner"
      data-trust-label={trust.label}
      data-synthetic={trust.isSynthetic ? 'true' : 'false'}
      style={{ color: trust.isSynthetic ? 'var(--rv-warn-text)' : '#bae6fd' }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '2px 10px' }}>
        <strong data-testid="trust-banner-summary" style={{ fontWeight: 600 }}>
          {trustShort}
        </strong>
        {trust.reasons.length > 0 ? (
          <button
            type="button"
            className="rv-btn rv-btn--ghost rv-btn--small"
            data-testid="trust-banner-details-toggle"
            aria-expanded={trustDetailsOpen}
            aria-controls="rv-trust-details"
            onClick={() => setTrustDetailsOpen((o) => !o)}
            style={{ color: 'inherit', textDecoration: 'underline', padding: '0 4px', minHeight: 20 }}
          >
            {trustDetailsOpen ? 'Hide details' : 'Details'}
          </button>
        ) : null}
        {store.contractError && (
          <span role="alert" data-testid="studio-contract-error" style={{ color: 'var(--rv-danger-text)' }}>
            Contract error: {store.contractError}
          </span>
        )}
      </div>
      {trustDetailsOpen ? (
        <ul
          id="rv-trust-details"
          data-testid="trust-banner-details"
          style={{ margin: '4px 0 2px', paddingLeft: 18, listStyle: 'disc', color: 'var(--rv-text)' }}
        >
          <li>{trust.label}</li>
          {trust.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      ) : null}
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

  const requestSummary = useMemo<BuildRequestSummary | null>(() => {
    if (lastGeneration && lastGeneration.buildId === plan.build_id) {
      return {
        prompt: lastGeneration.request.input.user_text,
        imageUrl: lastGeneration.imageUrl,
        origin: 'generated',
        requirements: describeConstraints(lastGeneration.request.requirements),
      };
    }
    if (plan.source_intent_id === SAVED_INTENT.intent_id) {
      return {
        prompt: SAVED_INTENT.input.user_text,
        imageUrl: null,
        origin: 'saved',
        requirements: describeConstraints(SAVED_INTENT.requirements),
      };
    }
    return null;
  }, [lastGeneration, plan.build_id, plan.source_intent_id]);

  const intakeNode = (
    <BuildIntake
      key={store.dataSource.mode}
      onInterpret={store.dataSource.interpret ? (request) => store.dataSource.interpret!({
        input: request.input,
        requirements: { ...request.requirements, max_budget: request.requirements.max_budget === null ? null : String(request.requirements.max_budget) },
      }) : undefined}
      onUpload={async (file, options) => {
        const asset = await store.uploadImage(file, options);
        if (asset.preview_url) uploadPreviews.current.set(asset.asset_id, asset.preview_url);
        return asset;
      }}
      onGenerate={(request) => {
        const assetId = request.input.image_asset_id;
        setLastGeneration({
          request,
          imageUrl: assetId ? uploadPreviews.current.get(assetId) ?? null : null,
          buildId: null,
        });
        return store.startGeneration(request);
      }}
      job={intakeJob}
      events={store.jobEvents}
      onCancelJob={store.cancelJob}
      savedExamples={store.savedExamples}
      onLoadSavedExample={(id) => {
        void store.loadSavedExample(id).then(() => setIntakeOpen(false));
      }}
      loadedExampleId={store.loadedExampleId}
      currency={plan.bom.currency || 'USD'}
    />
  );

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
        showDevControls={devMode}
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
      request={requestSummary}
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
      offersSource={store.dataSource}
    />
  );

  return (
    <>
    <StudioShell
      header={headerNode}
      headerActions={headerActionsNode}
      banner={bannerNode}
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
      open={intakeOpen}
      onClose={() => setIntakeOpen(false)}
      title="New build"
      wide
      testId="intake-dialog"
      initialFocus={initialIntakeOpen && initialIntakeFocus === 'prompt' ? 'textarea' : undefined}
    >
      {intakeNode}
    </Dialog>
    <Dialog
      open={resolveOpen}
      onClose={() => setResolveOpen(false)}
      title="Product match"
      wide
      testId="resolve-dialog"
    >
      <ResolveDialogBody
        key={store.sourceMode}
        initialOutcome={initialResolveOutcome ?? 'exact_match'}
        dataSource={store.dataSource}
        uploadImage={store.uploadImage}
      />
    </Dialog>
    <Dialog
      open={offersOpen && store.sourceMode === 'fixture'}
      onClose={() => setOffersOpen(false)}
      title="Offers example"
      wide
      testId="offers-dialog"
    >
      <OffersDialogBody initialFixture={initialOffersFixture ?? 'synthetic-multivendor'} />
    </Dialog>
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
