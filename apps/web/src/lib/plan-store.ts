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
import { DEFAULT_SAVED_EXAMPLES, getSyntheticCatalog, getSyntheticRoverPlan } from './fixtures';
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

export function useStudioPlanStore(options: UseStudioPlanStoreOptions = {}) {
  const [sourceMode, setSourceModeState] = useState<DataSourceMode>(() => {
    if (options.initialDataSource) return options.initialDataSource.mode;
    return process.env.NEXT_PUBLIC_RIVET_USE_FIXTURES === 'false' ? 'http' : 'fixture';
  });

  const dataSource = useMemo<RivetDataSource>(() => {
    if (options.initialDataSource && options.initialDataSource.mode === sourceMode) {
      return options.initialDataSource;
    }
    if (sourceMode === 'fixture') {
      return new FixtureSource();
    }
    const baseUrl =
      typeof window !== 'undefined'
        ? process.env.NEXT_PUBLIC_RIVET_API_URL || ''
        : createRivetDataSource({ useFixtures: false }) instanceof HttpSource
          ? (createRivetDataSource({ useFixtures: false }) as HttpSource).baseUrl
          : 'http://localhost:8000';
    return new HttpSource({ baseUrl: baseUrl || 'http://localhost:8000' });
  }, [options.initialDataSource, sourceMode]);

  const [catalog, setCatalog] = useState<CatalogComponent[]>(() => getSyntheticCatalog());
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

  const [editPending, setEditPending] = useState(false);
  const [lastEditResponse, setLastEditResponse] = useState<EditResponse | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  const [estelleStatus, setEstelleStatus] = useState<EstelleStatusResponse | null>(null);
  const [estelleGroundResult, setEstelleGroundResult] = useState<EstelleGroundResponse | null>(null);
  const [estelleLoading, setEstelleLoading] = useState(false);
  const [estelleError, setEstelleError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      subscriptionRef.current?.close();
    };
  }, []);

  const applyValidatedBuild = useCallback((nextPlan: BuildPlan, nextCatalog: CatalogComponent[]) => {
    assertPlanIntegrity(nextPlan, nextCatalog);
    setCatalog(nextCatalog);
    setPlan(nextPlan);
    setContractError(null);
  }, []);

  const refreshRevisions = useCallback(
    async (buildId: string, targetPlan: BuildPlan) => {
      if (dataSource.listRevisions) {
        try {
          const list = await dataSource.listRevisions(buildId);
          if (list.length > 0) {
            setRevisions(list);
            return;
          }
        } catch {
          // Fall back to the active revision entry below if the endpoint isn't reachable.
        }
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
    [dataSource],
  );

  const loadBuild = useCallback(
    async (buildId: string, revision?: number) => {
      setLoading(true);
      setRevisionError(null);
      try {
        const [nextCatalog, nextPlan] = await Promise.all([
          dataSource.getCatalog(),
          dataSource.getBuild(buildId, revision),
        ]);
        applyValidatedBuild(nextPlan, nextCatalog);
        await refreshRevisions(nextPlan.build_id, nextPlan);
      } catch (err) {
        const msg = formatError(err, `Failed to load build ${buildId}`);
        if (err instanceof RivetError && err.kind === 'contract') {
          setContractError(msg);
        } else {
          setRevisionError(msg);
        }
      } finally {
        setLoading(false);
      }
    },
    [dataSource, applyValidatedBuild, refreshRevisions],
  );

  const loadSavedExample = useCallback(
    async (exampleId: string) => {
      setLoading(true);
      setContractError(null);
      setRevisionError(null);
      setEditError(null);
      setLastEditResponse(null);
      try {
        const fixture = new FixtureSource();
        const targetId = exampleId === 'rover_obstacle_v1' ? SYNTHETIC_ROVER_BUILD_ID : exampleId;
        const [nextCatalog, nextPlan] = await Promise.all([
          fixture.getCatalog(),
          fixture.getBuild(targetId),
        ]);
        applyValidatedBuild(nextPlan, nextCatalog);
        setLoadedExampleId(exampleId);
        setRevisions([
          {
            revision: nextPlan.revision,
            created_at: nextPlan.created_at,
            status: nextPlan.status,
            title: nextPlan.title,
            label: 'Saved synthetic example',
          },
        ]);
      } catch (err) {
        setContractError(formatError(err, `Could not open saved example ${exampleId}`));
      } finally {
        setLoading(false);
      }
    },
    [applyValidatedBuild],
  );

  const setSourceMode = useCallback(
    async (nextMode: DataSourceMode) => {
      subscriptionRef.current?.close();
      subscriptionRef.current = null;
      setSourceModeState(nextMode);
      setEditError(null);
      setLastEditResponse(null);
      setRevisionError(null);
      if (nextMode === 'fixture') {
        await loadSavedExample(SYNTHETIC_ROVER_BUILD_ID);
      }
    },
    [loadSavedExample],
  );

  useEffect(() => {
    let cancelled = false;
    async function syncSourceMetadata() {
      let defaultExampleId = SYNTHETIC_ROVER_BUILD_ID;
      if (dataSource.listExamples) {
        try {
          const ex = await dataSource.listExamples();
          if (!cancelled && ex.length > 0) {
            setSavedExamples(ex);
            defaultExampleId = ex[0].example_id;
          }
        } catch {
          if (!cancelled) setSavedExamples([...DEFAULT_SAVED_EXAMPLES]);
        }
      }
      if (dataSource.mode === 'fixture') {
        try {
          const targetId =
            defaultExampleId === 'rover_obstacle_v1' ? SYNTHETIC_ROVER_BUILD_ID : defaultExampleId;
          const [nextCatalog, nextPlan] = await Promise.all([
            dataSource.getCatalog(),
            dataSource.getBuild(targetId),
          ]);
          if (!cancelled) {
            applyValidatedBuild(nextPlan, nextCatalog);
            await refreshRevisions(nextPlan.build_id, nextPlan);
          }
        } catch {
          // Keep initial synthetic fallback if custom fixture has no default build
        }
      }
      if (dataSource.getEstelleStatus) {
        try {
          const st = await dataSource.getEstelleStatus();
          if (!cancelled) setEstelleStatus(st);
        } catch {
          if (!cancelled) {
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
  }, [dataSource, applyValidatedBuild, refreshRevisions]);

  const uploadImage = useCallback(
    async (file: File, opts?: { signal?: AbortSignal }): Promise<UploadedImageAsset> => {
      if (dataSource.uploadImage) {
        return dataSource.uploadImage(file, opts);
      }
      const fallback = new FixtureSource();
      return fallback.uploadImage(file, opts);
    },
    [dataSource],
  );

  const startGeneration = useCallback(
    async (request: IntakeGenerateRequest) => {
      subscriptionRef.current?.close();
      subscriptionRef.current = null;
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

      const res = await dataSource.generate(wireRequest);
      const initialJob: JobResponse = {
        job_id: res.job_id,
        status: res.status,
        stage: res.status === 'complete' ? 'complete' : null,
        progress: null,
        build_id: res.build_id,
        revision: res.build_id ? 1 : null,
      };
      setJob(initialJob);

      const sub = dataSource.subscribeToJob(
        res.job_id,
        (event) => {
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
          onJob: (finalJob) => {
            setJob(finalJob);
            if (finalJob.status === 'complete' && finalJob.build_id) {
              setLoadedExampleId(
                dataSource.mode === 'fixture' ? finalJob.build_id : null,
              );
              void loadBuild(finalJob.build_id, finalJob.revision ?? undefined);
            }
          },
          onError: (err) => {
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
    [dataSource, loadBuild],
  );

  const cancelJob = useCallback((_jobId: string) => {
    subscriptionRef.current?.close();
    subscriptionRef.current = null;
  }, []);

  const submitEdit = useCallback(
    async (instruction: string, operation?: EditOperation): Promise<EditResponse | null> => {
      setEditPending(true);
      setEditError(null);
      setLastEditResponse(null);
      try {
        const res = await dataSource.edit(plan.build_id, {
          base_revision: plan.revision,
          instruction,
          operation,
        });
        setLastEditResponse(res);
        if (res.accepted && typeof res.revision === 'number') {
          await loadBuild(res.build_id, res.revision);
        }
        return res;
      } catch (err) {
        setEditError(formatError(err, 'Failed to submit edit'));
        return null;
      } finally {
        setEditPending(false);
      }
    },
    [dataSource, plan.build_id, plan.revision, loadBuild],
  );

  const runEstelleGround = useCallback(
    async (req: EstelleGroundRequest) => {
      setEstelleLoading(true);
      setEstelleError(null);
      try {
        if (dataSource.groundSymbol) {
          const result = await dataSource.groundSymbol(req);
          setEstelleGroundResult(result);
          return result;
        }
        const fallback = new FixtureSource();
        const result = await fallback.groundSymbol(req);
        setEstelleGroundResult(result);
        return result;
      } catch (err) {
        setEstelleError(formatError(err, 'Estelle grounding call failed'));
        return null;
      } finally {
        setEstelleLoading(false);
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
