"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { InterpretResponse } from "../../../lib/rivet/types";
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
  /** Reads the input without calling the engine; generation requires explicit confirmation. */
  onInterpret?: (request: GenerateRequest) => Promise<InterpretResponse>;
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

type Phase = "idle" | "uploading" | "interpreting" | "submitting";

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
  onInterpret,
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
  const [interpretation, setInterpretation] = useState<InterpretResponse | null>(null);
  const [interpretedRequest, setInterpretedRequest] = useState<GenerateRequest | null>(null);
  const requestEpoch = useRef(0);
  useEffect(() => () => { requestEpoch.current += 1; uploadAbort.current?.abort(); }, []);
  function clearInterpretation() {
    requestEpoch.current += 1;
    setInterpretation(null);
    setInterpretedRequest(null);
    setLastRequest(null);
    setPhase("idle");
  }
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
    clearInterpretation();
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
      const code = (error as { code?: string })?.code;
      if (code === "INTENT_NOT_FOUND" || code === "INTENT_INPUT_MISMATCH") {
        clearInterpretation();
        setFormError("This interpretation expired or the input changed. Review the input again before building.");
      } else setFormError(errorMessage(error, "Could not start generation."));
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
    if (onInterpret) {
      const epoch = ++requestEpoch.current;
      setPhase("interpreting");
      try {
        const result = await onInterpret(request);
        if (epoch !== requestEpoch.current) return;
        setInterpretation(result);
        setInterpretedRequest(request);
      } catch (error) {
        if (epoch === requestEpoch.current) setFormError(errorMessage(error, "Could not interpret this input. Try another image or describe it in words."));
      } finally {
        if (epoch === requestEpoch.current) setPhase("idle");
      }
    } else await submit(request);
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
    if (lastRequest && (!onInterpret || interpretation)) {
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
            onChange={(event) => { clearInterpretation(); setPrompt(event.target.value); }}
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
                onClick={() => { clearInterpretation(); setPrompt(SAMPLE_PROMPT); }}
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
              onChange={(event) => { clearInterpretation(); setBudget(event.target.value); }}
              disabled={busy}
              className="rv-input"
              style={{ width: 160 }}
            />
            <span className="rv-hint">Leave empty for no hard limit.</span>
          </div>
        </details>

        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          <button type="submit" disabled={busy || !hasInput} className="rv-btn rv-btn--primary" style={{ minHeight: 36, padding: "6px 16px" }}>
            {onInterpret ? "Review interpretation" : file && !asset ? "Upload and generate" : "Generate"}
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
            {phase === "uploading" ? "Uploading image…" : phase === "interpreting" ? "Reading the input…" : phase === "submitting" ? "Starting generation…" : notice ?? ""}
          </p>
        </div>
        {formError ? (
          <p role="alert" data-testid="intake-error" style={{ margin: 0, color: "var(--rv-danger-text)" }}>
            {formError}
          </p>
        ) : null}
      </form>

      {interpretation && interpretedRequest ? (
        <section aria-label="What we understood" data-testid="interpretation-card" className="rv-details" style={{ padding: 12 }}>
          <h2>Here is what we understood</h2>
          <p><strong>{interpretation.intent.project_family.replace(/_/g, " ")}</strong> · {interpretation.intent.confidence} confidence</p>
          {interpretation.vision_mode !== "live" && <p role="note">Offline example interpretation: this provider does not read your image.</p>}
          {interpretation.intent.confidence === "low" && <p role="note">Low confidence. Check the interpretation and correct your description before continuing.</p>}
          {([
            ["Visible features", interpretation.intent.visual_features],
            ["Assumptions", interpretation.intent.assumptions],
            ["Missing information", interpretation.intent.unknowns],
          ] as const).map(([label, items]) => <div key={label}><h3>{label}</h3>{items.length ? <ul>{items.map((item, i) => <li key={i}>{item}</li>)}</ul> : <p>None reported.</p>}</div>)}
          {interpretation.limitation && <p role="alert">{interpretation.limitation.message}</p>}
          <p>The current rover template supports bounded front-sensor height changes. Other image features may be ignored; the resulting build explains which ones.</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button type="button" className="rv-btn rv-btn--primary" disabled={busy}
              onClick={() => void submit({ ...interpretedRequest, intent_id: interpretation.intent_id,
                interpretation_choice: interpretation.supported ? "as_interpreted" : "closest_supported_rover" })}>
              {interpretation.supported ? "Confirm and build" : "Build the closest supported rover"}
            </button>
            <button type="button" className="rv-btn" disabled={busy} onClick={() => { selectFile(null); document.querySelector<HTMLInputElement>('[data-testid="image-dropzone-input"]')?.focus(); }}>Replace image</button>
            <button type="button" className="rv-btn" disabled={busy} onClick={() => { selectFile(null); document.getElementById(promptId)?.focus(); }}>Describe it in words</button>
          </div>
        </section>
      ) : null}

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
