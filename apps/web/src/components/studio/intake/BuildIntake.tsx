"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { GenerationStatus } from "./GenerationStatus";
import { ImageDropzone } from "./ImageDropzone";
import { SavedExampleLauncher } from "./SavedExampleLauncher";
import type {
  GenerateRequest,
  JobEvent,
  JobStatus,
  SavedExampleSummary,
  UploadOptions,
  UploadedImageAsset,
} from "./types";
import { MAX_IMAGE_BYTES } from "./validation";

export interface BuildIntakeProps {
  /** Uploads the image (`POST /api/assets/images`). Only called after the user clicks Generate. */
  onUpload: (file: File, options?: UploadOptions) => Promise<UploadedImageAsset>;
  /** Starts a job (`POST /api/projects/generate`). Job state comes back through `job`/`events`. */
  onGenerate: (request: GenerateRequest) => Promise<unknown> | void;
  /** Backend job state, from `GET /api/jobs/{id}`. */
  job?: JobStatus | null;
  /** Backend job events, from SSE or polling, in any order. */
  events?: readonly JobEvent[];
  /** Optional hook to stop the caller's SSE/polling (or a server-side cancel when available). */
  onCancelJob?: (jobId: string) => void;
  savedExamples?: readonly SavedExampleSummary[];
  onLoadSavedExample?: (exampleId: string) => void;
  loadedExampleId?: string | null;
  currency?: string;
  maxImageBytes?: number;
  className?: string;
}

type Phase = "idle" | "uploading" | "submitting";

/** The demo request from README "Demo target"; offered as a one-click quick fill. */
export const SAMPLE_PROMPT =
  "Design something like this that can avoid obstacles. Use real parts and explain how to build it.";

function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: string }).name === "AbortError";
}

function errorMessage(error: unknown, fallback: string): string {
  if (typeof error === "object" && error !== null) {
    const body = (error as { error?: { message?: unknown } }).error;
    if (body && typeof body.message === "string") return body.message;
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  if (typeof error === "string" && error) return error;
  return fallback;
}

function parseBudget(raw: string): { ok: true; value: number | null } | { ok: false; message: string } {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: null };
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) {
    return { ok: false, message: "Budget must be a positive number, or left empty for no hard limit." };
  }
  return { ok: true, value };
}

