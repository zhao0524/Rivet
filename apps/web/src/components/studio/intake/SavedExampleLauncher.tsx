"use client";

import { useId } from "react";
import type { SavedExampleSummary } from "./types";

export const SAVED_EXAMPLE_LABEL = "Saved synthetic example — not supplier verified";

export function SavedExampleBadge({ className }: { className?: string }) {
  return (
    <span className={className} data-rivet="saved-example-badge">
      {SAVED_EXAMPLE_LABEL}
    </span>
  );
}

export interface SavedExampleLauncherProps {
  examples: readonly SavedExampleSummary[];
  /** Called synchronously on click; the example should open without simulated generation. */
  onLoadSavedExample: (exampleId: string) => void;
  /** Id of the example currently open, if any. */
  loadedExampleId?: string | null;
  disabled?: boolean;
  className?: string;
}

const STATUS_BADGE: Record<string, { label: string; tone: "ok" | "warn" | "bad" }> = {
  verified: { label: "Verified", tone: "ok" },
  verified_with_warnings: { label: "Verified with warnings", tone: "warn" },
  needs_review: { label: "Needs review", tone: "warn" },
  unbuildable: { label: "Unbuildable", tone: "bad" },
};

export function SavedExampleLauncher({
  examples,
  onLoadSavedExample,
  loadedExampleId = null,
  disabled = false,
  className,
}: SavedExampleLauncherProps) {
  const headingId = useId();
  const loaded = loadedExampleId ? examples.find((example) => example.example_id === loadedExampleId) : undefined;

  return (
    <section aria-labelledby={headingId} className={className} data-rivet="saved-example-launcher">
      <h2 id={headingId} className="rv-label" style={{ margin: 0 }}>
        Or open a saved example
      </h2>
      <p className="rv-hint" style={{ margin: "2px 0 10px" }}>
        Opens instantly from saved data. No generation runs.
      </p>
      {examples.length === 0 ? (
        <p className="rv-hint">No saved examples available.</p>
      ) : (
        <ul className="rv-card-grid">
          {examples.map((example) => {
            const badge = example.status ? STATUS_BADGE[example.status] : undefined;
            const active = example.example_id === loadedExampleId;
            return (
              <li
                key={example.example_id}
                className="rv-card"
                data-active={active}
                data-testid={`saved-example-card-${example.example_id}`}
              >
                {example.status ? (
                  <span className={`rv-badge rv-badge--${badge?.tone ?? "warn"}`} style={{ alignSelf: "flex-start" }}>
                    {badge?.label ?? example.status}
                  </span>
                ) : null}
                <button
                  type="button"
                  className="rv-card__title"
                  onClick={() => onLoadSavedExample(example.example_id)}
                  disabled={disabled}
                  aria-pressed={active}
                >
                  Open {example.title}
                </button>
                <SavedExampleBadge className="rv-hint" />
              </li>
            );
          })}
        </ul>
      )}
      {loaded ? (
        <p role="status" className="rv-hint" style={{ marginTop: 10 }} data-testid="saved-example-loaded">
          Showing {loaded.title}. {SAVED_EXAMPLE_LABEL}.
        </p>
      ) : null}
    </section>
  );
}
