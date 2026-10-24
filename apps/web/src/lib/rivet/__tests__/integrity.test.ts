import { describe, expect, it } from "vitest";
import { assertPlanIntegrity, checkPlanIntegrity, parseBuildPlan, parseCatalogComponents, RivetContractError } from "../index";
import { rawCatalog, rawPlan } from "./helpers";

const catalog = parseCatalogComponents(rawCatalog());
const check = (mutate: (plan: any) => void) => {
  const raw = rawPlan();
  mutate(raw);
  return checkPlanIntegrity(parseBuildPlan(raw), catalog);
};

describe("plan referential integrity", () => {
  it("the synthetic fixture fully resolves against its catalog", () => {
    expect(checkPlanIntegrity(parseBuildPlan(rawPlan()), catalog)).toEqual([]);
  });

  it("rejects an electrical connection that references a missing driver-1 (§3.3)", () => {
    const issues = check((plan) => {
      plan.components = plan.components.filter((c: any) => c.instance_id !== "driver-1");
      plan.bom.items = plan.bom.items.filter((i: any) => i.catalog_id !== "demo.tb6612");
      plan.assembly_steps.forEach((s: any) => (s.instance_ids = s.instance_ids.filter((id: string) => id !== "driver-1")));
      plan.verification.findings.forEach(
        (f: any) => (f.affected_instance_ids = f.affected_instance_ids.filter((id: string) => id !== "driver-1")),
      );
    });
    expect(issues).toEqual([
      { path: "$.connections[0].to.instance_id", message: 'connection references missing instance "driver-1"' },
    ]);
    const raw = rawPlan();
    raw.connections[0].to.instance_id = "driver-9";
    expect(() => assertPlanIntegrity(parseBuildPlan(raw), catalog)).toThrow(RivetContractError);
  });

  it("rejects catalog IDs missing from the catalog, in components and BOM rows", () => {
    const issues = check((plan) => {
      plan.components[7].catalog_id = "demo.does_not_exist";
      plan.bom.items[0].catalog_id = "demo.also_missing";
    });
    const paths = issues.map((i) => i.path);
    expect(paths).toContain("$.components[7].catalog_id");
    expect(paths).toContain("$.bom.items[0].catalog_id");
  });

  it("rejects the abbreviated §3.3 documentation example against the synthetic catalog", () => {
    const issues = check((plan) => {
      plan.components = [
        { ...plan.components[0], catalog_id: "chassis.rover_2wd_v1" },
        { ...plan.components[6], catalog_id: "board.esp32_devkit_v1", attached_to_mount_id: "electronics_deck" },
      ];
    });
    expect(issues.some((i) => i.message.includes('"chassis.rover_2wd_v1" is not in the catalog'))).toBe(true);
    expect(issues.some((i) => i.path.startsWith("$.connections"))).toBe(true);
  });

  it("rejects malformed instance references across the plan", () => {
    const issues = check((plan) => {
      plan.components[1].instance_id = plan.components[2].instance_id; // duplicate
      plan.components[3].parent_instance_id = "ghost-1";
      plan.components[4].attached_to_mount_id = "no_such_mount";
      plan.components[5].own_mount_id = "no_such_own_mount";
      plan.connections[1].from.port_id = "gpio99";
      plan.assembly_steps[2].instance_ids.push("phantom-1");
      plan.bom.items[1].instance_ids.push("controller-1");
      plan.verification.findings[0].affected_instance_ids.push("nobody-1");
    });
    const paths = issues.map((i) => i.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        "$.components[2].instance_id",
        "$.components[3].parent_instance_id",
        "$.components[4].attached_to_mount_id",
        "$.components[5].own_mount_id",
        "$.connections[1].from.port_id",
        "$.assembly_steps[2].instance_ids[3]",
        "$.bom.items[1].instance_ids[1]",
        "$.bom.items[1].quantity",
        "$.verification.findings[0].affected_instance_ids[11]",
      ]),
    );
  });

  it("rejects claims stronger than the evidence", () => {
    const issues = check((plan) => {
      plan.status = "verified";
      plan.bom.total_status = "complete";
    });
    expect(issues.map((i) => i.path)).toEqual(expect.arrayContaining(["$.status", "$.bom.total_status"]));
  });
});
