import { describe, expect, it } from "vitest";
import {
  FixtureSource,
  RivetError,
  SAVED_SYNTHETIC_EXAMPLE_LABEL,
  SYNTHETIC_ROVER_BUILD_ID,
  bomLinkFor,
  describeBuildTrust,
  summarizeBom,
  type StageEvent,
} from "../index";
import { rawCatalog, rawPlan } from "./helpers";

const rejection = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(RivetError);
    return err as RivetError;
  }
  throw new Error("expected rejection");
};

describe("FixtureSource.getBuild / getCatalog", () => {
  const source = new FixtureSource();

  it("returns the saved synthetic plan by build_id, latest or explicit revision", async () => {
    const latest = await source.getBuild(SYNTHETIC_ROVER_BUILD_ID);
    expect(latest.build_id).toBe(SYNTHETIC_ROVER_BUILD_ID);
    expect(latest.revision).toBe(1);
    expect(latest.components).toHaveLength(11);
    expect(await source.getBuild(SYNTHETIC_ROVER_BUILD_ID, 1)).toEqual(latest);
  });

  it("reports unknown builds and revisions as not_found", async () => {
    const missing = await rejection(source.getBuild("nope"));
    expect(missing.code).toBe("BUILD_NOT_FOUND");
    expect(missing.details).toEqual({ available_build_ids: [SYNTHETIC_ROVER_BUILD_ID] });
    const rev = await rejection(source.getBuild(SYNTHETIC_ROVER_BUILD_ID, 7));
    expect(rev.kind).toBe("not_found");
    expect(rev.code).toBe("REVISION_NOT_FOUND");
  });

  it("returns copies so callers cannot mutate the saved fixture", async () => {
    const a = await source.getBuild(SYNTHETIC_ROVER_BUILD_ID);
    a.components[0].pose.position_mm[1] = 999;
    const catalog = await source.getCatalog();
    catalog[0].sourcing.price_amount = "1.00";
    expect((await source.getBuild(SYNTHETIC_ROVER_BUILD_ID)).components[0].pose.position_mm[1]).toBe(10);
    expect((await source.getCatalog())[0].sourcing.price_amount).toBeNull();
  });

  it("fails closed when a saved fixture violates the contract", async () => {
    const plan = rawPlan();
    plan.connections[0].to.instance_id = "driver-404";
    const bad = new FixtureSource({ plans: [plan] });
    const err = await rejection(bad.getBuild(SYNTHETIC_ROVER_BUILD_ID));
    expect(err.kind).toBe("contract");
    expect(err.issues[0].path).toBe("$.connections[0].to.instance_id");

    const catalog = rawCatalog().filter((c) => c.catalog_id !== "demo.range");
    const err2 = await rejection(new FixtureSource({ catalog }).getCatalog());
    expect(err2.message).toContain('"demo.range" is not in the catalog');
  });

  it("honors an already-aborted signal", async () => {
    const ac = new AbortController();
    ac.abort();
    expect((await rejection(source.getCatalog({ signal: ac.signal }))).kind).toBe("aborted");
  });
});

