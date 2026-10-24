import { describe, expect, it, vi } from "vitest";
import { findBomItemForInstance, instanceIdsForCatalogId } from "../plan-index";
import { createPartSelectionController } from "../selection-controller";
import type {
  PartHoverChangeEvent,
  PartSelectionChangeEvent,
  PartVisibilityChangeEvent,
} from "../types";
import { loadRoverPlan, nextRevisionWithout, roverPlanJson } from "./helpers";

function setup() {
  const plan = loadRoverPlan();
  const selection: PartSelectionChangeEvent[] = [];
  const hover: PartHoverChangeEvent[] = [];
  const visibility: PartVisibilityChangeEvent[] = [];
  const controller = createPartSelectionController({
    plan,
    callbacks: {
      onSelectionChange: (e) => selection.push(e),
      onHoverChange: (e) => hover.push(e),
      onVisibilityChange: (e) => visibility.push(e),
    },
  });
  return { plan, controller, selection, hover, visibility };
}

describe("selection", () => {
  it("selects a single instance and emits an inspector payload", () => {
    const { controller, selection } = setup();
    expect(controller.select("driver-1")).toBe(true);
    expect(controller.getState().selected_instance_id).toBe("driver-1");
    expect(selection).toEqual([
      {
        build_id: "rivet-synthetic-rover-fixture",
        revision: 1,
        instance_id: "driver-1",
        previous_instance_id: null,
        component: expect.objectContaining({
          instance_id: "driver-1",
          catalog_id: "demo.tb6612",
          role: "motor_driver",
        }),
        reason: "api",
      },
    ]);

    controller.select("sensor-1", { reason: "pointer" });
    expect(controller.getState().selected_instance_id).toBe("sensor-1");
    expect(selection[1]).toMatchObject({
      instance_id: "sensor-1",
      previous_instance_id: "driver-1",
      reason: "pointer",
    });
    expect(controller.getVisualState("driver-1").selected).toBe(false);
    expect(controller.getVisualState("sensor-1").selected).toBe(true);
  });

  it("re-selecting the same instance is a no-op", () => {
    const { controller, selection } = setup();
    controller.select("driver-1");
    controller.select("driver-1");
    expect(selection).toHaveLength(1);
  });

  it("clears selection and reports the reason", () => {
    const { controller, selection } = setup();
    controller.select("controller-1");
    expect(controller.clearSelection("background")).toBe(true);
    expect(controller.getState().selected_instance_id).toBeNull();
    expect(selection.at(-1)).toMatchObject({
      instance_id: null,
      previous_instance_id: "controller-1",
      component: null,
      reason: "background",
    });
    expect(controller.clearSelection()).toBe(false);
    expect(selection).toHaveLength(2);
  });

  it("ignores missing instance IDs without changing state", () => {
    const { controller, selection, hover, visibility } = setup();
    controller.select("driver-1");
    const before = controller.getState();
    expect(controller.select("driver-99")).toBe(false);
    expect(controller.select("")).toBe(false);
    expect(controller.hover("ghost-1")).toBe(false);
    expect(controller.hide("ghost-1")).toBe(false);
    expect(controller.isolate("ghost-1")).toBe(false);
    expect(controller.getState()).toBe(before);
    expect(controller.getComponent("ghost-1")).toBeNull();
    expect(controller.getVisualState("ghost-1")).toMatchObject({ known: false, interactive: false });
    expect(selection).toHaveLength(1);
    expect(hover).toHaveLength(0);
    expect(visibility).toHaveLength(0);
  });

  it("treats every ID as missing before a plan is loaded", () => {
    const controller = createPartSelectionController();
    expect(controller.select("driver-1")).toBe(false);
    expect(controller.getState()).toMatchObject({ build_id: null, selected_instance_id: null });
  });

  it("keeps repeated catalog components distinct by instance_id", () => {
    const { plan, controller, selection } = setup();
    expect(instanceIdsForCatalogId(plan, "demo.tt_motor")).toEqual([
      "motor-left-1",
      "motor-right-1",
    ]);
    controller.select("motor-left-1");
    expect(controller.getVisualState("motor-left-1").selected).toBe(true);
    expect(controller.getVisualState("motor-right-1").selected).toBe(false);

    controller.select("motor-right-1");
    expect(selection.at(-1)).toMatchObject({
      instance_id: "motor-right-1",
      previous_instance_id: "motor-left-1",
      component: { catalog_id: "demo.tt_motor" },
    });

    controller.hide("motor-left-1");
    expect(controller.getVisualState("motor-left-1").visible).toBe(false);
    expect(controller.getVisualState("motor-right-1").visible).toBe(true);
    expect(controller.getState().selected_instance_id).toBe("motor-right-1");

    // Both instances share one BOM row.
    expect(findBomItemForInstance(plan, "motor-right-1")).toMatchObject({
      catalog_id: "demo.tt_motor",
      quantity: 2,
    });
    expect(findBomItemForInstance(plan, "ghost-1")).toBeNull();
  });
});

