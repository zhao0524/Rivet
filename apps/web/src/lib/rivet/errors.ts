import type { ApiErrorBody } from "./types";

export interface ValidationIssue {
  /** JSONPath-like location, e.g. `$.components[3].pose.position_mm[1]`. */
  path: string;
  message: string;
}

export type RivetErrorKind =
  | "bad_request"
  | "not_found"
  | "conflict"
  | "unsupported"
  | "rate_limited"
  | "upstream_unavailable"
  | "server"
  | "network"
  | "timeout"
  | "aborted"
  | "contract"
  | "fixture_unavailable"
  | "unknown";

export interface RivetErrorInit {
  kind: RivetErrorKind;
  code: string;
  message: string;
  hint?: string;
  status?: number;
  retryable?: boolean;
  details?: Record<string, unknown> | null;
  issues?: ValidationIssue[];
  cause?: unknown;
}

const DEFAULT_HINTS: Record<RivetErrorKind, string> = {
  bad_request: "Check the request fields against contracts/api.md.",
  not_found: "The build, revision or job does not exist; reload the project list.",
  conflict: "The build changed since it was loaded; reload the latest revision and retry the edit.",
  unsupported: "This request is outside the supported scope (rover only); try a supported alternative.",
  rate_limited: "The AI provider quota was hit; wait and retry, or open the saved example.",
  upstream_unavailable: "An upstream service is unavailable; retry shortly or switch to fixture mode.",
  server: "The API returned an unexpected server error; check the API logs.",
  network: "Could not reach the Rivet API. Is it running at NEXT_PUBLIC_RIVET_API_URL? Set NEXT_PUBLIC_RIVET_USE_FIXTURES=true to work offline.",
  timeout: "The API did not respond in time; retry or increase the timeout.",
  aborted: "The request was cancelled.",
  contract: "Received data that does not match the Rivet v1 contract; it was rejected instead of rendered.",
  fixture_unavailable: "This action needs the live API; fixture mode only serves saved responses.",
  unknown: "Unexpected error.",
};

const DEFAULT_RETRYABLE: Record<RivetErrorKind, boolean> = {
  bad_request: false,
  not_found: false,
  conflict: false,
  unsupported: false,
  rate_limited: true,
  upstream_unavailable: true,
  server: true,
  network: true,
  timeout: true,
  aborted: false,
  contract: false,
  fixture_unavailable: false,
  unknown: false,
};

export class RivetError extends Error {
  readonly kind: RivetErrorKind;
  readonly code: string;
  readonly hint: string;
  readonly status?: number;
  readonly retryable: boolean;
  readonly details: Record<string, unknown> | null;
  readonly issues: ValidationIssue[];

  constructor(init: RivetErrorInit) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = "RivetError";
    this.kind = init.kind;
    this.code = init.code;
    this.hint = init.hint ?? DEFAULT_HINTS[init.kind];
    this.status = init.status;
    this.retryable = init.retryable ?? DEFAULT_RETRYABLE[init.kind];
    this.details = init.details ?? null;
    this.issues = init.issues ?? [];
  }
}

export class RivetContractError extends RivetError {
  constructor(what: string, issues: ValidationIssue[], cause?: unknown) {
    const shown = issues.slice(0, 5).map((i) => `${i.path}: ${i.message}`);
    const more = issues.length > 5 ? ` (+${issues.length - 5} more)` : "";
    super({
      kind: "contract",
      code: "CONTRACT_VIOLATION",
      message: `Invalid ${what}: ${shown.join("; ")}${more}`,
      issues,
      cause,
    });
    this.name = "RivetContractError";
  }
}

export function isRivetError(value: unknown): value is RivetError {
  return value instanceof RivetError;
}

export function kindForStatus(status: number): RivetErrorKind {
  if (status === 400) return "bad_request";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 422) return "unsupported";
  if (status === 429) return "rate_limited";
  if (status === 502 || status === 503 || status === 504) return "upstream_unavailable";
  if (status >= 500) return "server";
  if (status >= 400) return "bad_request";
  return "unknown";
}

/** Map an HTTP status plus (optional) contract error envelope body to a RivetError. */
export function errorFromHttp(status: number, body: ApiErrorBody | null, fallbackMessage: string): RivetError {
  const kind = kindForStatus(status);
  return new RivetError({
    kind,
    status,
    code: body?.code ?? `HTTP_${status}`,
    message: body?.message ?? fallbackMessage,
    details: body?.details ?? null,
    retryable: body?.retryable,
  });
}
