import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpSource, RivetError, type EventSourceLike, type JobResponse, type StageEvent } from "../index";
import { rawCatalog, rawPlan } from "./helpers";

type Handler = (req: { url: URL; init: RequestInit }) => Response | Promise<Response>;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function mockFetch(handler: Handler) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const req = { url: new URL(String(input)), init };
    calls.push(req);
    return handler(req);
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

const rejection = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(RivetError);
    return err as RivetError;
  }
  throw new Error("expected rejection");
};

const BASE = "http://api.test:8000/";

describe("HttpSource requests", () => {
  it("getBuild calls the documented route with revision and validates the plan", async () => {
    const { fetch, calls } = mockFetch(() => json(200, rawPlan()));
    const src = new HttpSource({ baseUrl: BASE, fetch, eventSource: null });
    const plan = await src.getBuild("rivet-synthetic-rover-fixture", 1);
    expect(plan.revision).toBe(1);
    expect(calls[0].url.pathname).toBe("/api/projects/rivet-synthetic-rover-fixture");
    expect(calls[0].url.searchParams.get("revision")).toBe("1");
    expect(calls[0].init.method).toBe("GET");
  });

  it("getBuild rejects a plan whose build_id/revision differ from the request", async () => {
    const { fetch } = mockFetch(() => json(200, rawPlan()));
    const err = await rejection(new HttpSource({ baseUrl: BASE, fetch, eventSource: null }).getBuild("rivet-synthetic-rover-fixture", 2));
    expect(err.kind).toBe("contract");
    expect(err.issues).toEqual([{ path: "$.revision", message: "expected 2, got 1" }]);
  });

  it("getCatalog unwraps the envelope and forwards category", async () => {
    const { fetch, calls } = mockFetch(() => json(200, { schema_version: "1.0", components: rawCatalog() }));
    const comps = await new HttpSource({ baseUrl: BASE, fetch, eventSource: null }).getCatalog({ category: "motor" });
    expect(comps).toHaveLength(9);
    expect(calls[0].url.search).toBe("?category=motor");
  });

  it("rejects schema-invalid responses instead of rendering them", async () => {
    const plan = rawPlan();
    plan.components[0].pose = null;
    const { fetch } = mockFetch(() => json(200, plan));
    const err = await rejection(new HttpSource({ baseUrl: BASE, fetch, eventSource: null }).getBuild(plan.build_id));
    expect(err.kind).toBe("contract");
    expect(err.issues[0].path).toBe("$.components[0].pose");
  });

  it("rejects non-JSON success bodies", async () => {
    const { fetch } = mockFetch(() => new Response("<html>", { status: 200 }));
    const err = await rejection(new HttpSource({ baseUrl: BASE, fetch, eventSource: null }).getJob("j1"));
    expect(err.kind).toBe("contract");
    expect(err.message).toContain("not valid JSON");
  });

  it.each([
    [409, { code: "STALE_REVISION", message: "Revision 1 is stale", retryable: false }, "conflict", false],
    [422, { code: "UNSUPPORTED_PROJECT_FAMILY", message: "Drones unsupported", details: { supported_families: ["rover"] }, retryable: false }, "unsupported", false],
    [429, { code: "PROVIDER_QUOTA", message: "Quota" }, "rate_limited", true],
    [503, { code: "ENGINE_DOWN", message: "Engine unavailable", retryable: true }, "upstream_unavailable", true],
  ])("maps HTTP %i error envelopes", async (status, body, kind, retryable) => {
    const { fetch } = mockFetch(() => json(status, { error: body }));
    const src = new HttpSource({ baseUrl: BASE, fetch, eventSource: null });
    const err = await rejection(src.edit("b1", { base_revision: 1, instruction: "Make it cheaper" }));
    expect(err).toMatchObject({ kind, status, code: body.code, message: body.message, retryable });
    expect(err.hint.length).toBeGreaterThan(10);
    if ("details" in body) expect(err.details).toEqual(body.details);
  });

  it("maps non-envelope HTTP errors by status", async () => {
    const { fetch } = mockFetch(() => new Response("Not Found", { status: 404 }));
    const err = await rejection(new HttpSource({ baseUrl: BASE, fetch, eventSource: null }).getJob("j1"));
    expect(err).toMatchObject({ kind: "not_found", code: "HTTP_404", status: 404 });
  });

  it("maps network failures to an actionable network error", async () => {
    const { fetch } = mockFetch(() => {
      throw new TypeError("fetch failed");
    });
    const err = await rejection(new HttpSource({ baseUrl: BASE, fetch, eventSource: null }).getCatalog());
    expect(err).toMatchObject({ kind: "network", retryable: true });
    expect(err.hint).toContain("NEXT_PUBLIC_RIVET_USE_FIXTURES");
  });

  const hanging: Handler = ({ init }) =>
    new Promise((_, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });

  it("times out", async () => {
    const { fetch } = mockFetch(hanging);
    const err = await rejection(new HttpSource({ baseUrl: BASE, fetch, eventSource: null, timeoutMs: 20 }).getCatalog());
    expect(err).toMatchObject({ kind: "timeout", code: "TIMEOUT", retryable: true });
  });

  it("honours a caller AbortSignal", async () => {
    const { fetch } = mockFetch(hanging);
    const ac = new AbortController();
    const p = new HttpSource({ baseUrl: BASE, fetch, eventSource: null }).getCatalog({ signal: ac.signal });
    ac.abort();
    expect((await rejection(p)).kind).toBe("aborted");
  });

  it("validates generate/edit requests before sending", async () => {
    const { fetch, calls } = mockFetch(() => json(200, {}));
    const src = new HttpSource({ baseUrl: BASE, fetch, eventSource: null });
    const err = await rejection(src.generate({ input: { kind: "image_and_text", image_asset_id: null, user_text: "x" } }));
    expect(err.kind).toBe("bad_request");
    expect(calls).toHaveLength(0);
  });

  it("generate posts the documented body", async () => {
    const { fetch, calls } = mockFetch(() => json(200, { job_id: "job-1", status: "queued", build_id: null }));
    const body = { input: { kind: "image_and_text" as const, image_asset_id: "asset-1", user_text: "rover" }, requirements: { max_budget: null } };
    expect(await new HttpSource({ baseUrl: BASE, fetch, eventSource: null }).generate(body)).toEqual({ job_id: "job-1", status: "queued", build_id: null });
    expect(calls[0].url.pathname).toBe("/api/projects/generate");
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init.body))).toEqual(body);
  });
});

