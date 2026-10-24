/**
 * Referential integrity rules from implementation.md §3.4. Shape validation
 * (validate.ts) must pass first; these checks need the catalog as well.
 */
import { RivetContractError, type ValidationIssue } from "./errors";
import type { BuildPlan, CatalogComponent, ConnectionEndpoint } from "./types";

export function checkPlanIntegrity(plan: BuildPlan, catalog: readonly CatalogComponent[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });

  const catalogById = new Map<string, CatalogComponent>();
  catalog.forEach((c) => catalogById.set(c.catalog_id, c));

  const instances = new Map<string, BuildPlan["components"][number]>();
  plan.components.forEach((c, i) => {
    const p = `$.components[${i}]`;
    if (instances.has(c.instance_id)) add(`${p}.instance_id`, `duplicate instance_id "${c.instance_id}"`);
    else instances.set(c.instance_id, c);
    if (!catalogById.has(c.catalog_id)) add(`${p}.catalog_id`, `catalog_id "${c.catalog_id}" is not in the catalog`);
  });

  const mountsOf = (instanceId: string) =>
    catalogById.get(instances.get(instanceId)?.catalog_id ?? "")?.mounts.map((m) => m.mount_id) ?? null;
  const portsOf = (instanceId: string) =>
    catalogById.get(instances.get(instanceId)?.catalog_id ?? "")?.ports.map((m) => m.port_id) ?? null;

  plan.components.forEach((c, i) => {
    const p = `$.components[${i}]`;
    if (c.parent_instance_id !== null) {
      if (!instances.has(c.parent_instance_id)) {
        add(`${p}.parent_instance_id`, `parent instance "${c.parent_instance_id}" does not exist in this build`);
      } else if (c.parent_instance_id === c.instance_id) {
        add(`${p}.parent_instance_id`, "a component cannot be its own parent");
      }
    }
    if (c.attached_to_mount_id !== null) {
      if (c.parent_instance_id === null) {
        add(`${p}.attached_to_mount_id`, "attached_to_mount_id requires a parent_instance_id");
      } else {
        const parentMounts = mountsOf(c.parent_instance_id);
        if (parentMounts && !parentMounts.includes(c.attached_to_mount_id))
          add(`${p}.attached_to_mount_id`, `mount "${c.attached_to_mount_id}" does not exist on parent "${c.parent_instance_id}"`);
      }
    }
    if (c.own_mount_id !== null) {
      const own = mountsOf(c.instance_id);
      if (own && !own.includes(c.own_mount_id))
        add(`${p}.own_mount_id`, `mount "${c.own_mount_id}" does not exist on catalog component "${c.catalog_id}"`);
    }
  });

  const seenConnections = new Set<string>();
  plan.connections.forEach((conn, i) => {
    const p = `$.connections[${i}]`;
    if (seenConnections.has(conn.connection_id)) add(`${p}.connection_id`, `duplicate connection_id "${conn.connection_id}"`);
    seenConnections.add(conn.connection_id);
    (["from", "to"] as const).forEach((side) => {
      const end: ConnectionEndpoint = conn[side];
      const ep = `${p}.${side}`;
      if (!instances.has(end.instance_id)) {
        add(`${ep}.instance_id`, `connection references missing instance "${end.instance_id}"`);
        return;
      }
      if (conn.kind === "electrical") {
        if (!end.port_id) add(`${ep}.port_id`, "electrical connection endpoint requires port_id");
        else {
          const ports = portsOf(end.instance_id);
          if (ports && !ports.includes(end.port_id))
            add(`${ep}.port_id`, `port "${end.port_id}" does not exist on instance "${end.instance_id}"`);
        }
      } else if (end.mount_id) {
        const mounts = mountsOf(end.instance_id);
        if (mounts && !mounts.includes(end.mount_id))
          add(`${ep}.mount_id`, `mount "${end.mount_id}" does not exist on instance "${end.instance_id}"`);
      }
    });
  });

  plan.verification.findings.forEach((f, i) =>
    f.affected_instance_ids.forEach((id, j) => {
      if (!instances.has(id)) add(`$.verification.findings[${i}].affected_instance_ids[${j}]`, `unknown instance "${id}"`);
    }),
  );

  plan.assembly_steps.forEach((s, i) =>
    s.instance_ids.forEach((id, j) => {
      if (!instances.has(id)) add(`$.assembly_steps[${i}].instance_ids[${j}]`, `assembly step references missing instance "${id}"`);
    }),
  );

  plan.bom.items.forEach((item, i) => {
    const p = `$.bom.items[${i}]`;
    if (!catalogById.has(item.catalog_id)) add(`${p}.catalog_id`, `catalog_id "${item.catalog_id}" is not in the catalog`);
    item.instance_ids.forEach((id, j) => {
      const inst = instances.get(id);
      if (!inst) add(`${p}.instance_ids[${j}]`, `BOM row references missing instance "${id}"`);
      else if (inst.catalog_id !== item.catalog_id)
        add(`${p}.instance_ids[${j}]`, `instance "${id}" is "${inst.catalog_id}", not "${item.catalog_id}"`);
    });
    if (item.quantity !== item.instance_ids.length)
      add(`${p}.quantity`, `quantity ${item.quantity} != ${item.instance_ids.length} referenced instances (pack multipliers are not modelled in v1)`);
  });

  if (plan.behavior && !catalogById.has(plan.behavior.controller_catalog_id))
    add("$.behavior.controller_catalog_id", `controller "${plan.behavior.controller_catalog_id}" is not in the catalog`);

  // Honesty rules: a plan may not claim more than its evidence supports.
  const blocking = plan.verification.findings.filter(
    (f) => f.severity === "blocking" && (f.result === "FAIL" || f.result === "UNKNOWN"),
  );
  if ((plan.status === "verified" || plan.status === "verified_with_warnings") && blocking.length > 0)
    add("$.status", `status "${plan.status}" conflicts with ${blocking.length} blocking FAIL/UNKNOWN finding(s)`);
  const unpriced = plan.bom.items.some((item) => item.unit_price_amount === null);
  if (plan.bom.total_status === "complete" && unpriced)
    add("$.bom.total_status", `total_status "complete" but at least one BOM item has a null price`);

  return issues;
}

/** Throws `RivetContractError` if the plan does not resolve against the catalog. */
export function assertPlanIntegrity(plan: BuildPlan, catalog: readonly CatalogComponent[]): void {
  const issues = checkPlanIntegrity(plan, catalog);
  if (issues.length > 0) throw new RivetContractError(`BuildPlan ${plan.build_id}@${plan.revision} references`, issues);
}
