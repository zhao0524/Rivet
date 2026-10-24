import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GenerationStatus } from "../GenerationStatus";
import { buildStageRows, orderEvents } from "../stages";
import { JOB_STAGES } from "../types";
import { event } from "./helpers";

afterEach(cleanup);

const outOfOrder = [
  event({ event_id: 3, stage: "catalog_selection", actor: "planner", message: "Finding compatible controller" }),
  event({ event_id: 1, stage: "upload", status: "ok", message: "Image stored" }),
  event({ event_id: 2, stage: "understand", actor: "vision", status: "ok", message: "Intent parsed" }),
  event({ event_id: 2, stage: "understand", actor: "vision", status: "ok", message: "Intent parsed" }),
  event({ event_id: 9, job_id: "other-job", stage: "complete", status: "ok", message: "Not this job" }),
];

describe("SSE event order display", () => {
  it("orders by event_id, drops replayed duplicates and other jobs", () => {
    expect(orderEvents(outOfOrder, "job-1").map((e) => e.event_id)).toEqual([1, 2, 3]);
  });

  it("renders the event log in event_id order with genuine timestamps", () => {
    render(<GenerationStatus job={{ job_id: "job-1", status: "running", stage: "catalog_selection" }} events={outOfOrder} />);
    const log = screen.getByRole("list", { name: "Job events" });
    const items = Array.from(log.querySelectorAll("li"));
    expect(items.map((li) => li.getAttribute("data-event-id"))).toEqual(["1", "2", "3"]);
    expect(items[0].querySelector("time")?.getAttribute("dateTime")).toBe("2026-10-24T00:00:01Z");
    expect(log.textContent).not.toContain("Not this job");
  });

  it("lists every contract stage in order and only marks reported ones", () => {
    render(<GenerationStatus job={{ job_id: "job-1", status: "running", stage: "catalog_selection" }} events={outOfOrder} />);
    const rows = Array.from(screen.getByRole("list", { name: "Pipeline stages" }).querySelectorAll("li"));
    expect(rows.map((r) => r.getAttribute("data-stage"))).toEqual([...JOB_STAGES]);
    const statusOf = Object.fromEntries(rows.map((r) => [r.getAttribute("data-stage"), r.getAttribute("data-status")]));
    expect(statusOf).toMatchObject({
      upload: "ok",
      understand: "ok",
      catalog_selection: "running",
      assembly: "not_reported",
      repair: "not_reported",
      complete: "not_reported",
      failed: "not_reported",
    });
    expect(rows.find((r) => r.getAttribute("aria-current") === "step")?.getAttribute("data-stage")).toBe(
      "catalog_selection",
    );
  });

  it("uses the latest event per stage", () => {
    const rows = buildStageRows({ job_id: "job-1", status: "running" }, [
      event({ event_id: 5, stage: "validate", status: "warning", message: "Price unknown" }),
      event({ event_id: 4, stage: "validate", status: "running", message: "Checking" }),
    ]);
    expect(rows.find((r) => r.stage === "validate")).toMatchObject({ status: "warning", message: "Price unknown" });
  });

  it("shows no progress bar unless the backend reports progress", () => {
    const { rerender } = render(<GenerationStatus job={{ job_id: "job-1", status: "running" }} />);
    expect(screen.queryByRole("progressbar")).toBeNull();
    rerender(<GenerationStatus job={{ job_id: "job-1", status: "running", progress: 0.4 }} />);
    expect(screen.getByRole("progressbar").getAttribute("value")).toBe("40");
  });
});
