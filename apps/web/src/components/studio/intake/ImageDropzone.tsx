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
      <span id={labelId} className="block text-sm font-medium">
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
        className="mt-1 flex flex-col items-center gap-2 rounded border border-dashed p-4 text-center data-[dragging]:border-solid"
      >
        {file && previewUrl ? (
          <img
            src={previewUrl}
            alt={`Preview of ${file.name}`}
            className="max-h-48 w-auto max-w-full object-contain"
          />
        ) : null}
        {file ? (
          <p className="text-sm">
            {file.name} · {formatBytes(file.size)} · not uploaded yet
          </p>
        ) : (
          <p className="text-sm">Drag an image here, or</p>
        )}
        <div className="flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={disabled}
            className="rounded border px-3 py-1"
          >
            {file ? "Replace image" : "Choose image"}
          </button>
          {file && onClear ? (
            <button type="button" onClick={clear} disabled={disabled} className="rounded border px-3 py-1">
              Remove image
            </button>
          ) : null}
        </div>
        <p id={hintId} className="text-xs">
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
        <p id={errorId} role="alert" className="mt-1 text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}
