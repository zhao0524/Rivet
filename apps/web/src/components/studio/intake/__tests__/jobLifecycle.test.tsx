import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BuildIntake, type BuildIntakeProps } from "../BuildIntake";
import { GenerationStatus } from "../GenerationStatus";
import type { JobStatus, UploadOptions, UploadedImageAsset } from "../types";
import { event, makeFile, stubObjectUrls } from "./helpers";

afterEach(cleanup);

const asset: UploadedImageAsset = {
  asset_id: "asset-1",
  mime_type: "image/png",
  size_bytes: 1024,
  preview_url: "/api/assets/images/asset-1",
};

function renderIntake(props: Partial<BuildIntakeProps> = {}) {
  stubObjectUrls();
  const onUpload = vi.fn(async () => asset);
  const onGenerate = vi.fn(async () => undefined);
  const all = { onUpload, onGenerate, ...props } as BuildIntakeProps;
  const utils = render(<BuildIntake {...all} />);
  const rerender = (next: Partial<BuildIntakeProps>) => utils.rerender(<BuildIntake {...all} {...next} />);
  return { ...utils, onUpload: all.onUpload, onGenerate: all.onGenerate, rerender };
}

describe("canceled job", () => {
  it("aborts an in-flight upload and never starts generation", async () => {
    const user = userEvent.setup();
    let signal: AbortSignal | undefined;
    let resolveUpload: (value: UploadedImageAsset) => void = () => undefined;
    const onUpload = vi.fn((_file: File, options?: UploadOptions) => {
      signal = options?.signal;
      return new Promise<UploadedImageAsset>((resolve) => {
        resolveUpload = resolve;
      });
    });
    const { onGenerate } = renderIntake({ onUpload });
    fireEvent.change(screen.getByTestId("image-dropzone-input"), {
      target: { files: [makeFile("rover.png", "image/png")] },
    });
    await user.click(screen.getByRole("button", { name: "Upload and generate" }));
    expect(screen.getByTestId("intake-phase").textContent).toMatch(/Uploading/);
    await user.click(screen.getByRole("button", { name: "Cancel upload" }));
    expect(signal?.aborted).toBe(true);
    expect(screen.getByTestId("intake-phase").textContent).toMatch(/Upload canceled/);
    resolveUpload(asset);
    await Promise.resolve();
    expect(onGenerate).not.toHaveBeenCalled();
  });

  it("marks a running job canceled without showing it as complete", async () => {
    const user = userEvent.setup();
    const onCancelJob = vi.fn();
    const job: JobStatus = { job_id: "job-1", status: "running", stage: "assembly" };
    renderIntake({
      job,
      events: [event({ event_id: 1, stage: "upload", status: "ok" }), event({ event_id: 2, stage: "assembly" })],
      onCancelJob,
    });
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancelJob).toHaveBeenCalledWith("job-1");
    expect(screen.getByTestId("generation-summary").textContent).toMatch(/^Canceled/);
    const stages = screen.getByRole("list", { name: "Pipeline stages" });
    expect(stages.querySelector('[data-stage="complete"]')?.getAttribute("data-status")).toBe("not_reported");
    expect(stages.querySelector("[aria-current]")).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });
});

describe("retried job", () => {
  it("resubmits the same request after a canceled job without re-uploading", async () => {
    const user = userEvent.setup();
    const { onUpload, onGenerate, rerender } = renderIntake();
    fireEvent.change(screen.getByTestId("image-dropzone-input"), {
      target: { files: [makeFile("rover.png", "image/png")] },
    });
    await user.type(screen.getByLabelText(/what should it do/i), "Avoid obstacles");
    await user.click(screen.getByRole("button", { name: "Upload and generate" }));
    expect(onGenerate).toHaveBeenCalledTimes(1);
    const firstRequest = vi.mocked(onGenerate).mock.calls[0][0];
    expect(firstRequest.input).toEqual({ kind: "image_and_text", image_asset_id: "asset-1", user_text: "Avoid obstacles" });

    rerender({ job: { job_id: "job-1", status: "running", stage: "understand" } });
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(onGenerate).toHaveBeenCalledTimes(2);
    expect(vi.mocked(onGenerate).mock.calls[1][0]).toEqual(firstRequest);
    expect(onUpload).toHaveBeenCalledTimes(1);

    rerender({ job: { job_id: "job-2", status: "queued" }, events: [] });
    expect(screen.getByTestId("generation-summary").textContent).toMatch(/Waiting for the server/);
  });

  it("offers retry for a retryable failure and shows the backend error", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <GenerationStatus
        job={{
          job_id: "job-1",
          status: "failed",
          stage: "understand",
          error: { code: "PROVIDER_UNAVAILABLE", message: "Vision provider timed out", retryable: true },
        }}
        events={[event({ event_id: 1, stage: "understand", status: "failed", message: "Vision provider timed out" })]}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("PROVIDER_UNAVAILABLE");
    const failedRow = screen.getByRole("list", { name: "Pipeline stages" }).querySelector('[data-stage="failed"]');
    expect(failedRow?.getAttribute("data-status")).toBe("failed");
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("hides retry for a non-retryable failure", () => {
    render(
      <GenerationStatus
        job={{
          job_id: "job-1",
          status: "failed",
          error: { code: "UNSUPPORTED_PROJECT_FAMILY", message: "Drones are not supported", retryable: false },
        }}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(within(screen.getByRole("alert")).getByText(/not retryable/)).toBeTruthy();
  });

  it("offers retry when starting generation fails", async () => {
    const user = userEvent.setup();
    const onGenerate = vi
      .fn()
      .mockRejectedValueOnce({ error: { code: "UPSTREAM", message: "API unreachable", retryable: true } })
      .mockResolvedValueOnce(undefined);
    renderIntake({ onGenerate });
    await user.type(screen.getByLabelText(/what should it do/i), "rover");
    await user.click(screen.getByRole("button", { name: "Generate" }));
    expect(screen.getByTestId("intake-error").textContent).toBe("API unreachable");
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(onGenerate).toHaveBeenCalledTimes(2);
    expect(onGenerate.mock.calls[1][0]).toEqual(onGenerate.mock.calls[0][0]);
    expect(screen.queryByTestId("intake-error")).toBeNull();
  });
});
