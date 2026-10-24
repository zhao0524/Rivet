// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PartSelectionChangeEvent, SelectablePlan } from "../types";
import { usePartSelection, type PartSelectionApi, type UsePartSelectionOptions } from "../usePartSelection";
import { loadRoverPlan, nextRevisionWithout, roverPlanJson } from "./helpers";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let api: PartSelectionApi;

function Harness({ plan, options }: { plan: SelectablePlan | null; options?: UsePartSelectionOptions }) {
  api = usePartSelection(plan, options);
  return <span data-selected={api.selectedInstanceId ?? ""}>{api.hoverLabel ?? ""}</span>;
}

const render = (plan: SelectablePlan | null, options?: UsePartSelectionOptions) =>
  act(() => root.render(<Harness plan={plan} options={options} />));

const pressEscape = (target: EventTarget = window) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("usePartSelection", () => {
  it("exposes selection state and fires onSelectionChange", () => {
    const events: PartSelectionChangeEvent[] = [];
    render(loadRoverPlan(), { onSelectionChange: (e) => events.push(e) });
    act(() => {
      api.select("driver-1");
    });
    expect(api.selectedInstanceId).toBe("driver-1");
    expect(api.selectedComponent?.catalog_id).toBe("demo.tb6612");
    expect(container.querySelector("span")?.dataset.selected).toBe("driver-1");
    expect(events.map((e) => e.instance_id)).toEqual(["driver-1"]);
  });

  it("uses the latest callback without recreating the controller", () => {
    const first: string[] = [];
    const second: string[] = [];
    const plan = loadRoverPlan();
    render(plan, { onSelectionChange: (e) => first.push(String(e.instance_id)) });
    const controller = api.controller;
    render(plan, { onSelectionChange: (e) => second.push(String(e.instance_id)) });
    act(() => {
      api.select("sensor-1");
    });
    expect(api.controller).toBe(controller);
    expect(first).toEqual([]);
    expect(second).toEqual(["sensor-1"]);
  });

  it("Escape clears selection; ignored while typing in an input", () => {
    render(loadRoverPlan());
    act(() => {
      api.select("driver-1");
    });
    const input = document.createElement("input");
    document.body.appendChild(input);
    pressEscape(input);
    expect(api.selectedInstanceId).toBe("driver-1");
    input.remove();
    pressEscape();
    expect(api.selectedInstanceId).toBeNull();
  });

  it("escapeToClear=false disables the keyboard shortcut", () => {
    render(loadRoverPlan(), { escapeToClear: false });
    act(() => {
      api.select("driver-1");
    });
    pressEscape();
    expect(api.selectedInstanceId).toBe("driver-1");
  });

  it("background click clears selection, background drag does not", () => {
    const events: PartSelectionChangeEvent[] = [];
    render(loadRoverPlan(), { onSelectionChange: (e) => events.push(e) });
    act(() => {
      api.select("driver-1");
    });
    act(() => {
      api.canvasProps.onPointerDown({ clientX: 0, clientY: 0, pointerId: 1 });
      api.canvasProps.onPointerMissed(new MouseEvent("click", { clientX: 60, clientY: 0, button: 0 }));
    });
    expect(api.selectedInstanceId).toBe("driver-1");

    act(() => {
      api.canvasProps.onPointerDown({ clientX: 0, clientY: 0, pointerId: 1 });
      api.canvasProps.onPointerMissed(new MouseEvent("click", { clientX: 1, clientY: 1, button: 0 }));
    });
    expect(api.selectedInstanceId).toBeNull();
    expect(events.at(-1)?.reason).toBe("background");
  });

  it("follows plan revisions and clears selection when the instance disappears", () => {
    const plan = loadRoverPlan();
    render(plan);
    act(() => {
      api.select("driver-1");
      api.controller.hover("driver-1");
    });
    expect(container.textContent).toBe("motor driver · driver-1");

    render(nextRevisionWithout(plan, ["sensor-1"]));
    expect(api.state.revision).toBe(2);
    expect(api.selectedInstanceId).toBe("driver-1");

    render(nextRevisionWithout(plan, ["driver-1"]));
    expect(api.selectedInstanceId).toBeNull();
    expect(api.hoverLabel).toBeNull();
    expect(JSON.stringify(plan)).toBe(roverPlanJson);
  });

  it("hide / isolate helpers update visual state", () => {
    render(loadRoverPlan());
    act(() => {
      api.select("controller-1");
      api.isolate();
    });
    expect(api.getVisualState("driver-1").interactive).toBe(false);
    act(() => {
      api.exitIsolation();
      api.hide("driver-1");
    });
    expect(api.getVisualState("driver-1").visible).toBe(false);
    expect(api.state.hidden_instance_ids.has("driver-1")).toBe(true);
  });
});
