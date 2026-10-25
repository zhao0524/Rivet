'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useAppRouter } from '../system/Navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  createProjectRecord,
  getProject,
  newId,
  readDraft,
  saveProject,
  titleFromPrompt,
  useProjects,
  writeDraft,
} from '../../lib/flow/projects';
import { SAMPLE_PROJECTS, type SampleProject } from '../../lib/flow/samples';
import { projectPath } from '../../lib/flow/steps';
import { AppHeader } from '../flow/AppHeader';
import { useFlowStore } from '../flow/FlowProvider';
import { takePendingImage } from '../../lib/flow/pending-image';
import { PromptBox, type PromptBoxSubmit } from '../flow/PromptBox';
import { CardSkeletons, ProjectCard, SampleCard } from './gallery/ProjectCards';
import '../../styles/start.css';
import '../../styles/gallery.css';

/** How many of the user's own projects the gallery shows before "All projects". */
const RECENT_LIMIT = 6;

/**
 * A1 Prompt: the app's PromptBox with image attachment. Honors `?draft=<id>` (continue that draft)
 * and `?prompt=<text>` (prefill). Submitting creates the project under the draft id and moves on to
 * Clarify; coming back to the same draft updates the project instead of duplicating it.
 * Below the box, "Recent projects": the user's own projects (newest first), then tagged samples.
 */
