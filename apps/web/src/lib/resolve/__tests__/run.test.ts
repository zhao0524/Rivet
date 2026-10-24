import { describe, expect, it, vi } from 'vitest';
import { RivetError } from '../../rivet/errors';
import { makeResolveFixtures } from '../fixtures';
import { isResolveSource, runResolve, type ResolveSource } from '../run';
import type { ResolveJob, ResolveRequest } from '../types';

const REQUEST: ResolveRequest = { input: { kind: 'text', image_asset_id: null, user_text: 'Example Aero Scout Mini' } };
const RESOLUTION = makeResolveFixtures(new Date('2026-10-24T18:00:00Z')).exact_match;

function source(jobs: ResolveJob[]): ResolveSource & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    resolveProduct: vi.fn(async (req) => {
      calls.push(`resolve:${req.input.user_text}`);
      return { job_id: 'job-1', status: 'queued', resolution_id: null };
    }),
    getResolveJob: vi.fn(async (id) => {
      calls.push(`job:${id}`);
      return jobs.length > 1 ? jobs.shift()! : jobs[0];
    }),
    getResolution: vi.fn(async (id) => {
      calls.push(`resolution:${id}`);
      return { ...RESOLUTION, resolution_id: id };
    }),
  };
}

const job = (over: Partial<ResolveJob>): ResolveJob => ({
  job_id: 'job-1',
  status: 'running',
  stage: 'identify',
  progress: null,
  ...over,
});

const noSleep = () => Promise.resolve();

describe('runResolve', () => {
  it('starts the job, polls until complete, then fetches the stored resolution', async () => {
    const s = source([job({}), job({ stage: 'verify' }), job({ status: 'complete', stage: 'complete', resolution_id: 'res-1' })]);
    const seen: (string | null)[] = [];
    const r = await runResolve(s, REQUEST, { sleep: noSleep, onJob: (j) => seen.push(j.stage) });
    expect(r.resolution_id).toBe('res-1');
    expect(seen).toEqual(['identify', 'verify', 'complete']);
    expect(s.calls).toEqual(['resolve:Example Aero Scout Mini', 'job:job-1', 'job:job-1', 'job:job-1', 'resolution:res-1']);
  });

  it('reports a failed job with the server code and message, and fetches nothing', async () => {
    const s = source([
      job({
        status: 'failed',
        stage: 'failed',
        error: { code: 'RESOLVER_OFFLINE', message: 'Sources could not be reached, so nothing was resolved', retryable: true },
      }),
    ]);
    const err = await runResolve(s, REQUEST, { sleep: noSleep }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RivetError);
    expect((err as RivetError).code).toBe('RESOLVER_OFFLINE');
    expect((err as RivetError).message).toContain('nothing was resolved');
    expect((err as RivetError).retryable).toBe(true);
    expect(s.getResolution).not.toHaveBeenCalled();
  });

  it('treats a completed job without a resolution id as a contract error', async () => {
    const s = source([job({ status: 'complete', stage: 'complete' })]);
    await expect(runResolve(s, REQUEST, { sleep: noSleep })).rejects.toMatchObject({ kind: 'contract' });
  });

  it('gives up after the timeout instead of polling forever', async () => {
    let t = 0;
    const s = source([job({})]);
    await expect(
      runResolve(s, REQUEST, { sleep: noSleep, timeoutMs: 1_000, now: () => (t += 600) }),
    ).rejects.toMatchObject({ code: 'RESOLVE_TIMEOUT' });
  });

  it('stops when aborted', async () => {
    const s = source([job({})]);
    const controller = new AbortController();
    const done = runResolve(s, REQUEST, { signal: controller.signal, pollIntervalMs: 10_000 });
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();
    await expect(done).rejects.toMatchObject({ kind: 'aborted' });
  });
});

describe('isResolveSource', () => {
  it('needs all three resolve methods', () => {
    expect(isResolveSource(source([]))).toBe(true);
    expect(isResolveSource({ resolveProduct: () => null })).toBe(false);
  });
});