describe("FixtureSource honesty", () => {
  const source = new FixtureSource();

  it("is labelled as a saved synthetic example and never displayable as verified", async () => {
    expect(source.mode).toBe("fixture");
    expect(source.label).toBe(SAVED_SYNTHETIC_EXAMPLE_LABEL);
    const plan = await source.getBuild(SYNTHETIC_ROVER_BUILD_ID);
    const catalog = await source.getCatalog();
    expect(plan.status).toBe("needs_review");
    expect(plan.provenance.generation_mode).toBe("fixture");
    const trust = describeBuildTrust(plan, source.mode, catalog);
    expect(trust).toMatchObject({ label: SAVED_SYNTHETIC_EXAMPLE_LABEL, isSynthetic: true, isSaved: true, canDisplayAsVerified: false });
    expect(plan.verification.findings.some((f) => f.result === "UNKNOWN" && f.severity === "blocking")).toBe(true);
  });

  it("preserves null prices and unknown links instead of inventing them", async () => {
    const plan = await source.getBuild(SYNTHETIC_ROVER_BUILD_ID);
    for (const item of plan.bom.items) {
      expect(item.unit_price_amount).toBeNull();
      expect(item.purchase_url).toBeNull();
      expect(item.link_status).toBe("not_available");
      expect(bomLinkFor(item)).toEqual({ href: null, kind: "none" });
    }
    expect(plan.bom.known_subtotal_amount).toBeNull();
    expect(summarizeBom(plan)).toMatchObject({ totalLabel: "Total unavailable", knownSubtotal: null, unpricedRowCount: plan.bom.items.length });
    for (const c of await source.getCatalog()) {
      expect(c.sourcing.price_amount).toBeNull();
      expect(c.sourcing.purchase_url).toBeNull();
      expect(c.sourcing.availability_status).toBe("unknown");
    }
  });

  it("generate returns the saved job as already complete, with no invented progress", async () => {
    const res = await source.generate({ input: { kind: "text", image_asset_id: null, user_text: "Build a rover" } });
    expect(res).toEqual({ job_id: `saved-fixture:${SYNTHETIC_ROVER_BUILD_ID}@1`, status: "complete", build_id: SYNTHETIC_ROVER_BUILD_ID });
    const job = await source.getJob(res.job_id);
    expect(job).toMatchObject({ status: "complete", stage: "complete", progress: null, build_id: SYNTHETIC_ROVER_BUILD_ID, revision: 1 });
    expect((await rejection(source.getJob("job-live-123"))).code).toBe("JOB_NOT_FOUND");
  });

  it("generate still validates the request", async () => {
    const err = await rejection(source.generate({ input: { kind: "image", image_asset_id: null, user_text: "" } }));
    expect(err.kind).toBe("bad_request");
    expect(err.issues.map((i) => i.path)).toContain("$.input.image_asset_id");
  });

  it("subscribeToJob emits exactly one system event and no pretend stages", async () => {
    const { job_id } = await source.generate({ input: { kind: "text", image_asset_id: null, user_text: "rover" } });
    const events: StageEvent[] = [];
    const transports: string[] = [];
    let finalJob: unknown = null;
    const sub = source.subscribeToJob(job_id, (e) => events.push(e), {
      onJob: (j) => (finalJob = j),
      onTransportChange: (t) => transports.push(t),
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ event_id: 1, stage: "complete", actor: "system", status: "ok", timestamp: "2026-10-24T00:00:00Z" });
    expect(events[0].message).toMatch(/Saved synthetic example.*no live generation ran/);
    expect(finalJob).toMatchObject({ status: "complete", progress: null });
    expect(transports).toEqual(["fixture", "closed"]);
    expect(sub.transport).toBe("closed");
  });

  it("edit is never accepted locally and stale revisions conflict", async () => {
    const res = await source.edit(SYNTHETIC_ROVER_BUILD_ID, { base_revision: 1, instruction: "Move the sensor higher" });
    expect(res.accepted).toBe(false);
    expect(res.revision).toBeNull();
    expect(res.finding).toMatchObject({ result: "UNKNOWN", rule_id: "fixture.edits_require_live_engine" });
    const stale = await rejection(source.edit(SYNTHETIC_ROVER_BUILD_ID, { base_revision: 0 + 2, instruction: "x" }));
    expect(stale).toMatchObject({ kind: "conflict", status: 409, code: "STALE_REVISION" });
    const bad = await rejection(source.edit(SYNTHETIC_ROVER_BUILD_ID, { base_revision: 1, instruction: "" }));
    expect(bad.kind).toBe("bad_request");
    // The saved plan is untouched.
    expect((await source.getBuild(SYNTHETIC_ROVER_BUILD_ID)).revision).toBe(1);
  });
});
