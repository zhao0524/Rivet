import { describe, expect, it, vi } from "vitest";
import { FixtureSource, HttpSource, RivetError, estelleStatusState, type EstelleStatusResponse } from "../index";
import { ESTELLE_STATUS, FIXTURE_STATUS_REASON, LEGACY_WEB_STATUS_SHAPE } from "./estelle-payloads";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function sourceAnswering(handler: () => Response | Promise<Response>) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: new URL(String(input)), init });
    return handler();
  }) as unknown as typeof globalThis.fetch;
  return { src: new HttpSource({ baseUrl: "http://api.test:8065", fetch, eventSource: null }), calls };
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

describe("HttpSource.getEstelleStatus accepts every answer the API gives", () => {
  it("accepts the real disabled payload instead of treating it as a failure (#65)", async () => {
    const { src, calls } = sourceAnswering(() => json(200, ESTELLE_STATUS.disabled));
    expect(await src.getEstelleStatus()).toEqual(ESTELLE_STATUS.disabled);
    expect(calls[0].url.pathname).toBe("/api/estelle/status");
    expect(calls[0].init.method).toBe("GET");
  });

  it.each(Object.entries(ESTELLE_STATUS))("accepts the %s payload unchanged", async (_name, payload) => {
    const { src } = sourceAnswering(() => json(200, payload));
    expect(await src.getEstelleStatus()).toEqual(payload);
  });
});

describe("HttpSource.getEstelleStatus rejects anything that is not a valid answer", () => {
  it("rejects the shape the web client used to expect", async () => {
    const { src } = sourceAnswering(() => json(200, LEGACY_WEB_STATUS_SHAPE));
    const err = await rejection(src.getEstelleStatus());
    expect(err.kind).toBe("contract");
    expect(err.issues.map((i) => i.path)).toEqual(["$.available", "$.doctor"]);
  });

  it("rejects a malformed doctor result", async () => {
    const { src } = sourceAnswering(() => json(200, { ...ESTELLE_STATUS.ready, doctor: { exit_code: "0", output_tail: "" } }));
    const err = await rejection(src.getEstelleStatus());
    expect(err.issues).toEqual([{ path: "$.doctor.exit_code", message: 'expected integer, got "0"' }]);
  });

  it("rejects a non-JSON body", async () => {
    const { src } = sourceAnswering(() => new Response("<html>proxy error</html>", { status: 200 }));
    const err = await rejection(src.getEstelleStatus());
    expect(err.kind).toBe("contract");
    expect(err.message).toContain("not valid JSON");
  });

  it.each([
    [500, "server"],
    [503, "upstream_unavailable"],
  ])("maps HTTP %i to a %s error", async (status, kind) => {
    const { src } = sourceAnswering(() => new Response("Internal Server Error", { status }));
    expect(await rejection(src.getEstelleStatus())).toMatchObject({ kind, status, code: `HTTP_${status}` });
  });

  it("maps a failed fetch to a network error", async () => {
    const { src } = sourceAnswering(() => {
      throw new TypeError("fetch failed");
    });
    expect(await rejection(src.getEstelleStatus())).toMatchObject({ kind: "network", code: "NETWORK_ERROR" });
  });
});

describe("estelleStatusState", () => {
  it("reports the feature flag being off as disabled", () => {
    expect(estelleStatusState(ESTELLE_STATUS.disabled, "http")).toEqual({ kind: "disabled", status: ESTELLE_STATUS.disabled });
  });

  it.each([["cliMissing"], ["notAuthenticated"], ["mcpMode"]] as const)("reports %s as unavailable with the API's reason", (name) => {
    expect(estelleStatusState(ESTELLE_STATUS[name], "http")).toEqual({ kind: "unavailable", status: ESTELLE_STATUS[name] });
  });

  it("is ready only when enabled and available", () => {
    expect(estelleStatusState(ESTELLE_STATUS.ready, "http")).toEqual({ kind: "ready", status: ESTELLE_STATUS.ready });
    const contradictory: EstelleStatusResponse = { ...ESTELLE_STATUS.ready, enabled: false };
    expect(estelleStatusState(contradictory, "http").kind).toBe("disabled");
  });

  it("never reports fixture mode as ready or disabled", () => {
    expect(estelleStatusState(ESTELLE_STATUS.ready, "fixture").kind).toBe("unavailable");
    expect(estelleStatusState(ESTELLE_STATUS.disabled, "fixture").kind).toBe("unavailable");
  });
});

describe("FixtureSource.getEstelleStatus", () => {
  it("stays honest: unavailable in fixture mode, with its reason", async () => {
    const source = new FixtureSource();
    const status = await source.getEstelleStatus();
    expect(status).toEqual({ enabled: false, mode: "fixture", available: false, doctor: null, reason: FIXTURE_STATUS_REASON });
    expect(estelleStatusState(status, source.mode)).toEqual({ kind: "unavailable", status });
  });
});
