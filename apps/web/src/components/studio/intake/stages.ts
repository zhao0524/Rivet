import { JOB_STAGES, type JobEvent, type JobEventStatus, type JobStage, type JobStatus } from "./types";

export const STAGE_LABELS: Record<JobStage, string> = {
  upload: "Upload",
  understand: "Understand request",
  catalog_selection: "Catalog selection",
  assembly: "Assembly",
  validate: "Validate",
  repair: "Repair",
  render_ready: "Render ready",
  firmware: "Firmware",
  complete: "Complete",
  failed: "Failed",
};

/** `not_reported` means the backend has sent nothing for this stage. */
export type StageDisplayStatus = JobEventStatus | "not_reported";

export interface StageRow {
  stage: JobStage;
  label: string;
  status: StageDisplayStatus;
  message: string | null;
  timestamp: string | null;
  isCurrent: boolean;
}

/** Sort by `event_id` and drop duplicates (e.g. replayed after SSE reconnect). */
export function orderEvents(events: readonly JobEvent[], jobId?: string | null): JobEvent[] {
  const byId = new Map<number, JobEvent>();
  for (const event of events) {
    if (jobId && event.job_id !== jobId) continue;
    byId.set(event.event_id, event);
  }
  return [...byId.values()].sort((a, b) => a.event_id - b.event_id);
}

export function buildStageRows(job: JobStatus | null | undefined, events: readonly JobEvent[]): StageRow[] {
  const ordered = orderEvents(events, job?.job_id);
  const latest = new Map<JobStage, JobEvent>();
  for (const event of ordered) latest.set(event.stage, event);

  const lastEvent = ordered.length > 0 ? ordered[ordered.length - 1] : undefined;
  const currentStage: JobStage | null = job?.stage ?? lastEvent?.stage ?? null;

  return JOB_STAGES.map((stage) => {
    const event = latest.get(stage);
    let status: StageDisplayStatus = event?.status ?? "not_reported";
    let message = event?.message ?? null;
    if (stage === "failed" && !event && job?.status === "failed") {
      status = "failed";
      message = job.error?.message ?? null;
    }
    return {
      stage,
      label: STAGE_LABELS[stage],
      status,
      message,
      timestamp: event?.timestamp ?? null,
      isCurrent: currentStage === stage,
    };
  });
}

export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "Z");
}
