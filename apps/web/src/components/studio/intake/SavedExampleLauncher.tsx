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
      <h2 id={headingId} className="text-base font-semibold">
        Saved examples
      </h2>
      <p className="text-xs">Opens instantly from saved data. No generation runs.</p>
      {examples.length === 0 ? (
        <p className="text-sm">No saved examples available.</p>
      ) : (
        <ul className="mt-2 grid gap-2">
          {examples.map((example) => (
            <li key={example.example_id} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
              <button
                type="button"
                onClick={() => onLoadSavedExample(example.example_id)}
                disabled={disabled}
                aria-pressed={example.example_id === loadedExampleId}
                className="rounded border px-3 py-1 text-left"
              >
                Open {example.title}
              </button>
              <SavedExampleBadge className="text-xs" />
              {example.status ? <span className="text-xs">Status: {example.status}</span> : null}
            </li>
          ))}
        </ul>
      )}
      {loaded ? (
        <p role="status" className="mt-2 rounded border p-2 text-sm" data-testid="saved-example-loaded">
          Showing {loaded.title}. {SAVED_EXAMPLE_LABEL}.
        </p>
      ) : null}
    </section>
  );
}
