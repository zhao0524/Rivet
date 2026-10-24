'use client';

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { newId, readDraft, writeDraft, type Draft } from '../../lib/flow/projects';
import { Icon } from '../system/Icon';

export const SAMPLE_PROMPTS = [
  'Build a small rover that avoids obstacles',
  'A two-wheel ESP32 robot that stops 40 cm from a wall',
  'A cheap indoor rover with a distance sensor on the front',
  'An obstacle-avoiding robot I can build on my desk this weekend',
] as const;

export interface PromptBoxSubmit {
  draft: Draft;
  image: File | null;
}

export interface PromptBoxProps {
  onSubmit: (value: PromptBoxSubmit) => void;
  /** Offer an image attachment (app prompt only). */
  allowImage?: boolean;
  /** Start from this draft instead of the stored one (e.g. `?draft=` after saving). */
  initialDraftId?: string | null;
  submitLabel?: string;
  busy?: boolean;
  /** Rendered under the field, e.g. "See an example". */
  footer?: ReactNode;
  autoFocus?: boolean;
  testId?: string;
}

const MAX_CHARS = 2000;

/**
 * The one prompt component, shared by the marketing hero and the app. Text is kept in a single
 * browser draft (`rivet.draft.v1`) with a stable draft id, so a prompt typed on the landing page
 * is still there, under the same id, when the app opens.
 */
export function PromptBox({
  onSubmit,
  allowImage = false,
  initialDraftId = null,
  submitLabel = 'Build it',
  busy = false,
  footer,
  autoFocus = false,
  testId = 'prompt-box',
}: PromptBoxProps) {
  const inputId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<Draft>({ id: initialDraftId ?? '', text: '' });
  const [image, setImage] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Restore after mount so server and client markup agree.
  useEffect(() => {
    const stored = readDraft();
    if (stored && (!initialDraftId || stored.id === initialDraftId)) setDraft(stored);
    else setDraft({ id: initialDraftId ?? newId(), text: '' });
  }, [initialDraftId]);

  function change(text: string) {
    const next = { id: draft.id || newId(), text: text.slice(0, MAX_CHARS) };
    setDraft(next);
    setError(null);
    writeDraft(next);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!draft.text.trim() && !image) {
      setError('Describe what you want to build, or attach a picture.');
      return;
    }
    const final = { id: draft.id || newId(), text: draft.text.trim() };
    writeDraft(final);
    onSubmit({ draft: final, image });
  }

  return (
    <form className="pb" onSubmit={submit} data-testid={testId} noValidate>
      <label htmlFor={inputId} className="ui-sr-only">
        Describe what you want to build
      </label>
      <div className="pb__field">
        <textarea
          id={inputId}
          className="pb__input"
          value={draft.text}
          onChange={(e) => change(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder="Describe a robot in a sentence or two…"
          rows={2}
          maxLength={MAX_CHARS}
          autoFocus={autoFocus}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-err` : undefined}
          data-testid={`${testId}-input`}
        />
        <div className="pb__bar">
          {allowImage ? (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="ui-sr-only"
                tabIndex={-1}
                onChange={(e) => {
                  setImage(e.target.files?.[0] ?? null);
                  setError(null);
                }}
                data-testid={`${testId}-file`}
              />
              <button type="button" className="ui-chip" onClick={() => fileRef.current?.click()}>
                <Icon name="image" />
                {image ? image.name : 'Attach a picture'}
              </button>
              {image ? (
                <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => setImage(null)}>
                  Remove
                </button>
              ) : null}
            </>
          ) : (
            <span />
          )}
          <button
            type="submit"
            className="ui-btn ui-btn--primary pb__go"
            disabled={busy}
            data-testid={`${testId}-submit`}
          >
            {busy ? <span className="ui-spinner" aria-hidden="true" /> : <Icon name="sparkle" />}
            {submitLabel}
          </button>
        </div>
      </div>
      {error ? (
        <p id={`${inputId}-err`} role="alert" className="pb__error">
          {error}
        </p>
      ) : null}
      {footer ? <div className="pb__foot">{footer}</div> : null}
    </form>
  );
}
