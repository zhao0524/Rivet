'use client';

import { useEffect, useId, useRef, useState, type FormEvent, type PointerEvent, type ReactNode } from 'react';
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
  placeholder?: string;
  /** Starter prompts shown as chips above the field; clicking one fills it in. */
  examples?: ReadonlyArray<string>;
  /** A picture to start with, e.g. one picked on the landing page for this draft. */
  initialImage?: File | null;
}

const MAX_CHARS = 2000;

/* Bencho "Edge light" on the field, as on the gallery cards (gallery.css): the rim arc facing
   the pointer lights up once the pointer is past EDGE of the way from the middle to the edge
   (the 1px border past EDGE + 20). The light's hue follows the angle, orange toward the
   bottom left and lavender toward the top right. No lean: the field holds still for typing. */
const EDGE = 40;

const ramp = (near: number, from: number) => Math.max(0, (near * 100 - from) / (100 - from));

function lightField(el: HTMLElement, e: PointerEvent<HTMLElement>) {
  const r = el.getBoundingClientRect();
  const cx = r.width / 2;
  const cy = r.height / 2;
  const dx = e.clientX - r.left - cx;
  const dy = e.clientY - r.top - cy;
  const kx = dx ? cx / Math.abs(dx) : Infinity;
  const ky = dy ? cy / Math.abs(dy) : Infinity;
  const near = Math.min(Math.max(1 / Math.min(kx, ky), 0), 1);
  let angle = dx || dy ? (Math.atan2(dy, dx) * 180) / Math.PI + 90 : 0;
  if (angle < 0) angle += 360;
  // 0 at the bottom-left corner (225deg), 1 at the top-right (45deg).
  const lav = (1 + Math.cos(((angle - 45) * Math.PI) / 180)) / 2;
  el.style.setProperty('--pb-a', `${angle.toFixed(2)}deg`);
  el.style.setProperty('--pb-lav', `${(lav * 100).toFixed(1)}%`);
  el.style.setProperty('--pb-glow', ramp(near, EDGE).toFixed(3));
  el.style.setProperty('--pb-rim', ramp(near, Math.min(95, EDGE + 20)).toFixed(3));
}

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
  placeholder = 'Describe a robot in a sentence or two…',
  examples,
  initialImage = null,
}: PromptBoxProps) {
  const inputId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const [lit, setLit] = useState(false);
  const [draft, setDraft] = useState<Draft>({ id: initialDraftId ?? '', text: '' });
  const [image, setImage] = useState<File | null>(initialImage);
  useEffect(() => {
    if (initialImage) setImage(initialImage);
  }, [initialImage]);
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
      {examples?.length ? (
        <div className="pb__examples" role="group" aria-label="Example prompts">
          {examples.map((text) => (
            <button key={text} type="button" className="ui-chip pb__example" onClick={() => change(text)}>
              {text}
            </button>
          ))}
        </div>
      ) : null}
      <div
        ref={fieldRef}
        className="pb__field"
        data-lit={lit ? 'true' : 'false'}
        onPointerEnter={(e) => {
          if (e.pointerType === 'touch' || !fieldRef.current) return;
          setLit(true);
          lightField(fieldRef.current, e);
        }}
        onPointerMove={(e) => {
          if (e.pointerType === 'touch' || !fieldRef.current) return;
          lightField(fieldRef.current, e);
        }}
        onPointerLeave={() => setLit(false)}
      >
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
          placeholder={placeholder}
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
                aria-label="Attach a picture"
                onChange={(e) => {
                  setImage(e.target.files?.[0] ?? null);
                  setError(null);
                }}
                data-testid={`${testId}-file`}
              />
              <div className="pb__attach">
                <button
                  type="button"
                  className="ui-btn ui-btn--secondary ui-btn--sm pb__upload"
                  onClick={() => fileRef.current?.click()}
                  data-testid={`${testId}-upload`}
                >
                  <Icon name="image" />
                  <span className="pb__upload-label">{image ? image.name : 'Upload a picture'}</span>
                </button>
                {image ? (
                  <button
                    type="button"
                    className="ui-btn ui-btn--ghost ui-btn--sm"
                    onClick={() => {
                      setImage(null);
                      if (fileRef.current) fileRef.current.value = '';
                    }}
                  >
                    Remove
                  </button>
                ) : null}
              </div>
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
            {submitLabel}
            {busy ? <span className="ui-spinner" aria-hidden="true" /> : <Icon name="arrowRight" />}
          </button>
        </div>
        <span className="pb__rim" aria-hidden="true" />
        <span className="pb__glow" aria-hidden="true">
          <span />
        </span>
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
