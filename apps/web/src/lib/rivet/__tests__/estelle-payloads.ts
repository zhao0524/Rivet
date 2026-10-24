import type { EstelleGroundResponse, EstelleStatusResponse } from "../types";

/**
 * `GET /api/estelle/status` bodies as services/api returns them (`RepoGrounder.status()`):
 * `disabled` and `cliMissing` were captured from the running API, the others from the same code
 * path with a stubbed CLI. The doctor output text is illustrative; the real format is undocumented.
 */
export const ESTELLE_STATUS = {
  disabled: {
    enabled: false,
    mode: "cli",
    available: false,
    doctor: null,
    reason: "Estelle is disabled (RIVET_ENABLE_ESTELLE is not true)",
  },
  cliMissing: {
    enabled: true,
    mode: "cli",
    available: false,
    doctor: null,
    reason: "The estelle CLI is not installed (npm i -g @fatelabs/estelle)",
  },
  notAuthenticated: {
    enabled: true,
    mode: "cli",
    available: false,
    doctor: { exit_code: 2, output_tail: "Error: not logged in. Run estelle login" },
    reason: "estelle doctor exited with status 2",
  },
  mcpMode: {
    enabled: true,
    mode: "mcp",
    available: false,
    doctor: null,
    reason: "Estelle MCP mode is not implemented: the MCP tool parameters are not documented",
  },
  ready: {
    enabled: true,
    mode: "cli",
    available: true,
    doctor: { exit_code: 0, output_tail: "credentials ok" },
    reason: "",
  },
} satisfies Record<string, EstelleStatusResponse>;

/** The shape the web client expected before #65; the API never sends it. */
export const LEGACY_WEB_STATUS_SHAPE = {
  status: "unavailable",
  enabled: false,
  mode: "cli",
  cli_found: false,
  repo_valid: false,
  reason: "Estelle is disabled (RIVET_ENABLE_ESTELLE is not true)",
};

export const FIXTURE_STATUS_REASON = "Estelle grounding is unavailable in offline fixture mode.";

/** Test double of a verified grounding result; the citation is where the symbol is really defined. */
export const GROUNDED_RESULT: EstelleGroundResponse = {
  status: "ok",
  tool: "estelle ask",
  question: "Where is read_front_distance defined? Cite the file and line.",
  timestamp: "2026-10-24T18:00:00Z",
  exit_code: 0,
  citations: [{ path: "services/api/rivet_api/firmware/templates/esp32_rover/main.cpp.tmpl", line: 54, symbol_in_file: true }],
  raw_output_tail: "",
  reason: "",
  evidence_file: "estelle_evidence.json",
};
