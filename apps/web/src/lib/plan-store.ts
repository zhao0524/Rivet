'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FixtureSource,
  HttpSource,
  RivetError,
  SYNTHETIC_ROVER_BUILD_ID,
  assertPlanIntegrity,
  createRivetDataSource,
  describeBuildTrust,
  type BuildPlan,
  type BuildTrust,
  type CatalogComponent,
  type DataSourceMode,
  type EditOperation,
  type EditResponse,
  type EstelleGroundRequest,
  type EstelleGroundResponse,
  type EstelleStatusResponse,
  type JobResponse,
  type JobSubscription,
  type RevisionSummary,
  type RivetDataSource,
  type SavedExampleSummary,
  type StageEvent,
  type UploadedImageAsset,
} from './rivet';
import {
  DEFAULT_SAVED_EXAMPLES,
  SOURCED_ROVER_BUILD_ID,
  createCombinedFixtureSource,
  getCombinedFixtureCatalog,
  getSyntheticRoverPlan,
} from './fixtures';
import type { GenerateRequest as IntakeGenerateRequest } from '../components/studio/intake/types';

export type StudioActionMode = 'design' | 'inspect' | 'wiring' | 'assemble' | 'simulate';

export interface UseStudioPlanStoreOptions {
  initialDataSource?: RivetDataSource;
  initialMode?: StudioActionMode;
}

