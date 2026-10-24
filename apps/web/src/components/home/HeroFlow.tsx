'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent, type ReactNode } from 'react';
import {
  createProjectRecord,
  readAccount,
  saveAccount,
  saveProject,
  type Draft,
  type LocalAccount,
} from '../../lib/flow/projects';
import { projectPath } from '../../lib/flow/steps';
import { PromptBox } from '../flow/PromptBox';
import { Icon, type IconName } from '../system/Icon';
import { Modal } from '../system/Modal';

/** The sourced saved example every "See an example" link opens. */
export const EXAMPLE_ID = 'rivet-intent-rover-001';

/** Saves a ready example project and returns the route of its Review step. */
export function createExampleProject(): string {
  const record = saveProject(
    createProjectRecord({
      prompt: 'Indoor obstacle rover',
      title: 'Indoor obstacle rover (example)',
      exampleId: EXAMPLE_ID,
      buildId: EXAMPLE_ID,
      phase: 'ready',
    }),
  );
  return projectPath(record.id, 'review');
}

/** A button that opens the saved example in the app. Used by the hero, the paths and the showcase. */
export function ExampleButton({
  className = 'mk-textlink',
  children,
  testId,
}: {
  className?: string;
  children: ReactNode;
  testId?: string;
}) {
  const router = useRouter();
  return (
    <button type="button" className={className} data-testid={testId} onClick={() => router.push(createExampleProject())}>
      {children}
    </button>
  );
}

const DELIVERABLES: ReadonlyArray<{ icon: IconName; title: string; body: string }> = [
  { icon: 'cart', title: 'Parts list', body: 'Real catalog parts. Prices and vendors only where they were checked.' },
  { icon: 'bolt', title: 'Wiring and pin map', body: 'Each connection drawn on the 3D model and listed by pin.' },
  { icon: 'download', title: 'Starter firmware', body: 'An ESP32 PlatformIO project with your pin map filled in.' },
  { icon: 'check', title: 'Step-by-step build', body: 'The assembly order with safety notes on every step.' },
];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Landing hero flow (M1 → Guest preview → M2). The shared PromptBox keeps the draft in the
 * browser under a stable id; "Build it" previews what Rivet will make without generating
 * anything, "Save and continue" stores a local account (or skips when one exists) and hands
 * the draft id to the app prompt at `/new?draft=<id>`.
 */
export function HeroFlow() {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [stage, setStage] = useState<'idle' | 'preview' | 'save'>('idle');

  function openApp(draftId: string) {
    router.push(`/new?draft=${encodeURIComponent(draftId)}`);
  }

  function continueFromPreview() {
    if (!draft) return;
    if (readAccount()) openApp(draft.id);
    else setStage('save');
  }

  function saveAndContinue(account: LocalAccount) {
    if (!draft) return;
    saveAccount(account);
    openApp(draft.id);
  }

  return (
    <div className="mk-prompt">
      <PromptBox
        submitLabel="Build it"
        testId="home-prompt"
        onSubmit={({ draft: next }) => {
          setDraft(next);
          setStage('preview');
        }}
        footer={
          <>
            <span>
              No prompt in mind?{' '}
              <ExampleButton testId="home-see-example">See an example</ExampleButton>
            </span>
            <span className="mk-prompt__hint">
              Images are interpreted into a supported build, not reverse-engineered with certainty.
            </span>
          </>
        }
      />

      <GuestPreview
        open={stage === 'preview'}
        prompt={draft?.text ?? ''}
        onClose={() => setStage('idle')}
        onContinue={continueFromPreview}
      />
      <SaveModal open={stage === 'save'} onClose={() => setStage('preview')} onSave={saveAndContinue} />
    </div>
  );
}

/** Guest preview: what Rivet is about to make, before anything is generated. */
function GuestPreview({
  open,
  prompt,
  onClose,
  onContinue,
}: {
  open: boolean;
  prompt: string;
  onClose: () => void;
  onContinue: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Here is what Rivet will make"
      description="Nothing is generated yet. Save the project to continue in the app."
      testId="guest-preview"
      initialFocus="[data-testid='preview-continue']"
      footer={
        <button type="button" className="ui-btn ui-btn--primary" onClick={onContinue} data-testid="preview-continue">
          Save and continue
          <Icon name="arrowRight" />
        </button>
      }
    >
      <div className="mk-preview">
        <blockquote className="mk-preview__echo">
          <span>Your prompt</span>
          {prompt || 'A picture, no text'}
        </blockquote>

        <div className="mk-preview__frame">
          <span className="ui-badge ui-badge--ok">
            <Icon name="check" size={12} /> Rover · supported today
          </span>
          <span className="ui-small ui-muted">
            Rivet builds indoor rovers today. Your prompt is read as the closest supported rover, and you confirm the
            details before it generates.
          </span>
        </div>

        <div className="mk-preview__scene mk-mock__scene" aria-hidden="true">
          <span className="mk-mock__chassis" />
          <span className="mk-mock__wheel mk-mock__wheel--l" />
          <span className="mk-mock__wheel mk-mock__wheel--r" />
          <span className="mk-mock__board" />
        </div>

        <ul className="mk-preview__list" aria-label="What you get">
          {DELIVERABLES.map((d) => (
            <li key={d.title}>
              <span className="mk-preview__icon" aria-hidden="true">
                <Icon name={d.icon} />
              </span>
              <div>
                <strong>{d.title}</strong>
                <span>{d.body}</span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}

/** M2 Save your project. Hackathon scope: both paths store a local account; nothing is sent. */
function SaveModal({
  open,
  onClose,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (account: LocalAccount) => void;
}) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submitEmail(e: FormEvent) {
    e.preventDefault();
    const value = email.trim();
    if (!EMAIL.test(value)) {
      setError('Enter an email address like you@school.edu.');
      return;
    }
    onSave({ email: value, provider: 'email', savedAt: new Date().toISOString() });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Save your project"
      description="So you can come back to it and share it."
      testId="save-modal"
    >
      <form className="mk-save" onSubmit={submitEmail} noValidate>
        <div className="ui-field">
          <label htmlFor="save-email" className="ui-label">
            Email
          </label>
          <input
            id="save-email"
            className="ui-input"
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder="you@school.edu"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError(null);
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'save-email-err' : undefined}
            data-testid="save-email"
          />
          {error ? (
            <p id="save-email-err" role="alert" className="mk-save__error">
              {error}
            </p>
          ) : null}
        </div>
        <button type="submit" className="ui-btn ui-btn--primary ui-btn--block" data-testid="save-continue-email">
          Continue with email
        </button>
        <div className="mk-save__or" aria-hidden="true">
          or
        </div>
        <button
          type="button"
          className="ui-btn ui-btn--secondary ui-btn--block"
          data-testid="save-continue-google"
          onClick={() => onSave({ email: 'Google account', provider: 'google', savedAt: new Date().toISOString() })}
        >
          Continue with Google
        </button>
        <p className="mk-save__note">
          <Icon name="info" />
          <span>
            Hackathon build: the project is saved in this browser only. Accounts are not live yet, so no email is sent
            and nothing leaves this device.
          </span>
        </p>
      </form>
    </Modal>
  );
}
