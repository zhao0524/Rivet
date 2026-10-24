/**
 * One product lookup against the live API: start `POST /api/resolve`, poll the job until it
 * ends, then fetch and validate the stored resolution. Nothing is invented on the way: stage
 * labels come from the job, and a failed job is reported with the server's own error.
 */
import type { RequestOptions } from '../rivet/data-source';
import { RivetError } from '../rivet/errors';
import type { Resolution, ResolveJob, ResolveRequest, ResolveStartResponse } from './types';

export interface ResolveSource {
  resolveProduct(request: ResolveRequest, options?: RequestOptions): Promise<ResolveStartResponse>;
  getResolveJob(jobId: string, options?: RequestOptions): Promise<ResolveJob>;
  getResolution(resolutionId: string, options?: RequestOptions): Promise<Resolution>;
}

export function isResolveSource(source: object): source is ResolveSource {
  const s = source as Partial<ResolveSource>;
  return (
    typeof s.resolveProduct === 'function' &&
    typeof s.getResolveJob === 'function' &&
    typeof s.getResolution === 'function'
  );
}

/** Plain-language label for each stage the resolve job reports (`resolution/service.py`). */
export const RESOLVE_STAGE_LABEL: Record<string, string> = {
  upload: 'Reading the image',
  identify: 'Working out what the product is',
  verify: 'Looking for the product at trusted sources',
  decompose: 'Tracing its parts',
  complete: 'Done',
  failed: 'Stopped',
};

export interface RunResolveOptions {
  signal?: AbortSignal;
  onJob?: (job: ResolveJob) => void;
  pollIntervalMs?: number;
  timeoutMs?: number;
  /** Injected in tests. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
}

const defaultSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new RivetError({ kind: 'aborted', code: 'ABORTED', message: 'The lookup was cancelled' }));
      },
      { once: true },
    );
  });

export async function runResolve(
  source: ResolveSource,
  request: ResolveRequest,
  options: RunResolveOptions = {},
): Promise<Resolution> {
  const { signal, onJob, pollIntervalMs = 1_000, timeoutMs = 3 * 60_000, sleep = defaultSleep, now = Date.now } = options;
  const started = await source.resolveProduct(request, { signal });
  const deadline = now() + timeoutMs;
  for (;;) {
    const job = await source.getResolveJob(started.job_id, { signal });
    onJob?.(job);
    if (job.status === 'failed') {
      throw new RivetError({
        kind: 'upstream_unavailable',
        code: job.error?.code ?? 'RESOLVE_FAILED',
        message: job.error?.message ?? 'The product lookup failed.',
        retryable: job.error?.retryable ?? false,
        details: job.error?.details ?? null,
        hint: 'Nothing was stored for this lookup. Try again, or describe the product in words.',
      });
    }
    if (job.status === 'complete') {
      if (!job.resolution_id)
        throw new RivetError({
          kind: 'contract',
          code: 'CONTRACT_VIOLATION',
          message: 'The lookup finished without a result id.',
        });
      return source.getResolution(job.resolution_id, { signal });
    }
    if (now() > deadline)
      throw new RivetError({
        kind: 'timeout',
        code: 'RESOLVE_TIMEOUT',
        message: `The lookup did not finish within ${Math.round(timeoutMs / 1000)} seconds.`,
      });
    await sleep(pollIntervalMs, signal);
  }
}
