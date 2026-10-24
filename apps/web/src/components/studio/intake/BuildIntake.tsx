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
    <div className={className} data-rivet="build-intake">
      <div className="flex flex-col gap-6 lg:flex-row">
        <form onSubmit={onSubmit} noValidate className="flex min-w-0 flex-1 flex-col gap-4" aria-label="New build">
          <ImageDropzone
            file={file}
            onFileAccepted={selectFile}
            onClear={() => selectFile(null)}
            disabled={busy}
            maxBytes={maxImageBytes}
          />
          {asset ? <p className="text-xs">Uploaded as {asset.asset_id}.</p> : null}

          <div className="flex flex-col gap-1">
            <label htmlFor={promptId} className="text-sm font-medium">
              What should it do? (optional with an image)
            </label>
            <textarea
              id={promptId}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              disabled={busy}
              rows={3}
              className="rounded border p-2"
              placeholder="Design something like this that can avoid obstacles."
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor={budgetId} className="text-sm font-medium">
              Max budget ({currency}, optional)
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
              className="w-40 rounded border p-2"
            />
            <span className="text-xs">Leave empty for no hard limit.</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={busy || !hasInput} className="rounded border px-3 py-1 font-medium">
              {file && !asset ? "Upload and generate" : "Generate"}
            </button>
            {phase === "uploading" ? (
              <button type="button" onClick={cancel} className="rounded border px-3 py-1">
                Cancel upload
              </button>
            ) : null}
            {showFormRetry ? (
              <button type="button" onClick={retry} className="rounded border px-3 py-1">
                Retry
              </button>
            ) : null}
          </div>

          <p role="status" aria-live="polite" className="text-sm" data-testid="intake-phase">
            {phase === "uploading" ? "Uploading image…" : phase === "submitting" ? "Starting generation…" : notice ?? ""}
          </p>
          {formError ? (
            <p role="alert" className="text-sm" data-testid="intake-error">
              {formError}
            </p>
          ) : null}
        </form>

        {savedExamples && onLoadSavedExample ? (
          <SavedExampleLauncher
            className="lg:w-80"
            examples={savedExamples}
            onLoadSavedExample={onLoadSavedExample}
            loadedExampleId={loadedExampleId}
            disabled={busy}
          />
        ) : null}
      </div>

      {job ? (
        <GenerationStatus
          className="mt-6"
          job={job}
          events={events}
          canceled={jobCanceled}
          onCancel={cancel}
          onRetry={lastRequest ? retry : undefined}
        />
      ) : null}
    </div>
  );
}
