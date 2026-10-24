export const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const ACCEPTED_IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"] as const;
/** Matches the server-side limit in docs/implementation.md A1. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export type ImageValidationCode = "EMPTY_FILE" | "UNSUPPORTED_TYPE" | "FILE_TOO_LARGE";

export type ImageValidationResult =
  | { ok: true }
  | { ok: false; code: ImageValidationCode; message: string };

export interface ImageValidationOptions {
  maxBytes?: number;
  acceptedTypes?: readonly string[];
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Client-side pre-check only; the server still sniffs content and is
 * authoritative. Rejects before any upload so oversized files never leave
 * the browser.
 */
export function validateImageFile(
  file: Pick<File, "name" | "size" | "type">,
  options: ImageValidationOptions = {},
): ImageValidationResult {
  const maxBytes = options.maxBytes ?? MAX_IMAGE_BYTES;
  const acceptedTypes = options.acceptedTypes ?? ACCEPTED_IMAGE_TYPES;

  if (file.size === 0) {
    return { ok: false, code: "EMPTY_FILE", message: `"${file.name}" is empty.` };
  }
  if (!acceptedTypes.includes(file.type)) {
    const shown = file.type ? file.type : "unknown type";
    return {
      ok: false,
      code: "UNSUPPORTED_TYPE",
      message: `"${file.name}" (${shown}) is not supported. Use a PNG, JPEG or WebP image.`,
    };
  }
  if (file.size > maxBytes) {
    return {
      ok: false,
      code: "FILE_TOO_LARGE",
      message: `"${file.name}" is ${formatBytes(file.size)}; the limit is ${formatBytes(maxBytes)}.`,
    };
  }
  return { ok: true };
}
