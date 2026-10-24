/**
 * What the studio shows for Estelle grounding (implementation.md A5). A disabled or unavailable
 * Estelle is a valid answer from the API, not a connectivity problem; `network_error` is only for
 * requests that produced no valid answer. Grounding is offered only in the `ready` state.
 */
import type { DataSourceMode } from "./honesty";
import type { EstelleStatusResponse } from "./types";

export type EstelleStatusState =
  /** No answer yet. */
  | { kind: "checking" }
  /** The API reports the feature flag off (`RIVET_ENABLE_ESTELLE` is not true). */
  | { kind: "disabled"; status: EstelleStatusResponse }
  /** Enabled but unusable for the reason the API gives (CLI missing, not logged in, MCP mode...), or fixture mode. */
  | { kind: "unavailable"; status: EstelleStatusResponse }
  /** Enabled and available (`estelle doctor` exited 0 on the API). */
  | { kind: "ready"; status: EstelleStatusResponse }
  /** No valid answer: fetch failed, timeout, HTTP error, non-JSON body or invalid payload. */
  | { kind: "network_error"; message: string };

export type EstelleStatusKind = EstelleStatusState["kind"];

/** Maps a valid status answer to its UI state. Saved fixtures never run Estelle, so fixture mode is never ready. */
export function estelleStatusState(status: EstelleStatusResponse, sourceMode: DataSourceMode): EstelleStatusState {
  if (sourceMode === "fixture") return { kind: "unavailable", status };
  if (!status.enabled) return { kind: "disabled", status };
  if (!status.available) return { kind: "unavailable", status };
  return { kind: "ready", status };
}
