import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SimulationControls } from "../SimulationControls";

afterEach(cleanup);

function setup(props: Partial<Parameters<typeof SimulationControls>[0]> = {}) {
  const cb = {
    onPlay: vi.fn(),
    onPause: vi.fn(),
    onReset: vi.fn(),
    onEnable: vi.fn(),
    onDisable: vi.fn(),
  };
  const utils = render(<SimulationControls playing={false} enabled {...cb} {...props} />);
  return { cb, ...utils };
}

describe("SimulationControls", () => {
  it("toggles between play and pause", () => {
    const { cb, rerender } = setup();
    fireEvent.click(screen.getByTestId("sim-control-play"));
    expect(cb.onPlay).toHaveBeenCalledTimes(1);
    rerender(<SimulationControls playing enabled {...cb} />);
    expect(screen.getByTestId("sim-control-play").textContent).toBe("Pause");
    expect(screen.getByTestId("sim-control-play").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByTestId("sim-control-play"));
    expect(cb.onPause).toHaveBeenCalledTimes(1);
  });

  it("calls reset", () => {
    const { cb } = setup();
    fireEvent.click(screen.getByTestId("sim-control-reset"));
    expect(cb.onReset).toHaveBeenCalledTimes(1);
  });

  it("offers disable while enabled and enable while disabled", () => {
    const { cb, rerender } = setup();
    fireEvent.click(screen.getByTestId("sim-control-disable"));
    expect(cb.onDisable).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("sim-control-enable")).toBeNull();

    rerender(<SimulationControls playing={false} enabled={false} {...cb} />);
    expect(screen.queryByTestId("sim-control-disable")).toBeNull();
    expect(screen.getByTestId("sim-controls-status").textContent).toContain("Motors disabled");
    fireEvent.click(screen.getByTestId("sim-control-enable"));
    expect(cb.onEnable).toHaveBeenCalledTimes(1);
  });

  it("disables every control when unavailable", () => {
    const { cb } = setup({ unavailable: true, unavailableReason: "Plan has no simulation" });
    const buttons = screen.getAllByRole("button") as HTMLButtonElement[];
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) {
      expect(b.disabled).toBe(true);
      fireEvent.click(b);
    }
    for (const fn of Object.values(cb)) expect(fn).not.toHaveBeenCalled();
    expect(screen.getByTestId("sim-controls-status").textContent).toBe("Plan has no simulation");
  });
});
