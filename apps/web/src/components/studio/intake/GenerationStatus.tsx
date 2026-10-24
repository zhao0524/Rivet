"use client";

import { useId } from "react";
import { STAGE_LABELS, buildStageRows, formatTimestamp, orderEvents, type StageDisplayStatus } from "./stages";
import type { JobEvent, JobStatus } from "./types";

export interface GenerationStatusProps {
  job: JobStatus | null | undefined;
  events?: readonly JobEvent[];
  /** Set when the user canceled locally; the job is then not shown as running or complete. */
  canceled?: boolean;
  onCancel?: () => void;
  onRetry?: () => void;
  className?: string;
}

const STATUS_TEXT: Record<StageDisplayStatus, string> = {
  not_reported: "Not reported",
  running: "Running",
  ok: "Done",
  warning: "Warning",
  failed: "Failed",
};

function summary(job: JobStatus | null | undefined, canceled: boolean, eventCount: number): string {
  if (!job) return "No generation job yet.";
  if (canceled) return "Canceled. Rivet is no longer following this job; no result was produced here.";
  switch (job.status) {
    case "queued":
      return eventCount === 0 ? "Queued. Waiting for the server to report progress." : "Queued.";
    case "running":
      return job.stage ? `Running: ${STAGE_LABELS[job.stage]}.` : "Running.";
    case "complete":
      return "Complete.";
    case "failed":
      return "Failed.";
  }
}

/** Backend reports `progress` as a 0–1 fraction of planned stages. */
function toPercent(progress: number): number {
  return Math.max(0, Math.min(100, Math.round(progress * 100)));
}

export function GenerationStatus({
  job,
  events = [],
  canceled = false,
  onCancel,
  onRetry,
  className,
}: GenerationStatusProps) {
  const headingId = useId();
  const ordered = orderEvents(events, job?.job_id);
  const rows = buildStageRows(job, events);
  const active = !!job && !canceled && (job.status === "queued" || job.status === "running");
  const failed = !!job && job.status === "failed";
  const retryBlocked = failed && job?.error?.retryable === false;
  const showRetry = !!onRetry && !!job && (canceled || failed) && !retryBlocked;
  const progress = !canceled && typeof job?.progress === "number" ? toPercent(job.progress) : null;

  return (
    <section aria-labelledby={headingId} className={className} data-rivet="generation-status">
      <h2 id={headingId} className="text-base font-semibold">
        Generation status
      </h2>
      <p role="status" aria-live="polite" data-testid="generation-summary">
        {summary(job, canceled, ordered.length)}
      </p>
      {job ? <p className="text-xs">Job {job.job_id}</p> : null}

      {progress !== null ? (
        <div className="mt-2">
          <label className="text-sm">
            Server-reported progress: {progress}%{" "}
            <progress value={progress} max={100} className="w-full" />
          </label>
        </div>
      ) : null}

      {job?.error ? (
        <div role="alert" className="mt-2 rounded p-2 text-sm" style={{ border: "1px solid rgba(239, 68, 68, 0.45)", color: "var(--rv-danger-text)" }} data-testid="generation-error">
          <p>
            <strong>{job.error.code}</strong>: {job.error.message}
          </p>
          {retryBlocked ? <p>This error is not retryable. Change the image or request and generate again.</p> : null}
        </div>
      ) : null}

      {job?.status === "complete" && !canceled && job.build_id ? (
        <p className="mt-2 text-sm">
          Build {job.build_id}
          {typeof job.revision === "number" ? `, revision ${job.revision}` : ""} is ready.
        </p>
      ) : null}

      {(active && onCancel) || showRetry ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {active && onCancel ? (
            <button type="button" onClick={onCancel} className="rv-btn">
              Cancel
            </button>
          ) : null}
          {showRetry ? (
            <button type="button" onClick={onRetry} className="rv-btn">
              Retry
            </button>
          ) : null}
        </div>
      ) : null}

      {job ? (
        <ol aria-label="Pipeline stages" className="mt-3 grid gap-1 text-sm sm:grid-cols-2">
          {rows.map((row) => (
            <li
              key={row.stage}
              data-stage={row.stage}
              data-status={row.status}
              aria-current={row.isCurrent && !canceled ? "step" : undefined}
              className="flex flex-wrap gap-x-2"
            >
              <span className="font-medium">{row.label}</span>
              <span>{STATUS_TEXT[row.status]}</span>
              {row.timestamp ? <time dateTime={row.timestamp}>{formatTimestamp(row.timestamp)}</time> : null}
              {row.message ? <span className="w-full text-xs">{row.message}</span> : null}
            </li>
          ))}
        </ol>
      ) : null}

      {ordered.length > 0 ? (
        <details className="mt-3 text-sm" open>
          <summary>Event log ({ordered.length})</summary>
          <ol aria-label="Job events" className="mt-1 grid gap-1">
            {ordered.map((event) => (
              <li key={event.event_id} data-event-id={event.event_id} data-status={event.status}>
                <span>#{event.event_id}</span> <time dateTime={event.timestamp}>{formatTimestamp(event.timestamp)}</time>{" "}
                <span>{STAGE_LABELS[event.stage]}</span> <span>({event.actor})</span>{" "}
                <span>{STATUS_TEXT[event.status]}</span>: <span>{event.message}</span>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </section>
  );
}
