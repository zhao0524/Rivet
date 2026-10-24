import { describe, expect, it } from "vitest";
import {
  RivetContractError,
  parseBuildPlan,
  parseCatalogComponents,
  parseCatalogResponse,
  parseEditResponse,
  parseIntentSpec,
  parseJobResponse,
  parseStageEvent,
  safeParse,
  buildPlanCheck,
} from "../index";
import { rawCatalog, rawIntent, rawPlan } from "./helpers";

const issuesOf = (value: unknown) => {
  const r = safeParse(buildPlanCheck, value);
  if (r.ok) throw new Error("expected plan to be rejected");
  return r.issues;
};

describe("contract parsers", () => {
  it("accepts the synthetic Appendix A plan, catalog and §3.1 intent", () => {
    const plan = parseBuildPlan(rawPlan());
    expect(plan.build_id).toBe("rivet-synthetic-rover-fixture");
    expect(plan.revision).toBe(1);
    expect(plan.components.map((c) => c.instance_id)).toContain("driver-1");
    expect(plan.components[0].pose.position_mm).toEqual([0, 10, 0]);
    expect(plan.bom.items.length).toBeGreaterThan(0);
    expect(plan.verification.findings.length).toBeGreaterThan(0);
    expect(plan.behavior?.parameters.obstacle_stop_distance_m).toBe(0.25);
    expect(plan.simulation.kind).toBe("differential_drive_2d");

    const catalog = parseCatalogComponents(rawCatalog());
    expect(catalog).toHaveLength(9);
    expect(parseCatalogResponse({ schema_version: "1.0", components: rawCatalog() }).components).toHaveLength(9);

    const intent = parseIntentSpec(rawIntent());
    expect(intent.project_family).toBe("rover");
    expect(intent.requirements.max_budget).toBeNull();
  });

  it("round-trips through JSON without loss", () => {
    const plan = parseBuildPlan(rawPlan());
    expect(parseBuildPlan(JSON.parse(JSON.stringify(plan)))).toEqual(plan);
  });

  it("rejects a missing schema_version with its path", () => {
    const plan = rawPlan();
    delete plan.schema_version;
    expect(issuesOf(plan)).toContainEqual({ path: "$.schema_version", message: 'expected "1.0", got undefined' });
  });

  it("rejects bad enums and reports the exact nested path", () => {
    const plan = rawPlan();
    plan.status = "totally_verified";
    plan.verification.findings[1].result = "OK";
    plan.bom.items[2].link_status = "maybe";
    const paths = issuesOf(plan).map((i) => i.path);
    expect(paths).toEqual(
      expect.arrayContaining(["$.status", "$.verification.findings[1].result", "$.bom.items[2].link_status"]),
    );
  });

  it("rejects malformed vectors, non-decimal prices and camelCase-only fields", () => {
    const plan = rawPlan();
    plan.components[3].pose.position_mm = [1, 2];
    plan.components[4].pose.rotation_deg[2] = "90";
    plan.bom.items[0].unit_price_amount = 4.99;
    plan.components[5].instanceId = plan.components[5].instance_id;
    delete plan.components[5].instance_id;
    const paths = issuesOf(plan).map((i) => i.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        "$.components[3].pose.position_mm",
        "$.components[4].pose.rotation_deg[2]",
        "$.bom.items[0].unit_price_amount",
        "$.components[5].instance_id",
      ]),
    );
  });

  it("requires rover behavior parameters and positive simulation geometry", () => {
    const plan = rawPlan();
    delete plan.behavior.parameters.turn_duration_ms;
    plan.simulation.wheel_base_m = 0;
    const paths = issuesOf(plan).map((i) => i.path);
    expect(paths).toEqual(expect.arrayContaining(["$.behavior.parameters.turn_duration_ms", "$.simulation.wheel_base_m"]));
  });

  it("throws RivetContractError with an informative message", () => {
    const plan = rawPlan();
    plan.revision = 0;
    try {
      parseBuildPlan(plan);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(RivetContractError);
      const e = err as RivetContractError;
      expect(e.kind).toBe("contract");
      expect(e.message).toContain("$.revision");
      expect(e.issues[0]).toEqual({ path: "$.revision", message: "expected integer >= 1, got number" });
    }
  });

  it("rejects non-objects and catalog entries with bad mounts", () => {
    expect(() => parseBuildPlan(null)).toThrow(/\$: expected object, got null/);
    const catalog = rawCatalog();
    catalog[1].mounts[0].mount_id = "";
    expect(() => parseCatalogComponents(catalog)).toThrow(/\$\[1\]\.mounts\[0\]\.mount_id/);
  });

  it("validates job responses, stage events and edit responses", () => {
    expect(parseJobResponse({ job_id: "j1", status: "running", stage: "understand", progress: null }).progress).toBeNull();
    expect(() => parseJobResponse({ job_id: "j1", status: "done", stage: "understand", progress: null })).toThrow(/\$\.status/);
    const event = {
      event_id: 1,
      job_id: "job-demo-001",
      stage: "catalog_selection",
      actor: "planner",
      status: "running",
      message: "Finding compatible controller and motor driver",
      timestamp: "2026-10-24T00:00:00Z",
      references: [],
    };
    expect(parseStageEvent(event).stage).toBe("catalog_selection");
    expect(() => parseStageEvent({ ...event, actor: "wizard" })).toThrow(/\$\.actor/);
    expect(() => parseStageEvent({ ...event, timestamp: "yesterday" })).toThrow(/\$\.timestamp/);
    expect(parseEditResponse({ accepted: true, build_id: "b", revision: 2 }).revision).toBe(2);
  });
});