export function NewProjectScreen() {
  const router = useAppRouter();
  const params = useSearchParams();
  const store = useFlowStore();
  const draftParam = params?.get('draft') || null;
  const promptParam = params?.get('prompt') || null;

  // The draft id the PromptBox should restore. Set after mount so a `?prompt=` seed is written
  // to the shared draft before the box reads it.
  const [seedId, setSeedId] = useState<string | null | undefined>(undefined);
  // A picture picked on the landing page for this draft (held in memory across the client-side hop).
  const [carriedImage, setCarriedImage] = useState<File | null>(null);
  const [boxKey, setBoxKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [focusTick, setFocusTick] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const projects = useProjects();
  const recent = useMemo(
    () => [...projects].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, RECENT_LIMIT),
    [projects],
  );

  // The stored list is only readable after mount; keep the gallery as skeletons until then.
  useEffect(() => {
    setMounted(true);
    setNow(Date.now());
  }, []);

  // After a sample fills the box (which remounts it), put the cursor at the end of the text.
  useEffect(() => {
    if (focusTick === 0) return;
    const input = document.querySelector<HTMLTextAreaElement>('[data-testid="new-prompt-input"]');
    if (!input) return;
    input.focus({ preventScroll: true });
    const end = input.value.length;
    input.setSelectionRange(end, end);
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    input.closest('form')?.scrollIntoView?.({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
  }, [focusTick]);

  useEffect(() => {
    if (promptParam) {
      const id = draftParam ?? readDraft()?.id ?? newId();
      writeDraft({ id, text: promptParam.slice(0, 2000) });
      setSeedId(id);
    } else {
      setSeedId(draftParam);
    }
    const carried = takePendingImage(draftParam);
    if (carried) setCarriedImage(carried);
  }, [draftParam, promptParam]);

  function fill(text: string) {
    const current = readDraft();
    const id = current?.id ?? seedId ?? newId();
    writeDraft({ id, text });
    setSeedId(id);
    setError(null);
    setBoxKey((k) => k + 1);
  }

  function pickSample(sample: SampleProject) {
    if (sample.action.kind === 'example') {
      const record = saveProject(
        createProjectRecord({
          prompt: sample.prompt,
          title: sample.action.projectTitle,
          exampleId: sample.action.exampleId,
          buildId: sample.action.buildId,
          phase: 'ready',
          furthestStep: 'review',
        }),
      );
      router.push(projectPath(record.id, 'review'));
      return;
    }
    fill(sample.prompt);
    setStatus(`Filled in the idea for “${sample.title}”. Change anything you like, then press Build it.`);
    setFocusTick((t) => t + 1);
  }

  async function submit({ draft, image }: PromptBoxSubmit) {
    setBusy(true);
    setError(null);
    let imageAssetId: string | null = null;
    let imagePreviewUrl: string | null = null;
    if (image) {
      try {
        const asset = await store.uploadImage(image);
        imageAssetId = asset.asset_id;
        imagePreviewUrl = asset.preview_url || null;
      } catch (err) {
        setError(err instanceof Error && err.message ? `The picture didn't upload: ${err.message}` : "The picture didn't upload. Try again, or build from the text alone.");
        setBusy(false);
        return;
      }
    }

    const prompt = draft.text.trim();
    const existing = getProject(draft.id);
    const title = prompt ? titleFromPrompt(prompt) : 'Robot from a picture';
    if (existing) {
      // Same draft, new submission: the prompt changed, so the reading must be redone.
      const keepTitle = existing.title !== titleFromPrompt(existing.prompt) && existing.title !== 'Robot from a picture';
      saveProject({
        ...existing,
        prompt,
        title: keepTitle ? existing.title : title,
        imageAssetId: imageAssetId ?? (image ? null : existing.imageAssetId),
        imagePreviewUrl: imagePreviewUrl ?? (image ? null : existing.imagePreviewUrl),
        phase: 'clarify',
        intentId: null,
        assumptions: [],
      });
    } else {
      saveProject(createProjectRecord({ id: draft.id, prompt, title, imageAssetId, imagePreviewUrl, phase: 'clarify' }));
    }
    writeDraft(null);
    router.push(projectPath(draft.id, 'clarify'));
  }

  return (
    <>
      <AppHeader />
      <main className="app-main" data-testid="new-screen">
        <div className="start-prompt">
          <div className="start-prompt__text">
            <h1 className="ui-h1">What do you want to build?</h1>
            <p className="ui-lede">Describe it in a sentence or two. A picture of a similar robot helps too.</p>
          </div>

          {seedId !== undefined ? (
            <PromptBox
              key={boxKey}
              allowImage
              autoFocus
              initialDraftId={seedId}
              initialImage={carriedImage}
              submitLabel="Build it"
              busy={busy}
              onSubmit={(value) => void submit(value)}
              testId="new-prompt"
              footer={
                error ? (
                  <p role="alert" className="ui-notice ui-notice--danger" style={{ margin: 0 }} data-testid="new-error">
                    {error}
                  </p>
                ) : busy ? (
                  <span aria-live="polite">Uploading your picture…</span>
                ) : null
              }
            />
          ) : (
            <div className="ui-skeleton" style={{ height: 112, borderRadius: 16 }} aria-hidden="true" />
          )}

          <p className="ui-sr-only" aria-live="polite" data-testid="new-status">
            {status}
          </p>
          <p className="ui-hint" style={{ marginTop: 12 }}>
            Want fully generated geometry with three design candidates? <a href="/design" data-testid="new-design-v2-link">Generate a 3D design</a>
          </p>
        </div>

        <section className="gal" aria-labelledby="new-gallery-title" data-testid="new-gallery">
          <div className="gal__head">
            <div>
              <h2 className="ui-h2" id="new-gallery-title">
                Recent projects
              </h2>
              <p className="gal__lede">
                {mounted && recent.length > 0 ? 'Pick up where you left off, or start from a sample idea.' : 'Start from a sample idea. Samples are examples, not your work.'}
              </p>
            </div>
            {mounted && projects.length > 0 ? (
              <Link href="/projects" className="ui-btn ui-btn--link" data-testid="new-all-projects">
                All projects
              </Link>
            ) : null}
          </div>
          <div className="gal__clip">
            <ul className="gal-grid" data-testid="new-gallery-list">
              {!mounted ? (
                <CardSkeletons count={4} />
              ) : (
                <>
                  {recent.map((p, i) => (
                    <li key={p.id} data-kind="project">
                      <ProjectCard project={p} now={now} index={i} testPrefix="new" />
                    </li>
                  ))}
                  {SAMPLE_PROJECTS.map((sample, i) => (
                    <li key={sample.id} data-kind="sample">
                      <SampleCard sample={sample} now={now} index={recent.length + i} onPress={pickSample} />
                    </li>
                  ))}
                </>
              )}
            </ul>
          </div>
        </section>
      </main>
    </>
  );
}
