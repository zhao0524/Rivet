import { afterEach, describe, expect, it, vi } from "vitest";
import { FixtureSource, HttpSource, createRivetDataSource } from "../index";

describe("createRivetDataSource", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("defaults to the fixture source", () => {
    vi.stubEnv("NEXT_PUBLIC_RIVET_USE_FIXTURES", "");
    expect(createRivetDataSource()).toBeInstanceOf(FixtureSource);
  });

  it("uses HttpSource with NEXT_PUBLIC_RIVET_API_URL when fixtures are disabled", () => {
    vi.stubEnv("NEXT_PUBLIC_RIVET_USE_FIXTURES", "false");
    vi.stubEnv("NEXT_PUBLIC_RIVET_API_URL", "http://example.test:9000/");
    const src = createRivetDataSource({ http: { fetch: (async () => new Response()) as typeof fetch, eventSource: null } });
    expect(src).toBeInstanceOf(HttpSource);
    expect((src as HttpSource).baseUrl).toBe("http://example.test:9000");
  });
});
