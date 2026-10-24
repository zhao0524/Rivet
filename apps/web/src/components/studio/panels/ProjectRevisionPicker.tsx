import { useId } from "react";
import type { RevisionSummary } from "./types";
import { PLAN_STATUS_LABEL } from "./helpers";

export interface ProjectRevisionPickerProps {
  buildId: string;
  revisions: RevisionSummary[];
  currentRevision: number;
  /** Integration owns the API call; this component only reports the choice. */
  onSelectRevision: (revision: number) => void;
  pending?: boolean;
  error?: string | null;
}

export function ProjectRevisionPicker({
  buildId,
  revisions,
  currentRevision,
  onSelectRevision,
  pending = false,
  error = null,
}: ProjectRevisionPickerProps) {
  const selectId = useId();
  const ordered = [...revisions].sort((a, b) => b.revision - a.revision);
  const latest = ordered[0]?.revision;
  const known = ordered.some((r) => r.revision === currentRevision);

  return (
    <section
      aria-label="Project revisions"
      data-testid="revision-picker"
      aria-busy={pending}
      className="rivet-panel"
    >
      <label htmlFor={selectId}>Revision of {buildId}</label>
      <select
        id={selectId}
        data-testid="revision-select"
        value={known ? String(currentRevision) : ""}
        disabled={pending || ordered.length === 0}
        onChange={(e) => {
          const next = Number(e.target.value);
          if (Number.isInteger(next) && next !== currentRevision) onSelectRevision(next);
        }}
      >
        {!known && (
          <option value="" disabled>
            Revision {currentRevision} (not in list)
          </option>
        )}
        {ordered.map((r) => (
          <option key={r.revision} value={String(r.revision)}>
            {`Revision ${r.revision}`}
            {r.revision === latest ? " (latest)" : ""}
            {r.status ? ` · ${PLAN_STATUS_LABEL[r.status]}` : ""}
            {r.label ? ` · ${r.label}` : r.title ? ` · ${r.title}` : ""}
          </option>
        ))}
      </select>
      <p data-testid="revision-state" data-latest={currentRevision === latest ? "true" : "false"}>
        {pending
          ? "Loading revision…"
          : currentRevision === latest
            ? `Viewing latest revision (${currentRevision})`
            : `Viewing older revision ${currentRevision}; latest is ${latest ?? "unknown"}`}
      </p>
      {error && (
        <p role="alert" data-testid="revision-error">
          {error}
        </p>
      )}
    </section>
  );
}
