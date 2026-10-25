'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { DesignSource, latestPreview, mergeDesignEvents } from '../../../lib/rivet/design-v2-source';
import type { DesignBundle, DesignCandidate, DesignEvent, DesignJob, DesignMode, SavedDesign } from '../../../lib/rivet/design-v2-types';

export interface DesignStartRequest {
  text: string;
  image: File | null;
  mode: DesignMode;
  allowCached: boolean;
}

/** One v2 design session: start, stream (resumable), load, select, revise, restore. */
export function useDesignJob(source: DesignSource = new DesignSource()) {
  const src = useRef(source).current;
  const [job, setJob] = useState<DesignJob | null>(null);
  const [events, setEvents] = useState<DesignEvent[]>([]);
  const [bundle, setBundle] = useState<DesignBundle | null>(null);
  const [revisions, setRevisions] = useState<SavedDesign[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const load = useCallback(async (buildId: string, revision?: number) => {
    const b = await src.design(buildId, revision);
    setBundle(b);
    setRevisions(await src.revisions(buildId).catch(() => []));
    return b;
  }, [src]);

  const follow = useCallback(async (j: DesignJob) => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setJob(j);
    setEvents([]);
    setBusy(true);
    try {
      await src.events(j.job_id, (e) => setEvents((prev) => mergeDesignEvents(prev, e, j.job_id)), controller.signal);
      // The terminal event can arrive just before the job row is marked finished.
      let status = await src.status(j.job_id);
      for (let i = 0; i < 40 && (status.status === 'queued' || status.status === 'running') && !controller.signal.aborted; i++) {
        await new Promise((done) => setTimeout(done, 250));
        status = await src.status(j.job_id);
      }
      setJob(status);
      if (status.status === 'complete' && status.build_id) await load(status.build_id);
      else if (status.status !== 'complete') setError(status.error?.message ?? `Generation ${status.status}`);
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Generation failed');
    } finally {
      if (abort.current === controller) setBusy(false);
    }
  }, [src, load]);

  const start = useCallback(async (req: DesignStartRequest) => {
    setBusy(true);
    setError(null);
    setBundle(null);
    try {
      await src.session();
      const image = req.image ? await src.upload(req.image) : null;
      const j = await src.generate({ input: { user_text: req.text, image_asset_id: image?.asset_id ?? null }, mode: req.mode, quality: 'full', candidate_count: 3,
        review_rounds: 1, allow_cached: req.allowCached, generation_budget_usd: 10, constraints: {} });
      await follow(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start generation');
      setBusy(false);
    }
  }, [src, follow]);

  const select = useCallback(async (c: DesignCandidate) => {
    if (!bundle) return;
    try {
      setBundle(await src.select(bundle, c));
      setRevisions(await src.revisions(bundle.build_id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Selection failed');
    }
  }, [bundle, src]);

  const revise = useCallback(async (instruction: string, bodyIds: string[] = []) => {
    if (!bundle) return;
    setError(null);
    try {
      const j = await src.revise(bundle, instruction, bodyIds);
      await follow({ ...j, build_id: bundle.build_id });
      await load(bundle.build_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Revision failed');
    }
  }, [bundle, src, follow, load]);

  const restore = useCallback(async (revision: number) => {
    if (!bundle) return;
    try {
      setBundle(await src.restore(bundle, revision));
      setRevisions(await src.revisions(bundle.build_id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Restore failed');
    }
  }, [bundle, src]);

  const cancel = useCallback(async () => {
    if (job) await src.cancel(job.job_id).catch(() => undefined);
  }, [job, src]);

  return { job, events, bundle, revisions, error, busy, start, select, revise, restore, cancel, load, source: src, latestPreview: (cid: string | null) => latestPreview(events, cid) };
}
