/** Data source for the documented `/api/*` routes (implementation.md §3.5). */
import type {
  ExportArtifactKind,
  JobSubscription,
  JobSubscriptionOptions,
  JobTransport,
  RequestOptions,
  RivetDataSource,
} from "./data-source";
import { errorFromHttp, RivetContractError, RivetError } from "./errors";
import type {
  BuildPlan,
  CatalogComponent,
  EditRequest,
  EditResponse,
  EstelleGroundRequest,
  EstelleGroundResponse,
  EstelleStatusResponse,
  GenerateRequest,
  GenerateResponse,
  InterpretResponse,
  HealthResponse,
  JobResponse,
  RevisionSummary,
  SavedExampleSummary,
  StageEvent,
  UploadedImageAsset,
} from "./types";
import {
  assertValidRequest,
  buildPlanCheck,
  catalogResponseCheck,
  editRequestCheck,
  editResponseCheck,
  estelleGroundResponseCheck,
  estelleStatusResponseCheck,
  extractApiErrorBody,
  generateRequestCheck,
  generateResponseCheck,
  interpretResponseCheck,
  healthResponseCheck,
  jobResponseCheck,
  parseOrThrow,
   parseStageEvent,
  revisionsResponseCheck,
  savedExamplesResponseCheck,
  uploadedImageAssetCheck,
  type Check,
} from "./validate";
import type { Resolution, ResolveJob, ResolveRequest, ResolveStartResponse } from "../resolve/types";
import { resolutionCheck, resolveJobCheck, resolveStartResponseCheck } from "../resolve/validate";

/** Minimal EventSource surface so tests and non-browser runtimes can inject one. */
export interface EventSourceLike {
  addEventListener(type: string, listener: (event: { data?: unknown }) => void): void;
  close(): void;
}
export type EventSourceFactory = (url: string) => EventSourceLike;

export interface HttpSourceOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  /** Default per-request timeout. */
  timeoutMs?: number;
  /** `null` disables SSE (always poll). Defaults to `globalThis.EventSource` when present. */
  eventSource?: EventSourceFactory | null;
  /** SSE event names to listen to; defaults to unnamed `message` events and `stage`. */
  sseEventNames?: string[];
  /** Consecutive SSE failures tolerated before falling back to polling. */
  maxSseReconnects?: number;
  sseReconnectDelayMs?: number;
  pollIntervalMs?: number;
  maxConsecutivePollErrors?: number;
  /** Give up polling after this long. */
  pollTimeoutMs?: number;
}

const TERMINAL_JOB_STATUSES = new Set(["complete", "failed"]);
const TERMINAL_STAGES = new Set(["complete", "failed"]);

function defaultEventSource(): EventSourceFactory | null {
  const ES = (globalThis as { EventSource?: new (url: string) => EventSourceLike }).EventSource;
  return ES ? (url) => new ES(url) : null;
}

export class HttpSource implements RivetDataSource {
  readonly mode = "http" as const;
  readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly eventSource: EventSourceFactory | null;
  private readonly sseEventNames: string[];
  private readonly maxSseReconnects: number;
  private readonly sseReconnectDelayMs: number;
  private readonly pollIntervalMs: number;
  private readonly maxConsecutivePollErrors: number;
  private readonly pollTimeoutMs: number;

  constructor(options: HttpSourceOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    const f = options.fetch ?? globalThis.fetch;
    if (!f) throw new Error("HttpSource requires a fetch implementation");
    this.fetchImpl = f.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.eventSource = options.eventSource === undefined ? defaultEventSource() : options.eventSource;
    this.sseEventNames = options.sseEventNames ?? ["message", "stage"];
    this.maxSseReconnects = options.maxSseReconnects ?? 3;
    this.sseReconnectDelayMs = options.sseReconnectDelayMs ?? 1_000;
    this.pollIntervalMs = options.pollIntervalMs ?? 1_500;
    this.maxConsecutivePollErrors = options.maxConsecutivePollErrors ?? 5;
    this.pollTimeoutMs = options.pollTimeoutMs ?? 10 * 60_000;
  }