describe("hover", () => {
  it("tracks the hovered part with a label", () => {
    const plan = loadRoverPlan();
    const events: PartHoverChangeEvent[] = [];
    const controller = createPartSelectionController({
      plan,
      getLabel: (c) => `${c.catalog_id} (${c.instance_id})`,
      callbacks: { onHoverChange: (e) => events.push(e) },
    });
    controller.hover("wheel-left-1");
    expect(controller.getLabel("wheel-left-1")).toBe("demo.wheel (wheel-left-1)");
    expect(events.at(-1)).toMatchObject({
      instance_id: "wheel-left-1",
      label: "demo.wheel (wheel-left-1)",
    });
    // An out event for another part does not clear the current hover.
    expect(controller.unhover("wheel-right-1")).toBe(false);
    expect(controller.getState().hovered_instance_id).toBe("wheel-left-1");
    controller.unhover("wheel-left-1");
    expect(events.at(-1)).toMatchObject({ instance_id: null, label: null });
  });

  it("uses a neutral default label", () => {
    const { controller } = setup();
    expect(controller.getLabel("driver-1")).toBe("motor driver · driver-1");
  });
});

describe("hide, show and isolate", () => {
  it("hiding a selected and hovered part clears both and blocks interaction", () => {
    const { controller, selection, hover, visibility } = setup();
    controller.select("sensor-1");
    controller.hover("sensor-1");
    controller.hide("sensor-1");

    expect(controller.getState()).toMatchObject({
      selected_instance_id: null,
      hovered_instance_id: null,
    });
    expect(selection.at(-1)).toMatchObject({ instance_id: null, reason: "hidden" });
    expect(hover.at(-1)).toMatchObject({ instance_id: null });
    expect(visibility.at(-1)).toEqual({
      build_id: "rivet-synthetic-rover-fixture",
      revision: 1,
      hidden_instance_ids: ["sensor-1"],
      isolated_instance_id: null,
    });
    expect(controller.getVisualState("sensor-1")).toMatchObject({
      hidden: true,
      visible: false,
      interactive: false,
    });
    expect(controller.select("sensor-1")).toBe(false);
    expect(controller.hover("sensor-1")).toBe(false);

    expect(controller.show("sensor-1")).toBe(true);
    expect(controller.select("sensor-1")).toBe(true);
  });

  it("select with reveal unhides a hidden part", () => {
    const { controller } = setup();
    controller.hide("caster-1");
    expect(controller.select("caster-1", { reveal: true })).toBe(true);
    expect(controller.getVisualState("caster-1")).toMatchObject({ visible: true, selected: true });
  });

  it("toggleHidden and showAll", () => {
    const { controller } = setup();
    controller.toggleHidden("caster-1");
    controller.toggleHidden("chassis-1");
    expect([...controller.getState().hidden_instance_ids].sort()).toEqual(["caster-1", "chassis-1"]);
    controller.toggleHidden("caster-1");
    expect([...controller.getState().hidden_instance_ids]).toEqual(["chassis-1"]);
    expect(controller.showAll()).toBe(true);
    expect(controller.getState().hidden_instance_ids.size).toBe(0);
    expect(controller.showAll()).toBe(false);
  });

  it("isolates the selected component", () => {
    const { plan, controller, visibility } = setup();
    controller.select("controller-1");
    expect(controller.isolate()).toBe(true);
    expect(visibility.at(-1)).toMatchObject({ isolated_instance_id: "controller-1" });

    for (const { instance_id } of plan.components) {
      const visual = controller.getVisualState(instance_id);
      if (instance_id === "controller-1") {
        expect(visual).toMatchObject({ visible: true, interactive: true, selected: true });
      } else {
        expect(visual).toMatchObject({ isolated_out: true, visible: false, interactive: false });
        expect(controller.select(instance_id)).toBe(false);
      }
    }
    expect(controller.exitIsolation()).toBe(true);
    expect(controller.getVisualState("driver-1").visible).toBe(true);
  });

  it("isolate without a selection is a no-op", () => {
    const { controller } = setup();
    expect(controller.isolate()).toBe(false);
  });

  it("isolating another part drops a selection that is isolated out", () => {
    const { controller, selection } = setup();
    controller.select("driver-1");
    controller.isolate("sensor-1");
    expect(controller.getState().selected_instance_id).toBeNull();
    expect(selection.at(-1)).toMatchObject({ reason: "hidden" });
  });

  it("isolating a hidden part unhides it; hiding the isolated part exits isolation", () => {
    const { controller } = setup();
    controller.hide("driver-1");
    controller.isolate("driver-1");
    expect(controller.getVisualState("driver-1").visible).toBe(true);
    controller.hide("driver-1");
    expect(controller.getState().isolated_instance_id).toBeNull();
    expect(controller.getVisualState("sensor-1").visible).toBe(true);
  });
});

