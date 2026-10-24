import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { context as FiberContext } from "@react-three/fiber";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EXAMPLE_OBSTACLES, EXAMPLE_SNAPSHOTS } from "../examples";
import { SIM_DISCLAIMER } from "../readout";
import { RoverSimulationView } from "../RoverSimulationView";
import { SimReadout } from "../SimReadout";
import { SimulationVisualDebug } from "../SimulationVisualDebug";
import type { SimSnapshot } from "../types";

vi.mock("@react-three/fiber", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@react-three/fiber")>();
  return {
    ...actual,
    Canvas: (props: { frameloop?: string }) => <div data-testid="r3f-canvas" data-frameloop={props.frameloop} />,
  };
});

afterEach(cleanup);

const example = (id: string): SimSnapshot => EXAMPLE_SNAPSHOTS.find((e) => e.id === id)!.snapshot;

describe("RoverSimulationView", () => {
  it.each([
    ["no snapshot", null],
    ["forward", example("forward-clear")],
    ["collision", example("collision")],
    ["disabled", example("disabled")],
  ] as const)("always shows the simplified-simulation warning (%s)", (_, snapshot) => {
    render(<RoverSimulationView snapshot={snapshot} obstacles={EXAMPLE_OBSTACLES} />);
    const note = screen.getByTestId("sim-disclaimer");
    expect(note.getAttribute("role")).toBe("note");
    expect(note.textContent).toContain(SIM_DISCLAIMER);
    expect(SIM_DISCLAIMER).toBe("Simplified kinematic simulation; not a guarantee of real-world performance");
  });

  it("renders exactly one canvas and only runs the render loop while playing", () => {
    const { rerender } = render(<RoverSimulationView snapshot={example("forward-clear")} obstacles={EXAMPLE_OBSTACLES} />);
    expect(screen.getAllByTestId("r3f-canvas")).toHaveLength(1);
    expect(screen.getByTestId("r3f-canvas").getAttribute("data-frameloop")).toBe("demand");
    rerender(<RoverSimulationView snapshot={example("forward-clear")} obstacles={EXAMPLE_OBSTACLES} playing />);
    expect(screen.getByTestId("r3f-canvas").getAttribute("data-frameloop")).toBe("always");
  });

  it("updates the readout when a new snapshot arrives", () => {
    const { rerender } = render(<RoverSimulationView snapshot={example("forward-clear")} obstacles={EXAMPLE_OBSTACLES} />);
    expect(screen.getByTestId("sim-readout-state").textContent).toBe("FORWARD");
    expect(screen.getByTestId("sim-readout-distance").textContent).toBe("No return (> 1.00 m)");
    expect(screen.getByTestId("sim-readout-speed").textContent).toBe("0.090 m/s");

    rerender(<RoverSimulationView snapshot={example("stop-threshold")} obstacles={EXAMPLE_OBSTACLES} />);
    expect(screen.getByTestId("sim-readout-state").textContent).toBe("STOP");
    expect(screen.getByTestId("sim-readout-state").getAttribute("data-tone")).toBe("stop");
    expect(screen.getByTestId("sim-readout-distance").textContent).toBe("0.24 m");
    expect(screen.getByTestId("sim-readout-speed").textContent).toBe("0.000 m/s");

    rerender(<RoverSimulationView snapshot={example("turn")} obstacles={EXAMPLE_OBSTACLES} config={{ wheel_base_m: 0.156 }} />);
    expect(screen.getByTestId("sim-readout-state").textContent).toBe("TURN");
    expect(screen.getByTestId("sim-readout-turn").textContent).toBe("1.15 rad/s");
    expect(screen.getByTestId("rover-simulation-view").getAttribute("data-state")).toBe("TURN");
  });

  it("reports collisions in the readout", () => {
    render(<RoverSimulationView snapshot={example("collision")} obstacles={EXAMPLE_OBSTACLES} />);
    expect(screen.getByTestId("sim-readout-collision").textContent).toMatch(/collision/i);
    expect(screen.getByTestId("rover-simulation-view").getAttribute("data-collision")).toBe("true");
  });

  it("marks the view disabled for DISABLE / DISABLED snapshots", () => {
    const { rerender } = render(<RoverSimulationView snapshot={example("disabled")} obstacles={EXAMPLE_OBSTACLES} playing />);
    const root = screen.getByTestId("rover-simulation-view");
    expect(root.getAttribute("data-disabled")).toBe("true");
    expect(screen.getByTestId("sim-readout-state").textContent).toBe("DISABLED");
    expect(screen.getByTestId("sim-readout-state").getAttribute("data-tone")).toBe("disabled");
    rerender(<RoverSimulationView snapshot={{ ...example("disabled"), state: "DISABLE" }} obstacles={EXAMPLE_OBSTACLES} />);
    expect(screen.getByTestId("sim-readout-state").textContent).toBe("DISABLED");
    rerender(<RoverSimulationView snapshot={example("forward-clear")} obstacles={EXAMPLE_OBSTACLES} />);
    expect(root.getAttribute("data-disabled")).toBe("false");
  });

  it("shows plan limitations and a controls slot", () => {
    render(
      <RoverSimulationView
        snapshot={null}
        obstacles={[]}
        limitations={["No motor torque", "No sensor noise"]}
        controls={<button type="button">custom control</button>}
      />,
    );
    expect(screen.getByTestId("sim-limitations").textContent).toContain("No motor torque");
    expect(screen.getByText("custom control")).toBeTruthy();
    expect(screen.getByTestId("sim-readout").textContent).toMatch(/waiting/i);
  });

  it("switches between course and follow cameras", () => {
    render(<RoverSimulationView snapshot={EXAMPLE_SNAPSHOTS[0]!.snapshot} obstacles={EXAMPLE_OBSTACLES} />);
    const course = screen.getByTestId("sim-camera-overview");
    const follow = screen.getByTestId("sim-camera-follow");
    expect(course.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(follow);
    expect(follow.getAttribute("aria-pressed")).toBe("true");
    expect(course.getAttribute("aria-pressed")).toBe("false");
  });

  it("disables the follow camera until a snapshot exists", () => {
    render(<RoverSimulationView snapshot={null} obstacles={EXAMPLE_OBSTACLES} />);
    expect((screen.getByTestId("sim-camera-follow") as HTMLButtonElement).disabled).toBe(true);
  });

  it("refuses to nest inside another R3F canvas", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      <FiberContext.Provider value={{} as any}>
        <RoverSimulationView snapshot={example("forward-clear")} obstacles={EXAMPLE_OBSTACLES} />
      </FiberContext.Provider>,
    );
    expect(screen.queryByTestId("r3f-canvas")).toBeNull();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});

describe("SimReadout", () => {
  it("formats distance and speed from the snapshot", () => {
    render(<SimReadout snapshot={{ ...example("forward-detected"), wheel_speed_left_mps: 0.1, wheel_speed_right_mps: 0.2 }} wheel_base_m={0.2} />);
    expect(screen.getByTestId("sim-readout-distance").textContent).toBe("0.60 m");
    expect(screen.getByTestId("sim-readout-speed").textContent).toBe("0.150 m/s");
    expect(screen.getByTestId("sim-readout-turn").textContent).toBe("0.50 rad/s");
  });
});

describe("SimulationVisualDebug", () => {
  it("steps through static examples and keeps the warning visible", () => {
    render(<SimulationVisualDebug />);
    expect(screen.getByTestId("sim-readout-state").textContent).toBe("FORWARD");
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Disabled" }));
    });
    expect(screen.getByTestId("sim-readout-state").textContent).toBe("DISABLED");
    expect(screen.getByTestId("sim-disclaimer").textContent).toContain(SIM_DISCLAIMER);
    expect(screen.getByText(/do not run a simulation/i)).toBeTruthy();
  });
});
