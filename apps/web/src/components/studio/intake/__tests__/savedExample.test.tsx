import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BuildIntake } from "../BuildIntake";
import { SAVED_EXAMPLE_LABEL, SavedExampleLauncher } from "../SavedExampleLauncher";
import { stubObjectUrls } from "./helpers";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const examples = [{ example_id: "rover_obstacle_v1", title: "Obstacle-avoiding rover", status: "needs_review", generation_mode: "fixture" }];

describe("honest synthetic mode", () => {
  it("uses the exact disclosure label", () => {
    expect(SAVED_EXAMPLE_LABEL).toBe("Saved synthetic example — not supplier verified");
  });

  it("opens synchronously with no timers, progress or stage replay", () => {
    vi.useFakeTimers();
    const onLoad = vi.fn();
    const { rerender } = render(<SavedExampleLauncher examples={examples} onLoadSavedExample={onLoad} />);
    expect(screen.getAllByText(SAVED_EXAMPLE_LABEL).length).toBeGreaterThan(0);
    screen.getByRole("button", { name: "Open Obstacle-avoiding rover" }).click();
    expect(onLoad).toHaveBeenCalledWith("rover_obstacle_v1");
    expect(vi.getTimerCount()).toBe(0);
    rerender(<SavedExampleLauncher examples={examples} onLoadSavedExample={onLoad} loadedExampleId="rover_obstacle_v1" />);
    expect(screen.getByTestId("saved-example-loaded").textContent).toContain(SAVED_EXAMPLE_LABEL);
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByRole("list", { name: "Pipeline stages" })).toBeNull();
    expect(screen.queryByText(/generation status/i)).toBeNull();
  });

  it("does not upload or generate when a saved example is opened from the intake", async () => {
    stubObjectUrls();
    const user = userEvent.setup();
    const onUpload = vi.fn();
    const onGenerate = vi.fn();
    const onLoadSavedExample = vi.fn();
    render(
      <BuildIntake
        onUpload={onUpload}
        onGenerate={onGenerate}
        savedExamples={examples}
        onLoadSavedExample={onLoadSavedExample}
        loadedExampleId="rover_obstacle_v1"
      />,
    );
    await user.click(screen.getByRole("button", { name: "Open Obstacle-avoiding rover" }));
    expect(onLoadSavedExample).toHaveBeenCalledTimes(1);
    expect(onUpload).not.toHaveBeenCalled();
    expect(onGenerate).not.toHaveBeenCalled();
    expect(screen.queryByRole("list", { name: "Pipeline stages" })).toBeNull();
    expect(screen.getByTestId("saved-example-loaded").textContent).toContain("not supplier verified");
  });

  it("is keyboard operable", async () => {
    const user = userEvent.setup();
    const onLoad = vi.fn();
    render(<SavedExampleLauncher examples={examples} onLoadSavedExample={onLoad} />);
    await user.tab();
    expect(document.activeElement?.textContent).toBe("Open Obstacle-avoiding rover");
    await user.keyboard("{Enter}");
    expect(onLoad).toHaveBeenCalledWith("rover_obstacle_v1");
  });
});
