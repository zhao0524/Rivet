'use client';

import { useAppRouter } from '../system/Navigation';
import { useState, type FormEvent, type ReactNode } from 'react';
import {
  createProjectRecord,
  readAccount,
  saveAccount,
  saveProject,
  submitDraftProject,
  writeDraft,
  type Draft,
  type LocalAccount,
} from '../../lib/flow/projects';
import { setPendingImage } from '../../lib/flow/pending-image';
import { projectPath } from '../../lib/flow/steps';
import { PromptBox } from '../flow/PromptBox';
import { Icon } from '../system/Icon';
import { Modal } from '../system/Modal';

/** The sourced saved example every "See an example" link opens. */
export const EXAMPLE_ID = 'rivet-intent-rover-001';

/** Saves a ready example project and returns the route of its workspace. */
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
  return projectPath(record.id, 'workspace');
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
  const router = useAppRouter();
  return (
    <button type="button" className={className} data-testid={testId} onClick={() => router.push(createExampleProject())}>
      {children}
    </button>
  );
}

/** Starter prompts, from a first robot to an ambitious one. Short enough to share one row. */
const EXAMPLE_PROMPTS = [
  'A robot car that avoids walls',
  'Help me build a drone from scratch',
] as const;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Landing hero flow. "Build it" opens the project's workspace straight away, where Rivet reads the
 * idea and builds it. Someone not signed in signs in first (M2), then lands in the same workspace; the
 * prompt and picture carry over, so nothing is typed twice.
 */
export function HeroFlow() {
  const router = useAppRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [signIn, setSignIn] = useState(false);

  function openWorkspace(next: Draft) {
    // The picture, if any, waits in memory (pending-image) and is uploaded by the workspace.
    submitDraftProject({ id: next.id, prompt: next.text, image: { assetId: null, previewUrl: null } });
    writeDraft(null);
    router.push(projectPath(next.id, 'workspace'));
  }

  function signedIn(account: LocalAccount) {
    saveAccount(account);
    setSignIn(false);
    if (draft) openWorkspace(draft);
  }

  return (
    <div className="mk-prompt">
      <PromptBox
        submitLabel="Build it"
        testId="home-prompt"
        placeholder="Describe a hardware project in a sentence or two…"
        examples={EXAMPLE_PROMPTS}
        allowImage
        onSubmit={({ draft: next, image }) => {
          setPendingImage(next.id, image);
          setDraft(next);
          if (readAccount()) openWorkspace(next);
          else setSignIn(true);
        }}
      />
      <SaveModal open={signIn} onClose={() => setSignIn(false)} onSave={signedIn} />
    </div>
  );
}

/** M2 Sign in before the first build. Hackathon scope: both paths store a local account; nothing is sent. */
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
      title="Sign in to build"
      description="Rivet saves the project to your account, then opens it in the workspace."
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
