"use client";

import { useId, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { useImagePreview } from "./useImagePreview";
import {
  ACCEPTED_IMAGE_EXTENSIONS,
  ACCEPTED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  formatBytes,
  validateImageFile,
  type ImageValidationResult,
} from "./validation";

export interface ImageDropzoneProps {
  /** Currently selected file (controlled). Selecting a file never uploads it. */
  file: File | null;
  onFileAccepted: (file: File) => void;
  onClear?: () => void;
  onRejected?: (result: Extract<ImageValidationResult, { ok: false }>, file: File) => void;
  disabled?: boolean;
  maxBytes?: number;
  label?: string;
  className?: string;
}

export function ImageDropzone({
  file,
  onFileAccepted,
  onClear,
  onRejected,
  disabled = false,
  maxBytes = MAX_IMAGE_BYTES,
  label = "Reference image (optional)",
  className,
}: ImageDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const previewUrl = useImagePreview(file);
  const labelId = useId();
  const hintId = useId();
  const errorId = useId();

  const accept = [...ACCEPTED_IMAGE_TYPES, ...ACCEPTED_IMAGE_EXTENSIONS].join(",");

  function handleFiles(files: FileList | null | undefined) {
    const candidate = files?.[0];
    if (!candidate) return;
    const result = validateImageFile(candidate, { maxBytes });
    if (!result.ok) {
      setError(result.message);
      onRejected?.(result, candidate);
      return;
    }
    setError(null);
    onFileAccepted(candidate);
  }

  function onInputChange(event: ChangeEvent<HTMLInputElement>) {
    handleFiles(event.target.files);
    event.target.value = "";
  }

  function onDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (disabled) return;
    event.dataTransfer.dropEffect = "copy";
    setDragging(true);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    handleFiles(event.dataTransfer.files);
  }

  function clear() {
    setError(null);
    onClear?.();
  }

  return (
    <div className={className} data-rivet="image-dropzone">
      <span id={labelId} className="rv-label">
        {label}
      </span>
      <div
        role="group"
        aria-labelledby={labelId}
        aria-describedby={error ? `${hintId} ${errorId}` : hintId}
        data-dragging={dragging || undefined}
        data-disabled={disabled || undefined}
        onDragOver={onDragOver}
        onDragEnter={onDragOver}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className="rv-dropzone"
      >
        {file && previewUrl ? (
          <img src={previewUrl} alt={`Preview of ${file.name}`} />
        ) : null}
        {file ? (
          <p className="rv-hint" style={{ color: "var(--rv-text)" }}>
            {file.name} · {formatBytes(file.size)} · not uploaded yet
          </p>
        ) : (
          <p className="rv-hint" style={{ color: "var(--rv-text)" }}>Drag an image here, or</p>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 8 }}>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={disabled}
            className="rv-btn"
          >
            {file ? "Replace image" : "Choose image"}
          </button>
          {file && onClear ? (
            <button type="button" onClick={clear} disabled={disabled} className="rv-btn">
              Remove image
            </button>
          ) : null}
        </div>
        <p id={hintId} className="rv-hint">
          PNG, JPEG or WebP, up to {formatBytes(maxBytes)}.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          onChange={onInputChange}
          disabled={disabled}
          hidden
          tabIndex={-1}
          aria-hidden="true"
          data-testid="image-dropzone-input"
        />
      </div>
      {error ? (
        <p id={errorId} role="alert" style={{ margin: "6px 0 0", color: "var(--rv-danger-text)" }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
