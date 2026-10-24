import { describe, expect, it, vi } from "vitest";
import { HttpSource, RivetError } from "../index";
import exactMatch from "../../resolve/__tests__/api-samples/exact_match.json";
import jobComplete from "../../resolve/__tests__/api-samples/job_complete.json";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function source(handler: (url: URL, init: RequestInit) => Response) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    return handler(url, init);
  }) as unknown as typeof globalThis.fetch;
  return { src: new HttpSource({ baseUrl: "http://api.test:8000", fetch, eventSource: null }), calls };
}

describe("HttpSource product resolution", () => {
  it("POSTs /api/resolve with the input and returns the job", async () => {
    const { src, calls } = source(() => json(202, { job_id: "job-1", status: "queued", resolution_id: null }));
    const res = await src.resolveProduct({ input: { kind: "text", image_asset_id: null, user_text: "DJI Mini 4" } });
    expect(res.job_id).toBe("job-1");
    expect(calls[0].url.pathname).toBe("/api/resolve");
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      input: { kind: "text", image_asset_id: null, user_text: "DJI Mini 4" },
    });
  });

  it("refuses an invalid request without sending it", async () => {
    const { src, calls } = source(() => json(202, {}));
    await expect(src.resolveProduct({ input: { kind: "image", image_asset_id: null, user_text: null } })).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
    expect(calls).toHaveLength(0);
  });

  it("reads a resolve job, whose stages are not the generate pipeline's", async () => {
    const { src } = source(() => json(200, jobComplete));
    const job = await src.getResolveJob(jobComplete.job_id);
    expect(job.resolution_id).toBe(jobComplete.resolution_id);
  });

  it("fetches and validates a stored resolution", async () => {
    const { src, calls } = source(() => json(200, exactMatch));
    const r = await src.getResolution(exactMatch.resolution_id);
    expect(r.outcome).toBe("exact_match");
    expect(calls[0].url.pathname).toBe(`/api/resolutions/${exactMatch.resolution_id}`);
  });

  it("rejects a resolution for a different id or a malformed one", async () => {
    const other = source(() => json(200, exactMatch));
    await expect(other.src.getResolution("res-000000000000")).rejects.toMatchObject({ kind: "contract" });
    const bad = source(() => json(200, { ...exactMatch, outcome: "maybe" }));
    await expect(bad.src.getResolution(exactMatch.resolution_id)).rejects.toMatchObject({ kind: "contract" });
  });

  it("maps the API error envelope, e.g. live mode without a live resolver", async () => {
    const { src } = source(() =>
      json(503, {
        error: {
          code: "RESOLVER_UNAVAILABLE",
          message: "No live product resolver is configured, so this product cannot be looked up",
          details: { resolver: "stub" },
          retryable: false,
        },
      }),
    );
    const err = await src.resolveProduct({ input: { kind: "text", image_asset_id: null, user_text: "x" } }).catch((e) => e);
    expect(err).toBeInstanceOf(RivetError);
    expect(err.code).toBe("RESOLVER_UNAVAILABLE");
    expect(err.retryable).toBe(false);
  });
});