export function BuildIntake({
  onUpload,
  onGenerate,
  job = null,
  events = [],
  onCancelJob,
  savedExamples,
  onLoadSavedExample,
  loadedExampleId = null,
  currency = "USD",
  maxImageBytes = MAX_IMAGE_BYTES,
  className,
}: BuildIntakeProps) {
  const promptId = useId();
  const budgetId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [asset, setAsset] = useState<UploadedImageAsset | null>(null);
  const [prompt, setPrompt] = useState("");
  const [budget, setBudget] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [canceledJobId, setCanceledJobId] = useState<string | null>(null);
  const [lastRequest, setLastRequest] = useState<GenerateRequest | null>(null);
  const uploadAbort = useRef<AbortController | null>(null);

  const jobCanceled = !!job && canceledJobId === job.job_id;
  const jobActive = !!job && !jobCanceled && (job.status === "queued" || job.status === "running");
  const busy = phase !== "idle" || jobActive;
  const hasInput = !!file || prompt.trim().length > 0;

  function selectFile(next: File | null) {
    setFile(next);
    setAsset(null);
    setFormError(null);
  }

  async function submit(request: GenerateRequest) {
    setPhase("submitting");
    setCanceledJobId(null);
    try {
      await onGenerate(request);
      setLastRequest(request);
    } catch (error) {
      setLastRequest(request);
      setFormError(errorMessage(error, "Could not start generation."));
    } finally {
      setPhase("idle");
    }
  }

  async function generate() {
    setFormError(null);
    setNotice(null);
    if (!hasInput) {
      setFormError("Add a reference image or describe what you want to build.");
      return;
    }
    const parsedBudget = parseBudget(budget);
    if (!parsedBudget.ok) {
      setFormError(parsedBudget.message);
      return;
    }

    let uploaded = asset;
    if (file && !uploaded) {
      const controller = new AbortController();
      uploadAbort.current = controller;
      setPhase("uploading");
      try {
        uploaded = await onUpload(file, { signal: controller.signal });
      } catch (error) {
        if (controller.signal.aborted || isAbortError(error)) return;
        setPhase("idle");
        setFormError(errorMessage(error, "Image upload failed."));
        return;
      } finally {
        if (uploadAbort.current === controller) uploadAbort.current = null;
      }
      if (controller.signal.aborted) return;
      setAsset(uploaded);
    }

    const userText = prompt.trim() || null;
    const imageId = uploaded?.asset_id ?? null;
    const request: GenerateRequest = {
      input: {
        kind: imageId && userText ? "image_and_text" : imageId ? "image" : "text",
        image_asset_id: imageId,
        user_text: userText,
      },
      requirements: { max_budget: parsedBudget.value, currency },
    };
    await submit(request);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    void generate();
  }

  function cancel() {
    if (phase === "uploading") {
      uploadAbort.current?.abort();
      uploadAbort.current = null;
      setPhase("idle");
      setNotice("Upload canceled. Nothing was generated.");
      return;
    }
    if (job && jobActive) {
      setCanceledJobId(job.job_id);
      onCancelJob?.(job.job_id);
    }
  }

  function retry() {
    setFormError(null);
    setNotice(null);
    if (lastRequest) {
      void submit(lastRequest);
    } else {
      void generate();
    }
  }

  const showFormRetry = !!formError && phase === "idle" && !jobActive && (!!lastRequest || !!asset || !!file);

  return (
    <div className={className} data-rivet="build-intake" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <form onSubmit={onSubmit} noValidate aria-label="New build" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <ImageDropzone
          file={file}
          onFileAccepted={selectFile}
          onClear={() => selectFile(null)}
          disabled={busy}
          maxBytes={maxImageBytes}
        />
        {asset ? <p className="rv-hint">Image uploaded.</p> : null}

        <div className="rv-field">
          <label htmlFor={promptId} className="rv-label">
            What should it do?
          </label>
          <textarea
            id={promptId}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            disabled={busy}
            rows={3}
            className="rv-input"
            placeholder="Describe the build, or what it should do with the image above."
          />
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            <span className="rv-hint">Optional when you add an image.</span>
            {prompt.trim() !== SAMPLE_PROMPT ? (
              <button
                type="button"
                className="rv-chip"
                data-testid="intake-sample-prompt"
                disabled={busy}
                title={SAMPLE_PROMPT}
                onClick={() => setPrompt(SAMPLE_PROMPT)}
              >
                Try: “Design something like this that can avoid obstacles…”
              </button>
            ) : null}
          </div>
        </div>

        <details className="rv-details" data-testid="intake-constraints" open={budget !== "" || undefined}>
          <summary>Constraints (optional)</summary>
          <div className="rv-field">
            <label htmlFor={budgetId} className="rv-label">
              Max budget ({currency})
            </label>
            <input
              id={budgetId}
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              value={budget}
              onChange={(event) => setBudget(event.target.value)}
              disabled={busy}
              className="rv-input"
              style={{ width: 160 }}
            />
            <span className="rv-hint">Leave empty for no hard limit.</span>
          </div>
        </details>

        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          <button type="submit" disabled={busy || !hasInput} className="rv-btn rv-btn--primary" style={{ minHeight: 36, padding: "6px 16px" }}>
            {file && !asset ? "Upload and generate" : "Generate"}
          </button>
          {phase === "uploading" ? (
            <button type="button" onClick={cancel} className="rv-btn">
              Cancel upload
            </button>
          ) : null}
          {showFormRetry ? (
            <button type="button" onClick={retry} className="rv-btn">
              Retry
            </button>
          ) : null}
          <p role="status" aria-live="polite" className="rv-hint" data-testid="intake-phase">
            {phase === "uploading" ? "Uploading image…" : phase === "submitting" ? "Starting generation…" : notice ?? ""}
          </p>
        </div>
        {formError ? (
          <p role="alert" data-testid="intake-error" style={{ margin: 0, color: "var(--rv-danger-text)" }}>
            {formError}
          </p>
        ) : null}
      </form>

      {job ? (
        <GenerationStatus
          job={job}
          events={events}
          canceled={jobCanceled}
          onCancel={cancel}
          onRetry={lastRequest ? retry : undefined}
        />
      ) : null}

      {savedExamples && onLoadSavedExample ? (
        <SavedExampleLauncher
          examples={savedExamples}
          onLoadSavedExample={onLoadSavedExample}
          loadedExampleId={loadedExampleId}
          disabled={busy}
        />
      ) : null}
    </div>
  );
}