describe("escape", () => {
  it("clears selection, hover and isolation but keeps hidden parts", () => {
    const { controller, selection } = setup();
    controller.hide("caster-1");
    controller.select("driver-1");
    controller.hover("driver-1");
    controller.isolate();
    expect(controller.handleEscape()).toBe(true);
    expect(controller.getState()).toMatchObject({
      selected_instance_id: null,
      hovered_instance_id: null,
      isolated_instance_id: null,
    });
    expect([...controller.getState().hidden_instance_ids]).toEqual(["caster-1"]);
    expect(selection.at(-1)).toMatchObject({ reason: "keyboard" });
    expect(controller.handleEscape()).toBe(false);
  });
});

describe("plan revisions", () => {
  it("keeps selection, hidden and isolation for instances still present", () => {
    const { plan, controller, selection } = setup();
    controller.select("driver-1");
    controller.hide("caster-1");
    controller.isolate("driver-1");
    selection.length = 0;

    const next = nextRevisionWithout(plan, ["sensor-1"]);
    controller.setPlan(next);
    expect(controller.getState()).toMatchObject({
      revision: 2,
      selected_instance_id: "driver-1",
      isolated_instance_id: "driver-1",
    });
    expect([...controller.getState().hidden_instance_ids]).toEqual(["caster-1"]);
    expect(selection).toHaveLength(0);
  });

  it("clears selection and prunes state when the instance disappears", () => {
    const { plan, controller, selection, hover, visibility } = setup();
    controller.select("sensor-1");
    controller.hover("sensor-1");
    controller.hide("caster-1");
    controller.setPlan(nextRevisionWithout(plan, ["sensor-1", "caster-1"]));

    expect(controller.getState()).toMatchObject({
      revision: 2,
      selected_instance_id: null,
      hovered_instance_id: null,
    });
    expect(controller.getState().hidden_instance_ids.size).toBe(0);
    expect(selection.at(-1)).toMatchObject({
      revision: 2,
      instance_id: null,
      previous_instance_id: "sensor-1",
      reason: "plan_change",
    });
    expect(hover.at(-1)).toMatchObject({ instance_id: null });
    expect(visibility.at(-1)).toMatchObject({ hidden_instance_ids: [] });
    expect(controller.select("sensor-1")).toBe(false);
  });

  it("re-emits selection when the same instance changes catalog part", () => {
    const { plan, controller, selection } = setup();
    controller.select("driver-1");
    const copy = JSON.parse(JSON.stringify(plan));
    copy.revision = 2;
    copy.components.find((c: { instance_id: string }) => c.instance_id === "driver-1").catalog_id =
      "demo.other_driver";
    controller.setPlan(copy);
    expect(selection.at(-1)).toMatchObject({
      instance_id: "driver-1",
      previous_instance_id: "driver-1",
      component: { catalog_id: "demo.other_driver" },
      reason: "plan_change",
    });
  });

  it("resets everything when a different build is loaded", () => {
    const { plan, controller, selection } = setup();
    controller.select("driver-1");
    controller.hide("caster-1");
    controller.setPlan({ ...plan, build_id: "another-build" });
    expect(controller.getState()).toMatchObject({
      build_id: "another-build",
      selected_instance_id: null,
    });
    expect(controller.getState().hidden_instance_ids.size).toBe(0);
    expect(selection.at(-1)).toMatchObject({ instance_id: null, reason: "plan_change" });
  });

  it("resets when the plan is unloaded", () => {
    const { controller } = setup();
    controller.select("driver-1");
    controller.setPlan(null);
    expect(controller.getState()).toMatchObject({ build_id: null, selected_instance_id: null });
  });
});

describe("BuildPlan immutability", () => {
  it("never mutates the plan", () => {
    const { plan, controller } = setup(); // plan is deep-frozen: writes would throw
    controller.select("motor-left-1");
    controller.hover("motor-right-1");
    controller.hide("wheel-left-1");
    controller.isolate("motor-left-1");
    controller.handleEscape();
    controller.showAll();
    controller.setPlan(nextRevisionWithout(plan, ["sensor-1"]));
    controller.setPlan(plan);
    expect(JSON.stringify(plan)).toBe(roverPlanJson);
  });

  it("subscribers are notified once per change and can unsubscribe", () => {
    const { controller } = setup();
    const listener = vi.fn();
    const unsubscribe = controller.subscribe(listener);
    controller.select("driver-1");
    controller.select("driver-1");
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    controller.clearSelection();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
