# Studio intake (C10)

Neutral, prop-driven intake and job-progress components. They import nothing from
`src/lib/**`; the page wires them to `FixtureSource` / `HttpSource` once those land.

| Component | Purpose |
|---|---|
| `BuildIntake` | Image + optional prompt + optional max budget → `onUpload(file)` then `onGenerate(request)`. Embeds `GenerationStatus` when `job` is set and `SavedExampleLauncher` when `savedExamples` + `onLoadSavedExample` are set. |
| `ImageDropzone` | Drag/drop or picker, client-side type/size check (PNG/JPEG/WebP, 10 MB), local object-URL preview. Never uploads. |
| `GenerationStatus` | Renders backend `job` + `events` only: stage list (contract order), event log sorted by `event_id` and de-duplicated, backend error, cancel/retry. |
| `SavedExampleLauncher` | Opens a saved fixture synchronously, labeled `Saved synthetic example — not supplier verified`. No progress or stage replay. |

## Wiring

```tsx
<BuildIntake
  onUpload={(file, { signal }) => source.uploadImage(file, { signal })} // POST /api/assets/images
  onGenerate={async (req) => setJobId((await source.generate(req)).job_id)} // POST /api/projects/generate
  job={job}            // GET /api/jobs/{id}
  events={events}      // SSE /api/jobs/{id}/events, or accumulated from polling
  onCancelJob={(id) => stopFollowing(id)}
  savedExamples={examples} // GET /api/projects/examples → .examples
  onLoadSavedExample={(id) => openFixture(id)}
  loadedExampleId={openExampleId}
/>
```

## Behavior notes

- Upload happens only when the user presses Generate; a successful asset id is reused on retry.
- Cancel aborts an in-flight upload via `AbortSignal`, or calls `onCancelJob` for a running job. The API has no cancel endpoint, so a canceled job is shown as "no longer followed", never as complete.
- Retry resubmits the last `GenerateRequest`. It is hidden when the backend error has `retryable: false`.
- Stages without events show "Not reported". A progress bar appears only if the backend sends `progress` (a 0–1 fraction, per `services/api` `Job.progress`).
- `max_budget` is `null` when the budget field is empty.
- Styling uses the shared `.rv-*` classes in `src/styles/globals.css` plus `data-rivet` hooks for the designer.
- Layout (#53): image drop zone, then "What should it do?" with a `SAMPLE_PROMPT` quick-fill chip, then Generate; the budget sits in a collapsed "Constraints" disclosure. Saved examples render as cards (status badge, `Open <title>` button, disclosure line) below the form.
- The studio shows `BuildIntake` in a modal `Dialog` opened only from the header "New build" button; it closes when a saved example opens or the generated build is on screen.

## Types

`types.ts` mirrors `docs/implementation.md` §3.5. Replace with `src/lib/contracts.ts` once it exists.
`SavedExampleSummary` follows `services/api` `FixtureAdapter.describe()` (`example_id`, `title`, `project_family`, `status`, `generation_mode`).

## Tests

`__tests__/*.test.tsx` use Vitest + jsdom + `@testing-library/react` + `@testing-library/user-event`.
`apps/web` will need these as dev dependencies.