  private url(path: string, query?: Record<string, string | number | undefined>) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) params.set(k, String(v));
    const qs = params.toString();
    return `${this.baseUrl}${path}${qs ? `?${qs}` : ""}`;
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    check: Check<T>,
    what: string,
    init: { body?: unknown; query?: Record<string, string | number | undefined>; options?: RequestOptions } = {},
  ): Promise<T> {
    const controller = new AbortController();
    const userSignal = init.options?.signal;
    let timedOut = false;
    const onUserAbort = () => controller.abort(userSignal?.reason);
    if (userSignal?.aborted) onUserAbort();
    else userSignal?.addEventListener("abort", onUserAbort, { once: true });
    const timeoutMs = init.options?.timeoutMs ?? this.timeoutMs;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const label = `${method} ${path}`;

    const transportError = (cause: unknown): RivetError => {
      if (timedOut)
        return new RivetError({ kind: "timeout", code: "TIMEOUT", message: `${label} timed out after ${timeoutMs} ms`, cause });
      if (userSignal?.aborted) return new RivetError({ kind: "aborted", code: "ABORTED", message: `${label} was aborted`, cause });
      return new RivetError({
        kind: "network",
        code: "NETWORK_ERROR",
        message: `Could not reach ${this.baseUrl} (${label})`,
        cause,
      });
    };

    try {
      let res: Response;
      let text: string;
      try {
        res = await this.fetchImpl(this.url(path, init.query), {
          method,
          headers: init.body === undefined ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" },
          body: init.body === undefined ? undefined : JSON.stringify(init.body),
          signal: controller.signal,
        });
        text = await res.text();
      } catch (cause) {
        throw transportError(cause);
      }
      let json: unknown;
      let jsonOk = true;
      try {
        json = text === "" ? null : JSON.parse(text);
      } catch {
        jsonOk = false;
      }
      if (!res.ok) {
        throw errorFromHttp(res.status, jsonOk ? extractApiErrorBody(json) : null, `${label} failed with HTTP ${res.status}`);
      }
      if (!jsonOk) throw new RivetContractError(`${what} from ${label}`, [{ path: "$", message: "response body is not valid JSON" }]);
      return parseOrThrow(check, json, `${what} from ${label}`);
    } finally {
      clearTimeout(timer);
      userSignal?.removeEventListener("abort", onUserAbort);
    }
  }

  health(options?: RequestOptions): Promise<HealthResponse> {
    return this.request("GET", "/api/health", healthResponseCheck, "health response", { options });
  }

  async getCatalog(options?: RequestOptions & { category?: string }): Promise<CatalogComponent[]> {
    const res = await this.request("GET", "/api/catalog", catalogResponseCheck, "catalog response", {
      query: { category: options?.category },
      options,
    });
    return res.components;
  }

  async getBuild(buildId: string, revision?: number, options?: RequestOptions): Promise<BuildPlan> {
    const path = `/api/projects/${encodeURIComponent(buildId)}`;
    const plan = await this.request("GET", path, buildPlanCheck, "BuildPlan", { query: { revision }, options });
    const issues: { path: string; message: string }[] = [];
    if (plan.build_id !== buildId) issues.push({ path: "$.build_id", message: `expected "${buildId}", got "${plan.build_id}"` });
    if (revision !== undefined && plan.revision !== revision)
      issues.push({ path: "$.revision", message: `expected ${revision}, got ${plan.revision}` });
    if (issues.length > 0) throw new RivetContractError(`BuildPlan from GET ${path}`, issues);
    return plan;
  }

  async interpret(input: GenerateRequest, options?: RequestOptions): Promise<InterpretResponse> {
    assertValidRequest(generateRequestCheck, input, "InterpretRequest");
    return this.request("POST", "/api/intents/interpret", interpretResponseCheck, "interpretation", { body: input, options: { timeoutMs: 90_000, ...options } });
  }

  async generate(input: GenerateRequest, options?: RequestOptions): Promise<GenerateResponse> {
    assertValidRequest(generateRequestCheck, input, "GenerateRequest");
    return this.request("POST", "/api/projects/generate", generateResponseCheck, "generate response", { body: input, options });
  }

  async edit(buildId: string, request: EditRequest, options?: RequestOptions): Promise<EditResponse> {
    assertValidRequest(editRequestCheck, request, "EditRequest");
    return this.request("POST", `/api/projects/${encodeURIComponent(buildId)}/edits`, editResponseCheck, "edit response", {
      body: request,
      options,
    });
  }

  getJob(jobId: string, options?: RequestOptions): Promise<JobResponse> {
    return this.request("GET", `/api/jobs/${encodeURIComponent(jobId)}`, jobResponseCheck, "job response", { options });
  }

  /**
   * Streams real stage events over SSE. On repeated SSE failure it reconnects
   * (deduplicating replayed history by `event_id`), then falls back to polling
   * `GET /api/jobs/{id}`. Polling reports job snapshots via `onJob` only; it
   * never synthesizes stage events.
   */
  subscribeToJob(jobId: string, onEvent: (event: StageEvent) => void, options: JobSubscriptionOptions = {}): JobSubscription {
    let transport: JobTransport = "sse";
    let closed = false;
    let lastEventId = 0;
    let sseFailures = 0;
    let es: EventSourceLike | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const inflight = new AbortController();

    const setTransport = (t: JobTransport) => {
      if (transport === t) return;
      transport = t;
      options.onTransportChange?.(t);
    };
    const report = (err: unknown) => {
      if (closed) return;
      if (err instanceof RivetError) {
        if (err.kind !== "aborted") options.onError?.(err);
      } else {
        options.onError?.(new RivetError({ kind: "unknown", code: "UNKNOWN", message: String(err), cause: err }));
      }
    };
    const close = () => {
      if (closed) return;
      closed = true;
      es?.close();
      es = null;
      if (timer) clearTimeout(timer);
      inflight.abort();
      setTransport("closed");
    };
    options.signal?.addEventListener("abort", close, { once: true });

    const finishWithJob = async () => {
      try {
        const job = await this.getJob(jobId, { signal: inflight.signal });
        if (!closed) options.onJob?.(job);
      } catch (err) {
        report(err);
      }
      close();
    };

    const startPolling = () => {
      if (closed) return;
      es?.close();
      es = null;
      setTransport("polling");
      const deadline = Date.now() + this.pollTimeoutMs;
      let consecutiveErrors = 0;
      const poll = async () => {
        if (closed) return;
        if (Date.now() > deadline) {
          report(new RivetError({ kind: "timeout", code: "JOB_POLL_TIMEOUT", message: `Job ${jobId} did not finish within ${this.pollTimeoutMs} ms` }));
          close();
          return;
        }
        try {
          const job = await this.getJob(jobId, { signal: inflight.signal });
          if (closed) return;
          consecutiveErrors = 0;
          options.onJob?.(job);
          if (TERMINAL_JOB_STATUSES.has(job.status)) {
            close();
            return;
          }
        } catch (err) {
          if (closed) return;
          consecutiveErrors += 1;
          const retryable = err instanceof RivetError && err.retryable;
          if (!retryable || consecutiveErrors > this.maxConsecutivePollErrors) {
            report(err);
            close();
            return;
          }
        }
        timer = setTimeout(poll, this.pollIntervalMs);
      };
      void poll();
    };

    const handleMessage = (msg: { data?: unknown }) => {
      if (closed) return;
      let event: StageEvent;
      try {
        event = parseStageEvent(typeof msg.data === "string" ? JSON.parse(msg.data) : msg.data);
      } catch (err) {
        report(err instanceof RivetError ? err : new RivetContractError("stage event", [{ path: "$", message: "event data is not valid JSON" }], err));
        return;
      }
      if (event.job_id !== jobId) {
        report(new RivetContractError("stage event", [{ path: "$.job_id", message: `expected "${jobId}", got "${event.job_id}"` }]));
        return;
      }
      if (event.event_id <= lastEventId) return;
      lastEventId = event.event_id;
      sseFailures = 0;
      onEvent(event);
      if (TERMINAL_STAGES.has(event.stage)) {
        es?.close();
        es = null;
        void finishWithJob();
      }
    };

    const openSse = () => {
      if (closed) return;
      if (!this.eventSource) {
        startPolling();
        return;
      }
      let source: EventSourceLike;
      try {
        source = this.eventSource(this.url(`/api/jobs/${encodeURIComponent(jobId)}/events`));
      } catch {
        startPolling();
        return;
      }
      es = source;
      setTransport("sse");
      for (const name of this.sseEventNames) source.addEventListener(name, handleMessage);
      source.addEventListener("error", () => {
        if (closed || es !== source) return;
        source.close();
        es = null;
        sseFailures += 1;
        if (sseFailures > this.maxSseReconnects) startPolling();
        else timer = setTimeout(openSse, this.sseReconnectDelayMs * sseFailures);
      });
    };

    openSse();
    return {
      get transport() {
        return transport;
      },
      close,
    };
  }

  async uploadImage(file: File, options?: RequestOptions): Promise<UploadedImageAsset> {
    const controller = new AbortController();
    const userSignal = options?.signal;
    let timedOut = false;
    const onUserAbort = () => controller.abort(userSignal?.reason);
    if (userSignal?.aborted) onUserAbort();
    else userSignal?.addEventListener("abort", onUserAbort, { once: true });
    const timeoutMs = options?.timeoutMs ?? this.timeoutMs;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const label = "POST /api/assets/images";
    try {
      const form = new FormData();
      form.append("file", file);
      let res: Response;
      let text: string;
      try {
        res = await this.fetchImpl(this.url("/api/assets/images"), {
          method: "POST",
          headers: { Accept: "application/json" },
          body: form,
          signal: controller.signal,
        });
        text = await res.text();
      } catch (cause) {
        if (timedOut) {
          throw new RivetError({ kind: "timeout", code: "TIMEOUT", message: `${label} timed out after ${timeoutMs} ms`, cause });
        }
        if (userSignal?.aborted) {
          throw new RivetError({ kind: "aborted", code: "ABORTED", message: `${label} was aborted`, cause });
        }
        throw new RivetError({
          kind: "network",
          code: "NETWORK_ERROR",
          message: `Could not reach ${this.baseUrl} (${label})`,
          cause,
        });
      }
      let json: unknown = null;
      let jsonOk = true;
      try {
        json = text === "" ? null : JSON.parse(text);
      } catch {
        jsonOk = false;
      }
      if (!res.ok) {
        throw errorFromHttp(res.status, jsonOk ? extractApiErrorBody(json) : null, `${label} failed with HTTP ${res.status}`);
      }
      if (!jsonOk) {
        throw new RivetContractError(`upload response from ${label}`, [{ path: "$", message: "response body is not valid JSON" }]);
      }
      return parseOrThrow(uploadedImageAssetCheck, json, `upload response from ${label}`);
    } finally {
      clearTimeout(timer);
      userSignal?.removeEventListener("abort", onUserAbort);
    }
  }

  async listExamples(options?: RequestOptions): Promise<SavedExampleSummary[]> {
    const res = await this.request("GET", "/api/projects/examples", savedExamplesResponseCheck, "examples response", {
      options,
    });
    return res.examples;
  }

  async listRevisions(buildId: string, options?: RequestOptions): Promise<RevisionSummary[]> {
    const res = await this.request(
      "GET",
      `/api/projects/${encodeURIComponent(buildId)}/revisions`,
      revisionsResponseCheck,
      "revisions response",
      { options },
    );
    return res.revisions;
  }

  getEstelleStatus(options?: RequestOptions): Promise<EstelleStatusResponse> {
    return this.request("GET", "/api/estelle/status", estelleStatusResponseCheck, "Estelle status response", { options });
  }

  groundSymbol(request: EstelleGroundRequest, options?: RequestOptions): Promise<EstelleGroundResponse> {
    return this.request("POST", "/api/estelle/ground", estelleGroundResponseCheck, "Estelle ground response", {
      body: request,
      options,
    });
  }

  async resolveProduct(request: ResolveRequest, options?: RequestOptions): Promise<ResolveStartResponse> {
    assertValidRequest(generateRequestCheck, request, "ResolveRequest");
    return this.request("POST", "/api/resolve", resolveStartResponseCheck, "resolve response", { body: request, options });
  }

  getResolveJob(jobId: string, options?: RequestOptions): Promise<ResolveJob> {
    return this.request("GET", `/api/jobs/${encodeURIComponent(jobId)}`, resolveJobCheck, "resolve job response", { options });
  }

  async getResolution(resolutionId: string, options?: RequestOptions): Promise<Resolution> {
    const path = `/api/resolutions/${encodeURIComponent(resolutionId)}`;
    const resolution = await this.request("GET", path, resolutionCheck, "resolution", { options });
    if (resolution.resolution_id !== resolutionId)
      throw new RivetContractError(`resolution from GET ${path}`, [
        { path: "$.resolution_id", message: `expected "${resolutionId}", got "${resolution.resolution_id}"` },
      ]);
    return resolution;
  }

  getExportUrl(buildId: string, kind: ExportArtifactKind, revision?: number): string {
    return this.url(`/api/projects/${encodeURIComponent(buildId)}/exports/${kind}`, { revision });
  }
}