class FakeEventSource implements EventSourceLike {
  static instances: FakeEventSource[] = [];
  listeners: Record<string, ((e: { data?: unknown }) => void)[]> = {};
  closed = false;
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, l: (e: { data?: unknown }) => void) {
    (this.listeners[type] ??= []).push(l);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data?: unknown) {
    this.listeners[type]?.forEach((l) => l({ data: data === undefined ? undefined : JSON.stringify(data) }));
  }
}

const ev = (event_id: number, stage: StageEvent["stage"], status: StageEvent["status"] = "running"): StageEvent => ({
  event_id,
  job_id: "job-1",
  stage,
  actor: "planner",
  status,
  message: `${stage} ${event_id}`,
  timestamp: "2026-10-24T00:00:00Z",
  references: [],
});

const job = (status: JobResponse["status"], extra: Partial<JobResponse> = {}): JobResponse => ({
  job_id: "job-1",
  status,
  stage: status === "complete" ? "complete" : "assembly",
  progress: null,
  ...extra,
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("HttpSource.subscribeToJob", () => {
  afterEach(() => {
    FakeEventSource.instances = [];
    vi.useRealTimers();
  });

  it("streams real events, dedupes replayed history after reconnect, then fetches the final job", async () => {
    vi.useFakeTimers();
    const { fetch } = mockFetch(() => json(200, job("complete", { build_id: "b1", revision: 1 })));
    const src = new HttpSource({ baseUrl: BASE, fetch, eventSource: (u) => new FakeEventSource(u), sseReconnectDelayMs: 100 });
    const events: StageEvent[] = [];
    const jobs: JobResponse[] = [];
    const transports: string[] = [];
    src.subscribeToJob("job-1", (e) => events.push(e), { onJob: (j) => jobs.push(j), onTransportChange: (t) => transports.push(t) });

    const first = FakeEventSource.instances[0];
    expect(first.url).toBe("http://api.test:8000/api/jobs/job-1/events");
    first.emit("message", ev(1, "understand"));
    first.emit("stage", ev(2, "catalog_selection"));
    first.emit("error");
    expect(first.closed).toBe(true);

    await vi.advanceTimersByTimeAsync(100);
    const second = FakeEventSource.instances[1];
    second.emit("message", ev(1, "understand")); // replayed history
    second.emit("message", ev(2, "catalog_selection"));
    second.emit("message", ev(3, "validate", "ok"));
    second.emit("message", ev(4, "complete", "ok"));
    await vi.runAllTimersAsync();

    expect(events.map((e) => e.event_id)).toEqual([1, 2, 3, 4]);
    expect(jobs).toEqual([job("complete", { build_id: "b1", revision: 1 })]);
    expect(second.closed).toBe(true);
    expect(transports).toEqual(["closed"]);
  });

  it("reports malformed events without forwarding them", async () => {
    const { fetch } = mockFetch(() => json(200, job("running")));
    const src = new HttpSource({ baseUrl: BASE, fetch, eventSource: (u) => new FakeEventSource(u) });
    const events: StageEvent[] = [];
    const errors: RivetError[] = [];
    const sub = src.subscribeToJob("job-1", (e) => events.push(e), { onError: (e) => errors.push(e) });
    const es = FakeEventSource.instances[0];
    es.emit("message", { ...ev(1, "understand"), stage: "teleport" });
    es.emit("message", { ...ev(2, "understand"), job_id: "other-job" });
    expect(events).toEqual([]);
    expect(errors.map((e) => e.issues[0].path)).toEqual(["$.stage", "$.job_id"]);
    sub.close();
  });

  it("falls back to polling after repeated SSE failures and never synthesizes stage events", async () => {
    vi.useFakeTimers();
    const sequence = [json(503, { error: { code: "BUSY", message: "busy", retryable: true } }), json(200, job("running")), json(200, job("complete", { build_id: "b1", revision: 2 }))];
    const { fetch, calls } = mockFetch(() => sequence.shift()!);
    const src = new HttpSource({
      baseUrl: BASE,
      fetch,
      eventSource: (u) => new FakeEventSource(u),
      maxSseReconnects: 2,
      sseReconnectDelayMs: 10,
      pollIntervalMs: 50,
    });
    const events: StageEvent[] = [];
    const jobs: JobResponse[] = [];
    const transports: string[] = [];
    const sub = src.subscribeToJob("job-1", (e) => events.push(e), { onJob: (j) => jobs.push(j), onTransportChange: (t) => transports.push(t) });

    FakeEventSource.instances[0].emit("error");
    await vi.advanceTimersByTimeAsync(10);
    FakeEventSource.instances[1].emit("error");
    await vi.advanceTimersByTimeAsync(20);
    FakeEventSource.instances[2].emit("error");
    expect(FakeEventSource.instances).toHaveLength(3);
    expect(sub.transport).toBe("polling");
    await vi.runAllTimersAsync();

    expect(events).toEqual([]);
    expect(jobs.map((j) => j.status)).toEqual(["running", "complete"]);
    expect(calls.every((c) => c.url.pathname === "/api/jobs/job-1")).toBe(true);
    expect(transports).toEqual(["polling", "closed"]);
  });

  it("polls directly when EventSource is unavailable and stops on non-retryable errors", async () => {
    const { fetch } = mockFetch(() => json(404, { error: { code: "JOB_NOT_FOUND", message: "No job" } }));
    const src = new HttpSource({ baseUrl: BASE, fetch, eventSource: null });
    const errors: RivetError[] = [];
    const sub = src.subscribeToJob("job-1", () => {}, { onError: (e) => errors.push(e) });
    expect(sub.transport).toBe("polling");
    await flush();
    await flush();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ kind: "not_found", code: "JOB_NOT_FOUND" });
    expect(sub.transport).toBe("closed");
  });

  it("close() stops the stream", () => {
    const { fetch } = mockFetch(() => json(200, job("running")));
    const src = new HttpSource({ baseUrl: BASE, fetch, eventSource: (u) => new FakeEventSource(u) });
    const events: StageEvent[] = [];
    const sub = src.subscribeToJob("job-1", (e) => events.push(e));
    sub.close();
    FakeEventSource.instances[0].emit("message", ev(1, "understand"));
    expect(events).toEqual([]);
    expect(FakeEventSource.instances[0].closed).toBe(true);
  });
});