function formatError(err: unknown, fallback: string): string {
  if (err instanceof RivetError) {
    return `${err.code}: ${err.message}${err.hint ? ` (${err.hint})` : ''}`;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export function buildBomCsvClientSide(plan: BuildPlan): string {
  const escapeCell = (val: string | number | null | undefined): string => {
    if (val === null || val === undefined) return '';
    let s = String(val);
    if (/^[=+\-@\t\r]/.test(s)) {
      s = `'${s}`;
    }
    if (/[",\n\r]/.test(s)) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const header = 'catalog_id,quantity,instance_ids,unit_price_amount,currency,purchase_url,link_status';
  const rows = plan.bom.items.map((item) =>
    [
      escapeCell(item.catalog_id),
      escapeCell(item.quantity),
      escapeCell(item.instance_ids.join(';')),
      escapeCell(item.unit_price_amount),
      escapeCell(item.unit_price_amount !== null ? plan.bom.currency : null),
      escapeCell(item.purchase_url),
      escapeCell(item.link_status),
    ].join(','),
  );
  rows.push(
    [
      'TOTAL',
      '',
      '',
      escapeCell(plan.bom.known_subtotal_amount),
      escapeCell(plan.bom.known_subtotal_amount !== null ? plan.bom.currency : null),
      '',
      escapeCell(`total_status:${plan.bom.total_status}`),
    ].join(','),
  );
  return `${[header, ...rows].join('\n')}\n`;
}

/**
 * Resolves the `HttpSource` baseUrl:
 * - In the browser (`typeof window !== 'undefined'`), defaults to `''` (same-origin) so `/api/*`
 *   requests flow through Next.js rewrites (`next.config.mjs`) without cross-origin CORS failures
 *   or contacting the viewer's own `localhost:8000`.
 * - On the server (SSR / Node tests without `window`), falls back to `NEXT_PUBLIC_RIVET_API_URL`
 *   or `http://localhost:8000`.
 */
export function resolveBrowserHttpBaseUrl(): string {
  if (typeof window !== 'undefined') {
    return '';
  }
  const configured = process.env.NEXT_PUBLIC_RIVET_API_URL;
  if (configured && configured.trim() !== '') {
    return configured.replace(/\/+$/, '');
  }
  const fallback = createRivetDataSource({ useFixtures: false });
  return fallback instanceof HttpSource ? fallback.baseUrl : 'http://localhost:8000';
}

export function useStudioPlanStore(options: UseStudioPlanStoreOptions = {}) {
  const [sourceMode, setSourceModeState] = useState<DataSourceMode>(() => {
    if (options.initialDataSource) return options.initialDataSource.mode;
    return process.env.NEXT_PUBLIC_RIVET_USE_FIXTURES === 'false' ? 'http' : 'fixture';
  });

  // Override fixture source when a saved example not present in `initialDataSource` is opened,
  // or when switching from HTTP mode to a local saved example.
  const [fixtureOverride, setFixtureOverride] = useState<FixtureSource | null>(null);

  const dataSource = useMemo<RivetDataSource>(() => {
    if (sourceMode === 'fixture') {
      if (fixtureOverride) return fixtureOverride;
      if (options.initialDataSource && options.initialDataSource.mode === 'fixture') {
        return options.initialDataSource;
      }
      return createCombinedFixtureSource(SYNTHETIC_ROVER_BUILD_ID);
    }
    if (options.initialDataSource && options.initialDataSource.mode === 'http') {
      return options.initialDataSource;
    }
    return new HttpSource({ baseUrl: resolveBrowserHttpBaseUrl() });
  }, [options.initialDataSource, sourceMode, fixtureOverride]);

  const [catalog, setCatalog] = useState<CatalogComponent[]>(() => getCombinedFixtureCatalog());
  const [plan, setPlan] = useState<BuildPlan>(() => getSyntheticRoverPlan());
  const [revisions, setRevisions] = useState<RevisionSummary[]>(() => [
    {
      revision: 1,
      created_at: '2026-10-24T00:00:00Z',
      status: 'needs_review',
      title: 'Synthetic starter rover (NOT SOURCED)',
      label: 'Saved synthetic example',
    },
  ]);
  const [savedExamples, setSavedExamples] = useState<SavedExampleSummary[]>(() => [...DEFAULT_SAVED_EXAMPLES]);
  const [loadedExampleId, setLoadedExampleId] = useState<string | null>(SYNTHETIC_ROVER_BUILD_ID);

  const [activeMode, setActiveMode] = useState<StudioActionMode>(options.initialMode ?? 'design');
  const [loading, setLoading] = useState(false);
  const [contractError, setContractError] = useState<string | null>(null);
  const [revisionError, setRevisionError] = useState<string | null>(null);

  const [job, setJob] = useState<JobResponse | null>(null);
  const [jobEvents, setJobEvents] = useState<StageEvent[]>([]);
  const subscriptionRef = useRef<JobSubscription | null>(null);

  // Epoch counters & AbortController to discard stale in-flight build/generation responses
  const sourceEpochRef = useRef(0);
  const buildRequestEpochRef = useRef(0);
  const activeLoadAbortRef = useRef<AbortController | null>(null);
  const activeGenAbortRef = useRef<AbortController | null>(null);

  const [editPending, setEditPending] = useState(false);
  const [lastEditResponse, setLastEditResponse] = useState<EditResponse | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  const [estelleStatus, setEstelleStatus] = useState<EstelleStatusResponse | null>(null);
  const [estelleGroundResult, setEstelleGroundResult] = useState<EstelleGroundResponse | null>(null);
  const [estelleLoading, setEstelleSingleLoading] = useState(false);
  const [estelleError, setEstelleError] = useState<string | null>(null);

  const cancelInFlightRequests = useCallback(() => {
    buildRequestEpochRef.current += 1;
    activeLoadAbortRef.current?.abort();
    activeLoadAbortRef.current = null;
    activeGenAbortRef.current?.abort();
    activeGenAbortRef.current = null;
    subscriptionRef.current?.close();
    subscriptionRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      cancelInFlightRequests();
    };
  }, [cancelInFlightRequests]);

  const applyValidatedBuild = useCallback((nextPlan: BuildPlan, nextCatalog: CatalogComponent[]) => {
    assertPlanIntegrity(nextPlan, nextCatalog);
    setCatalog(nextCatalog);
    setPlan(nextPlan);
    setContractError(null);
  }, []);

  const refreshRevisionsForSource = useCallback(
    async (
      source: RivetDataSource,
      buildId: string,
      targetPlan: BuildPlan,
      signal: AbortSignal | undefined,
      expectedBuildEpoch: number,
      expectedSourceEpoch: number,
    ) => {
      if (source.listRevisions) {
        try {
          const list = await source.listRevisions(buildId, { signal });
          if (
            signal?.aborted ||
            expectedBuildEpoch !== buildRequestEpochRef.current ||
            expectedSourceEpoch !== sourceEpochRef.current
          ) {
            return;
          }
          if (list.length > 0) {
            setRevisions(list);
            return;
          }
        } catch {
          if (
            signal?.aborted ||
            expectedBuildEpoch !== buildRequestEpochRef.current ||
            expectedSourceEpoch !== sourceEpochRef.current
          ) {
            return;
          }
        }
      }
      if (
        signal?.aborted ||
        expectedBuildEpoch !== buildRequestEpochRef.current ||
        expectedSourceEpoch !== sourceEpochRef.current
      ) {
        return;
      }
      setRevisions([
        {
          revision: targetPlan.revision,
          created_at: targetPlan.created_at,
          status: targetPlan.status,
          title: targetPlan.title,
        },
      ]);
    },
    [],
  );

  const loadBuildFromSource = useCallback(
    async (source: RivetDataSource, buildId: string, revision?: number) => {
      activeLoadAbortRef.current?.abort();
      const controller = new AbortController();
      activeLoadAbortRef.current = controller;
      const myBuildEpoch = ++buildRequestEpochRef.current;
      const mySourceEpoch = sourceEpochRef.current;

      setLoading(true);
      setRevisionError(null);
      try {
        const [nextCatalog, nextPlan] = await Promise.all([
          source.getCatalog({ signal: controller.signal }),
          source.getBuild(buildId, revision, { signal: controller.signal }),
        ]);
        if (
          controller.signal.aborted ||
          myBuildEpoch !== buildRequestEpochRef.current ||
          mySourceEpoch !== sourceEpochRef.current
        ) {
          return;
        }
        applyValidatedBuild(nextPlan, nextCatalog);
        await refreshRevisionsForSource(
          source,
          nextPlan.build_id,
          nextPlan,
          controller.signal,
          myBuildEpoch,
          mySourceEpoch,
        );
      } catch (err) {
        if (
          controller.signal.aborted ||
          myBuildEpoch !== buildRequestEpochRef.current ||
          mySourceEpoch !== sourceEpochRef.current ||
          (err instanceof RivetError && err.kind === 'aborted')
        ) {
          return;
        }
        const msg = formatError(err, `Failed to load build ${buildId}`);
        if (err instanceof RivetError && err.kind === 'contract') {
          setContractError(msg);
        } else {
          setRevisionError(msg);
        }
      } finally {
        if (
          !controller.signal.aborted &&
          myBuildEpoch === buildRequestEpochRef.current &&
          mySourceEpoch === sourceEpochRef.current
        ) {
          setLoading(false);
        }
      }
    },
    [applyValidatedBuild, refreshRevisionsForSource],
  );

  const loadBuild = useCallback(
    async (buildId: string, revision?: number) => {
      return loadBuildFromSource(dataSource, buildId, revision);
    },
    [dataSource, loadBuildFromSource],
  );

  const loadSavedExample = useCallback(
    async (exampleId: string) => {
      const targetId = exampleId === 'rover_obstacle_v1' ? SYNTHETIC_ROVER_BUILD_ID : exampleId;

      // Cancel any in-flight HTTP or fixture requests before loading the saved example
      sourceEpochRef.current += 1;
      cancelInFlightRequests();
      setContractError(null);
      setRevisionError(null);
      setEditError(null);
      setLastEditResponse(null);
      setJob(null);
      setJobEvents([]);

      // Ensure the saved example is paired with a FixtureSource that actually owns `targetId`
      let owningFixture: RivetDataSource;
      const candidateFixture =
        options.initialDataSource && options.initialDataSource.mode === 'fixture'
          ? options.initialDataSource
          : createCombinedFixtureSource(targetId);

      let candidateOwnsTarget = false;
      try {
        await candidateFixture.getBuild(targetId);
        candidateOwnsTarget = true;
      } catch {
        candidateOwnsTarget = false;
      }

      if (candidateOwnsTarget) {
        owningFixture = candidateFixture;
        if (owningFixture !== options.initialDataSource && owningFixture instanceof FixtureSource) {
          setFixtureOverride(owningFixture);
        } else {
          setFixtureOverride(null);
        }
      } else {
        const combined = createCombinedFixtureSource(targetId);
        owningFixture = combined;
        setFixtureOverride(combined);
      }

      if (sourceMode !== 'fixture') {
        setSourceModeState('fixture');
      }

      setLoadedExampleId(exampleId);
      await loadBuildFromSource(owningFixture, targetId);
    },
    [cancelInFlightRequests, loadBuildFromSource, options.initialDataSource, sourceMode],
  );

  const setSourceMode = useCallback(
    async (nextMode: DataSourceMode) => {
      sourceEpochRef.current += 1;
      cancelInFlightRequests();
      setEditError(null);
      setLastEditResponse(null);
      setRevisionError(null);
      setJob(null);
      setJobEvents([]);
      setFixtureOverride(null);
      setSourceModeState(nextMode);
      if (nextMode === 'fixture') {
        const fixtureSource =
          options.initialDataSource && options.initialDataSource.mode === 'fixture'
            ? options.initialDataSource
            : createCombinedFixtureSource(SYNTHETIC_ROVER_BUILD_ID);
        setLoadedExampleId(SYNTHETIC_ROVER_BUILD_ID);
        await loadBuildFromSource(fixtureSource, SYNTHETIC_ROVER_BUILD_ID);
      }
    },
    [cancelInFlightRequests, loadBuildFromSource, options.initialDataSource],
  );

  useEffect(() => {
    let cancelled = false;
    const effectSourceEpoch = sourceEpochRef.current;
    const effectBuildEpoch = buildRequestEpochRef.current;

    async function syncSourceMetadata() {
      let defaultExampleId = SYNTHETIC_ROVER_BUILD_ID;
      if (dataSource.listExamples) {
        try {
          const ex = await dataSource.listExamples();
          if (!cancelled && effectSourceEpoch === sourceEpochRef.current && ex.length > 0) {
            setSavedExamples(ex);
            defaultExampleId = ex[0].example_id;
          }
        } catch {
          if (!cancelled && effectSourceEpoch === sourceEpochRef.current) {
            setSavedExamples([...DEFAULT_SAVED_EXAMPLES]);
          }
        }
      }
      if (
        dataSource.mode === 'fixture' &&
        effectBuildEpoch === 0 &&
        buildRequestEpochRef.current === 0
      ) {
        try {
          const targetId =
            defaultExampleId === 'rover_obstacle_v1' ? SYNTHETIC_ROVER_BUILD_ID : defaultExampleId;
          const [nextCatalog, nextPlan] = await Promise.all([
            dataSource.getCatalog(),
            dataSource.getBuild(targetId),
          ]);
          if (
            !cancelled &&
            effectSourceEpoch === sourceEpochRef.current &&
            buildRequestEpochRef.current === 0
          ) {
            applyValidatedBuild(nextPlan, nextCatalog);
            await refreshRevisionsForSource(
              dataSource,
              nextPlan.build_id,
              nextPlan,
              undefined,
              0,
              effectSourceEpoch,
            );
          }
        } catch {
          // Keep initial synthetic fallback if custom fixture has no default build
        }
      }
      if (dataSource.getEstelleStatus) {
        try {
          const st = await dataSource.getEstelleStatus();
          if (!cancelled && effectSourceEpoch === sourceEpochRef.current) setEstelleStatus(st);
        } catch {
          if (!cancelled && effectSourceEpoch === sourceEpochRef.current) {
            setEstelleStatus({
              status: 'unavailable',
              enabled: false,
              mode: dataSource.mode,
              cli_found: false,
              repo_valid: false,
              reason: 'Could not reach /api/estelle/status.',
            });
          }
        }
      }
    }
    void syncSourceMetadata();
    return () => {
      cancelled = true;
    };
  }, [dataSource, applyValidatedBuild, refreshRevisionsForSource]);

  const uploadImage = useCallback(
    async (file: File, opts?: { signal?: AbortSignal }): Promise<UploadedImageAsset> => {
      if (dataSource.uploadImage) {
        return dataSource.uploadImage(file, opts);
      }
      const fallback = createCombinedFixtureSource();
      return fallback.uploadImage(file, opts);
    },
    [dataSource],
  );

  const startGeneration = useCallback(
    async (request: IntakeGenerateRequest) => {
      activeGenAbortRef.current?.abort();
      subscriptionRef.current?.close();
      subscriptionRef.current = null;

      const genController = new AbortController();
      activeGenAbortRef.current = genController;
      const mySourceEpoch = sourceEpochRef.current;
      const myBuildEpoch = ++buildRequestEpochRef.current;
      const activeSource = dataSource;

      setJobEvents([]);
      setContractError(null);
      setRevisionError(null);
      setLastEditResponse(null);
      setEditError(null);

      const normalizedBudget =
        request.requirements.max_budget !== null && request.requirements.max_budget !== undefined
          ? String(request.requirements.max_budget)
          : null;

      const wireRequest = {
        input: {
          kind: request.input.kind,
          image_asset_id: request.input.image_asset_id,
          user_text: request.input.user_text ?? (request.input.kind === 'image' ? null : ''),
        },
        requirements: {
          max_budget: normalizedBudget,
          currency: request.requirements.currency,
        },
      };

      const res = await activeSource.generate(wireRequest, { signal: genController.signal });
      if (
        genController.signal.aborted ||
        mySourceEpoch !== sourceEpochRef.current ||
        myBuildEpoch !== buildRequestEpochRef.current
      ) {
        return res;
      }

      const initialJob: JobResponse = {
        job_id: res.job_id,
        status: res.status,
        stage: res.status === 'complete' ? 'complete' : null,
        progress: null,
        build_id: res.build_id,
        revision: res.build_id ? 1 : null,
      };
      setJob(initialJob);

      const sub = activeSource.subscribeToJob(
        res.job_id,
        (event) => {
          if (
            genController.signal.aborted ||
            mySourceEpoch !== sourceEpochRef.current ||
            myBuildEpoch !== buildRequestEpochRef.current
          ) {
            return;
          }
          setJobEvents((prev) => [...prev, event]);
          setJob((prev) =>
            prev
              ? {
                  ...prev,
                  stage: event.stage,
                  status:
                    event.stage === 'complete'
                      ? 'complete'
                      : event.stage === 'failed'
                        ? 'failed'
                        : 'running',
                }
              : prev,
          );
        },
        {
          signal: genController.signal,
          onJob: (finalJob) => {
            if (
              genController.signal.aborted ||
              mySourceEpoch !== sourceEpochRef.current ||
              myBuildEpoch !== buildRequestEpochRef.current
            ) {
              return;
            }
            setJob(finalJob);
            if (finalJob.status === 'complete' && finalJob.build_id) {
              setLoadedExampleId(
                activeSource.mode === 'fixture' ? finalJob.build_id : null,
              );
              void loadBuildFromSource(
                activeSource,
                finalJob.build_id,
                finalJob.revision ?? undefined,
              );
            }
          },
          onError: (err) => {
            if (
              genController.signal.aborted ||
              mySourceEpoch !== sourceEpochRef.current ||
              myBuildEpoch !== buildRequestEpochRef.current
            ) {
              return;
            }
            setJob((prev) =>
              prev
                ? {
                    ...prev,
                    status: 'failed',
                    stage: 'failed',
                    error: {
                      code: err.code,
                      message: err.message,
                      retryable: err.retryable,
                    },
                  }
                : null,
            );
          },
        },
      );
      subscriptionRef.current = sub;
      return res;
    },
    [dataSource, loadBuildFromSource],
  );

  const cancelJob = useCallback((_jobId: string) => {
    activeGenAbortRef.current?.abort();
    activeGenAbortRef.current = null;
    subscriptionRef.current?.close();
    subscriptionRef.current = null;
  }, []);

  const submitEdit = useCallback(
    async (instruction: string, operation?: EditOperation): Promise<EditResponse | null> => {
      const mySourceEpoch = sourceEpochRef.current;
      const myBuildEpoch = buildRequestEpochRef.current;
      const activeSource = dataSource;

      setEditPending(true);
      setEditError(null);
      setLastEditResponse(null);
      try {
        const res = await activeSource.edit(plan.build_id, {
          base_revision: plan.revision,
          instruction,
          operation,
        });
        if (
          mySourceEpoch !== sourceEpochRef.current ||
          myBuildEpoch !== buildRequestEpochRef.current
        ) {
          return null;
        }
        setLastEditResponse(res);
        if (res.accepted && typeof res.revision === 'number') {
          await loadBuildFromSource(activeSource, res.build_id, res.revision);
        }
        return res;
      } catch (err) {
        if (
          mySourceEpoch !== sourceEpochRef.current ||
          myBuildEpoch !== buildRequestEpochRef.current
        ) {
          return null;
        }
        setEditError(formatError(err, 'Failed to submit edit'));
        return null;
      } finally {
        if (
          mySourceEpoch === sourceEpochRef.current &&
          myBuildEpoch === buildRequestEpochRef.current
        ) {
          setEditPending(false);
        }
      }
    },
    [dataSource, plan.build_id, plan.revision, loadBuildFromSource],
  );

  const runEstelleGround = useCallback(
    async (req: EstelleGroundRequest) => {
      setEstelleSingleLoading(true);
      setEstelleError(null);
      try {
        if (dataSource.groundSymbol) {
          const result = await dataSource.groundSymbol(req);
          setEstelleGroundResult(result);
          return result;
        }
        const fallback = createCombinedFixtureSource();
        const result = await fallback.groundSymbol(req);
        setEstelleGroundResult(result);
        return result;
      } catch (err) {
        setEstelleError(formatError(err, 'Estelle grounding call failed'));
        return null;
      } finally {
        setEstelleSingleLoading(false);
      }
    },
    [dataSource],
  );

  const trust: BuildTrust = useMemo(
    () => describeBuildTrust(plan, dataSource.mode, catalog),
    [plan, dataSource.mode, catalog],
  );

  return {
    sourceMode,
    setSourceMode,
    dataSource,
    catalog,
    plan,
    trust,
    revisions,
    savedExamples,
    loadedExampleId,
    activeMode,
    setActiveMode,
    loading,
    contractError,
    revisionError,
    loadBuild,
    loadSavedExample,
    uploadImage,
    startGeneration,
    cancelJob,
    job,
    jobEvents,
    editPending,
    lastEditResponse,
    editError,
    submitEdit,
    estelleStatus,
    estelleGroundResult,
    estelleLoading,
    estelleError,
    runEstelleGround,
  };
}
