'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  createProjectRecord,
  getProject,
  newId,
  readDraft,
  saveProject,
  titleFromPrompt,
  writeDraft,
} from '../../lib/flow/projects';
import { projectPath } from '../../lib/flow/steps';
import { AppHeader } from '../flow/AppHeader';
import { useFlowStore } from '../flow/FlowProvider';
import { PromptBox, SAMPLE_PROMPTS, type PromptBoxSubmit } from '../flow/PromptBox';
import '../../styles/start.css';

/**
 * A1 Prompt: the app's PromptBox with image attachment. Honors `?draft=<id>` (continue that draft)
 * and `?prompt=<text>` (prefill). Submitting creates the project under the draft id and moves on to
 * Clarify; coming back to the same draft updates the project instead of duplicating it.
 */
export function NewProjectScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const store = useFlowStore();
  const draftParam = params?.get('draft') || null;
  const promptParam = params?.get('prompt') || null;

  // The draft id the PromptBox should restore. Set after mount so a `?prompt=` seed is written
  // to the shared draft before the box reads it.
  const [seedId, setSeedId] = useState<string | null | undefined>(undefined);
  const [boxKey, setBoxKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (promptParam) {
      const id = draftParam ?? readDraft()?.id ?? newId();
      writeDraft({ id, text: promptParam.slice(0, 2000) });
      setSeedId(id);
    } else {
      setSeedId(draftParam);
    }
  }, [draftParam, promptParam]);

  function fill(text: string) {
    const current = readDraft();
    const id = current?.id ?? seedId ?? newId();
    writeDraft({ id, text });
    setSeedId(id);
    setError(null);
    setBoxKey((k) => k + 1);
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

          <div className="start-prompt__chips" aria-label="Sample prompts">
            {SAMPLE_PROMPTS.map((sample) => (
              <button key={sample} type="button" className="ui-chip" onClick={() => fill(sample)} data-testid="new-sample">
                {sample}
              </button>
            ))}
          </div>
          <p className="ui-hint" style={{ marginTop: 12 }}>
            Want fully generated geometry with three design candidates? <a href="/design" data-testid="new-design-v2-link">Generate a 3D design</a>
          </p>
        </div>
      </main>
    </>
  );
}
