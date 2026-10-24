import { describe, expect, it, vi } from "vitest";
import { FixtureSource, HttpSource, RivetError } from "../index";
import { RAW_OFFER_FIXTURES, offerFixture } from "../../offers/fixtures";
import type { OfferSet } from "../../offers/types";

const rejection = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(RivetError);
    return err as RivetError;
  }
  throw new Error("expected rejection");
};

describe("FixtureSource offers", () => {
  const source = new FixtureSource();

  it("serves the saved set for a catalog part named by a fixture, with server-side params applied", async () => {
    const set = await source.getPartOffers("motor.adafruit_tt_bimetal_1to90_3801");
    expect(set.offers[0].vendor.id).toBe("adafruit");
    expect(set.provider_mode).toBe("recorded");
    const filtered = await source.getPartOffers("chassis.sparkfun_shadow_rob13301", { in_stock: true });
    expect(filtered.offers).toEqual([]);
    expect(filtered.outcome).toBe("found");
  });

  it("refuses demo.* parts like the API's 422 EXPORT_REFUSED_SYNTHETIC and carries the refused set", async () => {
    const err = await rejection(source.getPartOffers("demo.tt_motor"));
    expect(err.kind).toBe("unsupported");
    expect(err.status).toBe(422);
    expect(err.code).toBe("EXPORT_REFUSED_SYNTHETIC");
    const refused = err.details?.offer_set as OfferSet;
    expect(refused.outcome).toBe("refused");
    expect(refused.query.catalog_id).toBe("demo.tt_motor");
    expect(refused.offers).toEqual([]);
  });

  it("answers an unknown part with the not-found shape and the query substituted, never a link", async () => {
    const set = await source.getPartOffers("board.someone_elses_part");
    expect(set.outcome).toBe("not_found");
    expect(set.offers).toEqual([]);
    expect(set.query.catalog_id).toBe("board.someone_elses_part");
    expect(set.provider_mode).toBe("stub");
    expect(set.ledger.every((e) => e.status !== "offer")).toBe(true);
  });

  it("searchOffers matches on the normalised key and requires an identifier", async () => {
    const set = await source.searchOffers({ sku: " TEST-mv-3801 ", mpn: "MV3801", manufacturer: "Maker  Shop (TEST)" });
    expect(set.synthetic).toBe(true);
    expect(set.offers).toHaveLength(8);
    const none = await source.searchOffers({ sku: "nothing-here" });
    expect(none.outcome).toBe("not_found");
    expect(none.query.normalized_key).toBe("nothing-here|||");
    const err = await rejection(source.searchOffers({ manufacturer: "Adafruit" }));
    expect(err.code).toBe("INVALID_IDENTIFIER");
  });

  it("getOfferSet addresses fixtures by name and 404s otherwise", async () => {
    expect((await source.getOfferSet("synthetic-multivendor")).synthetic).toBe(true);
    const err = await rejection(source.getOfferSet("offer-set-123"));
    expect(err.code).toBe("OFFER_SET_NOT_FOUND");
  });

  it("returns copies and never touches the network", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const a = await source.getOfferSet("adafruit-3801");
    a.offers[0].price_amount = "1.00";
    expect((await source.getOfferSet("adafruit-3801")).offers[0].price_amount).toBe("4.50");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

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

const BASE = "http://api.test:8000";
const http = (fetchImpl: typeof globalThis.fetch) =>
  new HttpSource({ baseUrl: BASE, fetch: fetchImpl, eventSource: null, pollIntervalMs: 1 });

describe("HttpSource offers", () => {
  it("getPartOffers builds the documented query with a repeatable vendor_tier and validates the set", async () => {
    const { fetch, calls } = mockFetch(() => json(200, RAW_OFFER_FIXTURES["adafruit-3801"]));
    const set = await http(fetch).getPartOffers("motor.adafruit_tt_bimetal_1to90_3801", {
      sort: "price_asc",
      vendor_tier: ["manufacturer", "authorized_distributor"],
      in_stock: true,
      min_rating: 4,
      max_price: "5.00",
      currency: "USD",
    });
    expect(set.offers[0].offer_id).toBe("adafruit:1e23de30a1c22803");
    expect(calls[0].url.pathname).toBe("/api/parts/motor.adafruit_tt_bimetal_1to90_3801/offers");
    expect(calls[0].url.searchParams.getAll("vendor_tier")).toEqual(["manufacturer", "authorized_distributor"]);
    expect(calls[0].url.searchParams.get("sort")).toBe("price_asc");
    expect(calls[0].url.searchParams.get("in_stock")).toBe("true");
    expect(calls[0].url.searchParams.get("min_rating")).toBe("4");
    expect(calls[0].url.searchParams.get("max_price")).toBe("5.00");
    expect(calls[0].url.searchParams.get("currency")).toBe("USD");
  });

  it("rejects an OfferSet with a javascript: URL instead of rendering it", async () => {
    const bad = offerFixture("adafruit-3801");
    bad.offers[0].url = "javascript:alert(1)";
    const { fetch } = mockFetch(() => json(200, bad));
    const err = await rejection(http(fetch).getPartOffers("motor.adafruit_tt_bimetal_1to90_3801"));
    expect(err.kind).toBe("contract");
    expect(err.issues[0].path).toBe("$.offers[0].url");
  });

  it("maps the 422 EXPORT_REFUSED_SYNTHETIC envelope", async () => {
    const { fetch } = mockFetch(() =>
      json(422, { error: { code: "EXPORT_REFUSED_SYNTHETIC", message: "demo part", details: {}, retryable: false } }),
    );
    const err = await rejection(http(fetch).getPartOffers("demo.tt_motor"));
    expect(err.kind).toBe("unsupported");
    expect(err.code).toBe("EXPORT_REFUSED_SYNTHETIC");
    expect(err.status).toBe(422);
  });

  it("maps 404 PART_NOT_FOUND", async () => {
    const { fetch } = mockFetch(() => json(404, { error: { code: "PART_NOT_FOUND", message: "no such part" } }));
    const err = await rejection(http(fetch).getPartOffers("nope"));
    expect(err.kind).toBe("not_found");
    expect(err.code).toBe("PART_NOT_FOUND");
  });

  it("searchOffers returns a synchronous 200 OfferSet directly", async () => {
    const { fetch, calls } = mockFetch(() => json(200, RAW_OFFER_FIXTURES["sparkfun-rob-13301"]));
    const set = await http(fetch).searchOffers({ sku: "ROB-13301", manufacturer: "SparkFun", sort: "rating" });
    expect(set.query.sku).toBe("ROB-13301");
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ sku: "ROB-13301", manufacturer: "SparkFun", sort: "rating" });
  });

  it("searchOffers follows a 202 job to completion and fetches the offer set it names", async () => {
    let polls = 0;
    const { fetch, calls } = mockFetch(({ url }) => {
      if (url.pathname === "/api/offers/search") return json(202, { job_id: "job-offers-1", status: "queued", offer_set_id: null });
      if (url.pathname === "/api/jobs/job-offers-1") {
        polls += 1;
        return polls < 3
          ? json(200, { job_id: "job-offers-1", status: "running", stage: "catalog_selection", progress: null })
          : json(200, { job_id: "job-offers-1", status: "complete", stage: "complete", progress: null, offer_set_id: "offer-set-9" });
      }
      if (url.pathname === "/api/offers/offer-set-9") return json(200, RAW_OFFER_FIXTURES["adafruit-3801"]);
      return json(404, { error: { code: "NOT_FOUND", message: url.pathname } });
    });
    const set = await http(fetch).searchOffers({ sku: "3801" });
    expect(set.offers).toHaveLength(1);
    expect(polls).toBe(3);
    expect(calls.map((c) => c.url.pathname).at(-1)).toBe("/api/offers/offer-set-9");
  });

  it("searchOffers surfaces a failed discovery job as a RivetError", async () => {
    const { fetch } = mockFetch(({ url }) => {
      if (url.pathname === "/api/offers/search") return json(202, { job_id: "job-x", status: "queued", offer_set_id: null });
      return json(200, {
        job_id: "job-x",
        status: "failed",
        stage: "failed",
        progress: null,
        error: { code: "PROVIDER_QUOTA", message: "quota", retryable: true },
      });
    });
    const err = await rejection(http(fetch).searchOffers({ mpn: "MV3801" }));
    expect(err.code).toBe("PROVIDER_QUOTA");
    expect(err.retryable).toBe(true);
  });

  it("searchOffers rejects a completed job that names no offer set", async () => {
    const { fetch } = mockFetch(({ url }) => {
      if (url.pathname === "/api/offers/search") return json(202, { job_id: "job-y", status: "queued", offer_set_id: null });
      return json(200, { job_id: "job-y", status: "complete", stage: "complete", progress: null });
    });
    const err = await rejection(http(fetch).searchOffers({ gtin: "01234565" }));
    expect(err.kind).toBe("contract");
    expect(err.issues[0].path).toBe("$.offer_set_id");
  });

  it("searchOffers refuses to send a body without any identifier", async () => {
    const { fetch, calls } = mockFetch(() => json(200, {}));
    const err = await rejection(http(fetch).searchOffers({ manufacturer: "x" }));
    expect(err.code).toBe("INVALID_IDENTIFIER");
    expect(calls).toHaveLength(0);
  });
});
