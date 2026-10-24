import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { describe, expect, it, vi } from "vitest";
import { createClickGuard } from "../click-guard";
import { resolvePartHighlight } from "../highlight";
import { createPartPointerHandlers, type PartPointerEventLike } from "../pointer-handlers";
import { isRaycastBlocked, setRaycastEnabled } from "../raycast";
import { createPartSelectionController } from "../selection-controller";
import { loadRoverPlan } from "./helpers";

const event = (
  overrides: Partial<PartPointerEventLike> & { x?: number; y?: number } = {},
) => {
  const { x = 10, y = 10, ...rest } = overrides;
  const stopPropagation = vi.fn();
  return {
    object: { uuid: "mesh-a" },
    delta: 0,
    nativeEvent: { clientX: x, clientY: y, pointerId: 1, button: 0 },
    ...rest,
    stopPropagation,
  };
};

describe("click guard", () => {
  it("treats small travel as a click and large travel as a drag", () => {
    const guard = createClickGuard(4);
    guard.down({ clientX: 100, clientY: 100, pointerId: 1 });
    expect(guard.isClick({ clientX: 102, clientY: 103, pointerId: 1 })).toBe(true);
    guard.down({ clientX: 100, clientY: 100, pointerId: 1 });
    expect(guard.isClick({ clientX: 140, clientY: 100, pointerId: 1 })).toBe(false);
    expect(guard.isClick({ clientX: 100, clientY: 100, pointerId: 1 }, 25)).toBe(false);
  });

  it("falls back to the only recorded press when the click lacks a pointerId", () => {
    const guard = createClickGuard();
    guard.down({ clientX: 0, clientY: 0, pointerId: 7 });
    expect(guard.isClick({ clientX: 50, clientY: 0 })).toBe(false);
  });
});

describe("part pointer handlers", () => {
  const setup = (id = "driver-1") => {
    const controller = createPartSelectionController({ plan: loadRoverPlan() });
    const guard = createClickGuard(4);
    return { controller, guard, handlers: createPartPointerHandlers(controller, id, guard) };
  };

  it("click selects the part and stops propagation", () => {
    const { controller, guard, handlers } = setup();
    const down = event();
    guard.down(down.nativeEvent!);
    handlers.onPointerDown(down);
    const click = event();
    handlers.onClick(click);
    expect(controller.getState().selected_instance_id).toBe("driver-1");
    expect(click.stopPropagation).toHaveBeenCalled();
  });

  it("an orbit drag does not select", () => {
    const { controller, handlers } = setup();
    handlers.onPointerDown(event({ x: 10, y: 10 }));
    handlers.onClick(event({ x: 80, y: 40 }));
    expect(controller.getState().selected_instance_id).toBeNull();
    handlers.onClick(event({ x: 10, y: 10, delta: 30 }));
    expect(controller.getState().selected_instance_id).toBeNull();
  });

  it("ignores non-primary buttons", () => {
    const { controller, handlers } = setup();
    handlers.onClick(event({ nativeEvent: { clientX: 0, clientY: 0, button: 2 } }));
    expect(controller.getState().selected_instance_id).toBeNull();
  });

  it("hidden or isolated-out parts ignore events and let them propagate", () => {
    const { controller, handlers } = setup();
    controller.hide("driver-1");
    const over = event();
    const click = event();
    handlers.onPointerOver(over);
    handlers.onClick(click);
    expect(over.stopPropagation).not.toHaveBeenCalled();
    expect(click.stopPropagation).not.toHaveBeenCalled();
    expect(controller.getState()).toMatchObject({
      hovered_instance_id: null,
      selected_instance_id: null,
    });

    controller.show("driver-1");
    controller.isolate("sensor-1");
    handlers.onClick(event());
    expect(controller.getState().selected_instance_id).toBeNull();
  });

  it("hover is reference counted across meshes of one part", () => {
    const { controller, handlers } = setup();
    handlers.onPointerOver(event({ object: { uuid: "a" } }));
    handlers.onPointerOver(event({ object: { uuid: "b" } }));
    handlers.onPointerOut(event({ object: { uuid: "a" } }));
    expect(controller.getState().hovered_instance_id).toBe("driver-1");
    handlers.onPointerOut(event({ object: { uuid: "b" } }));
    expect(controller.getState().hovered_instance_id).toBeNull();
  });

  it("repeated catalog parts select independently", () => {
    const controller = createPartSelectionController({ plan: loadRoverPlan() });
    const left = createPartPointerHandlers(controller, "motor-left-1", null);
    const right = createPartPointerHandlers(controller, "motor-right-1", null);
    left.onClick(event());
    expect(controller.getState().selected_instance_id).toBe("motor-left-1");
    right.onClick(event());
    expect(controller.getState().selected_instance_id).toBe("motor-right-1");
  });
});

describe("raycast guard", () => {
  const box = () => new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
  const cast = (root: Group) => {
    const raycaster = new Raycaster(new Vector3(0, 0, 10), new Vector3(0, 0, -1));
    return raycaster.intersectObject(root, true);
  };

  it("blocks hits on a disabled part and restores them when re-enabled", () => {
    const part = new Group();
    part.add(box());
    expect(cast(part)).toHaveLength(2);

    part.visible = false; // Three.js still raycasts invisible objects
    expect(cast(part)).toHaveLength(2);

    setRaycastEnabled(part, false);
    expect(cast(part)).toHaveLength(0);
    setRaycastEnabled(part, true);
    expect(cast(part)).toHaveLength(2);
  });

  it("a disabled parent blocks nested parts; a disabled child leaves the parent pickable", () => {
    const parent = new Group();
    const parentMesh = box();
    const child = new Group();
    const childMesh = box();
    childMesh.position.z = 2;
    parent.add(parentMesh, child);
    child.add(childMesh);

    setRaycastEnabled(child, false);
    setRaycastEnabled(parent, true);
    expect(cast(parent).map((hit) => hit.object)).toEqual([parentMesh, parentMesh]);

    setRaycastEnabled(child, true);
    setRaycastEnabled(parent, false);
    expect(isRaycastBlocked(childMesh)).toBe(true);
    expect(cast(parent)).toHaveLength(0);
  });

  it("guards meshes added after the first pass", () => {
    const part = new Group();
    setRaycastEnabled(part, false);
    part.add(box());
    setRaycastEnabled(part, false);
    expect(cast(part)).toHaveLength(0);
  });
});

describe("highlight style", () => {
  it("maps visual state to neutral style hints", () => {
    const controller = createPartSelectionController({ plan: loadRoverPlan() });
    controller.select("driver-1");
    controller.hover("sensor-1");
    expect(resolvePartHighlight(controller.getVisualState("driver-1")).outline).toBe("selected");
    expect(resolvePartHighlight(controller.getVisualState("sensor-1")).outline).toBe("hover");
    expect(resolvePartHighlight(controller.getVisualState("caster-1"))).toMatchObject({
      outline: "none",
      opacity: 1,
    });
    controller.isolate("driver-1");
    expect(resolvePartHighlight(controller.getVisualState("caster-1"))).toMatchObject({
      outline: "none",
      opacity: 0.15,
      transparent: true,
    });
    controller.exitIsolation();
    controller.hide("caster-1");
    expect(resolvePartHighlight(controller.getVisualState("caster-1")).opacity).toBe(0);
  });
});
