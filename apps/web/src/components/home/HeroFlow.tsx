'use client';

import { useAppRouter } from '../system/Navigation';
import { useState, type ReactNode } from 'react';
import {
  createProjectRecord,
  saveProject,
  type Draft,
} from '../../lib/flow/projects';
import { setPendingImage } from '../../lib/flow/pending-image';
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
  const router = useAppRouter();
  return (
    <button type="button" className={className} data-testid={testId} onClick={() => router.push(createExampleProject())}>
      {children}
    </button>
  );
}

const DELIVERABLES: ReadonlyArray<{ icon: IconName; title: string; body: string }> = [
  { icon: 'cart', title: 'Parts list', body: 'Real parts. Prices and stores only where Rivet checked them.' },
  { icon: 'bolt', title: 'Wiring', body: 'Every wire drawn on the 3D model, with the pin it plugs into.' },
  { icon: 'download', title: 'Starter code', body: 'Code for the ESP32 controller board with your wiring already filled in.' },
  { icon: 'check', title: 'Step-by-step build', body: 'The order to put it together, with safety notes on every step.' },
];

/** Starter prompts, from a first robot to an ambitious one. Short enough to share one row. */
const EXAMPLE_PROMPTS = [
  'A robot car that avoids walls',
  'Help me build a drone from scratch',
] as const;

/**
 * The shared PromptBox keeps the draft in the
 * browser under a stable id; "Build it" previews what Rivet will make without generating
 * anything, then hands the draft to `/new?draft=<id>`. No account is needed for local projects.
 */
export function HeroFlow() {
  const router = useAppRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [stage, setStage] = useState<'idle' | 'preview'>('idle');

  function openApp(draftId: string) {
    router.push(`/new?draft=${encodeURIComponent(draftId)}`);
  }

  function continueFromPreview() {
    if (!draft) return;
    openApp(draft.id);
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
          setStage('preview');
        }}
      />

      <GuestPreview
        open={stage === 'preview'}
        prompt={draft?.text ?? ''}
        onClose={() => setStage('idle')}
        onContinue={continueFromPreview}
      />
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
      description="Nothing is generated yet. Continue to confirm the request. Your project is saved in this browser."
      testId="guest-preview"
      initialFocus="[data-testid='preview-continue']"
      footer={
        <button type="button" className="ui-btn ui-btn--primary" onClick={onContinue} data-testid="preview-continue">
          Continue to build
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
            Rivet builds indoor rovers today. It matches your idea to the closest rover it can make, and you confirm
            the details before it starts designing.
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
