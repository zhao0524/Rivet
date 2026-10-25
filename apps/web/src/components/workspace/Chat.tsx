'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import type { ChatEntry, ChatQuestion, ProjectRecord } from '../../lib/flow/projects';
import type { BuildPlan, StageEvent } from '../../lib/rivet/types';
import { presetsFor, type Preset } from '../steps/IterateModal';
import { Icon } from '../system/Icon';
import { Thinking } from '../system/Thinking';
import { eventSteps, eventsElapsedMs } from '../start/shared';
import { latestGeneration, type WorkspaceSession } from './session';

/**
 * Right side of the workspace: Rivet talking. It says what it read and what it built, and asks the
 * three questions (what to use, budget, size) with one-tap answers. The box at the bottom sends a
 * change to the build.
 */
export function Chat({
  project,
  session,
  plan,
  events,
  fixture,
}: {
  project: ProjectRecord;
  session: WorkspaceSession;
  plan: BuildPlan | null;
  events: readonly StageEvent[];
  fixture: boolean;
}) {
  const { chat, status } = session;
  const listRef = useRef<HTMLDivElement>(null);
  const lastId = chat.log[chat.log.length - 1]?.id;
  const latestGen = latestGeneration(chat);

  // Keep the newest message in view as the conversation grows.
  useEffect(() => {
    const el = listRef.current;
    el?.scrollTo?.({ top: el.scrollHeight, behavior: 'smooth' });
  }, [chat.log.length, lastId, status, events.length]);

  // When the list first gets a size (its tab opens on a phone) or is resized, start at the newest message.
  useEffect(() => {
    const el = listRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let height = el.clientHeight;
    const ro = new ResizeObserver(() => {
      if (el.clientHeight !== height) {
        height = el.clientHeight;
        el.scrollTop = el.scrollHeight;
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="ws-chat" data-testid="workspace-chat">
      <div className="ws-panel-head">
        <span className="ws-chat__agent">
          <span className="ws-chat__avatar" aria-hidden="true" />
          <span className="ws-panel-head__title">Rivet</span>
        </span>
        {status !== 'ready' ? (
          <span className="ws-chat__state" data-state={status}>
            {status === 'failed' ? 'Stopped' : 'Working'}
          </span>
        ) : null}
      </div>

      <div className="ws-chat__list" ref={listRef} role="log" aria-live="polite" aria-label="Conversation with Rivet">
        {chat.log.map((entry) => (
          <Entry
            key={entry.id}
            entry={entry}
            project={project}
            session={session}
            isLast={entry.id === lastId}
            isLatestGen={entry.kind === 'generation' && entry.id === latestGen?.id}
            events={events}
            fixture={fixture}
          />
        ))}
        {status === 'reading' && !chat.log.some((e) => e.kind === 'reading') ? (
          <Rivet testId="workspace-chat-reading">
            <Thinking title="Reading your idea" running steps={[]} replayable={false} testId="workspace-reading-thinking" />
          </Rivet>
        ) : null}
      </div>

      <Composer session={session} plan={status === 'ready' ? plan : null} />
    </div>
  );
}

function Rivet({ children, testId, tone }: { children: ReactNode; testId?: string; tone?: 'ok' | 'warn' | 'danger' }) {
  return (
    <div className="ws-msg ws-msg--rivet" data-tone={tone} data-testid={testId}>
      {children}
    </div>
  );
}

function User({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div className="ws-msg ws-msg--user" data-testid={testId}>
      <div className="ws-msg__bubble">{children}</div>
    </div>
  );
}

function Entry({
  entry,
  project,
  session,
  isLast,
  isLatestGen,
  events,
  fixture,
}: {
  entry: ChatEntry;
  project: ProjectRecord;
  session: WorkspaceSession;
  isLast: boolean;
  isLatestGen: boolean;
  events: readonly StageEvent[];
  fixture: boolean;
}) {
  switch (entry.kind) {
    case 'prompt':
      return (
        <User testId="workspace-chat-prompt">
          {project.imagePreviewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="ws-msg__image" src={project.imagePreviewUrl} alt="The picture you added" />
          ) : null}
          {project.prompt.trim() ? <p>{project.prompt.trim()}</p> : <p className="ws-msg__quiet">Build something like this picture.</p>}
        </User>
      );
    case 'reading': {
      const r = project.reading;
      if (!r) return null;
      return (
        <Rivet testId="workspace-chat-understood">
          <p className="ws-msg__eyebrow">{r.offline ? 'What Rivet will use' : 'What I read'}</p>
          <p className="ws-msg__lead">{r.headline}</p>
          {r.facts.length > 0 ? (
            <ul className="ws-msg__facts">
              {r.facts.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          ) : null}
          {r.offline ? (
            <p className="ws-note" data-testid="workspace-chat-offline">
              <Icon name="info" size={14} />
              <span>The live reader isn&apos;t connected, so I&apos;m using a rover that was saved earlier instead of your words.</span>
            </p>
          ) : null}
          {r.limitation ? (
            <p className="ws-note ws-note--warn" data-testid="workspace-chat-limitation">
              <Icon name="alert" size={14} />
              <span>{r.limitation}</span>
            </p>
          ) : null}
        </Rivet>
      );
    }
    case 'reading-error':
      return (
        <Rivet tone="danger" testId="workspace-chat-reading-error">
          <p>I couldn&apos;t read your idea.</p>
          <p className="ws-msg__quiet">{entry.message}</p>
          {isLast ? (
            <div className="ws-chips">
              <button type="button" className="ws-chip" onClick={session.retryReading} data-testid="workspace-reading-retry">
                Try again
              </button>
              <button type="button" className="ws-chip" onClick={session.skipReading}>
                Build it anyway
              </button>
            </div>
          ) : null}
        </Rivet>
      );
    case 'generation':
      return <Generation entry={entry} session={session} latest={isLatestGen} events={events} fixture={fixture} />;
    case 'question':
      return <Question question={entry.question} project={project} session={session} open={isLast && !session.chat.answered[entry.question]} />;
    case 'user':
      return <User>{entry.text}</User>;
    case 'rivet':
      return (
        <Rivet tone={entry.tone}>
          <p>{entry.text}</p>
          {entry.detail ? <p className="ws-msg__quiet">{entry.detail}</p> : null}
        </Rivet>
      );
    case 'wrap':
      return (
        <Rivet testId="workspace-chat-wrap">
          <p>That&apos;s everything I need. Turn the model around, or tell me what to change below.</p>
          <p className="ws-msg__quiet">
            When it looks right, follow the Build tab on the left from buying the parts to a finished robot. The Project tab lists every
            part, with where to buy it or the file to print it.
          </p>
        </Rivet>
      );
  }
}

function Generation({
  entry,
  session,
  latest,
  events,
  fixture,
}: {
  entry: Extract<ChatEntry, { kind: 'generation' }>;
  session: WorkspaceSession;
  latest: boolean;
  events: readonly StageEvent[];
  fixture: boolean;
}) {
  const live = latest && session.liveRun === entry.run && session.status === 'generating';
  const steps = useMemo(() => (latest && session.liveRun === entry.run ? eventSteps(events, { live, fixture }) : []), [latest, session.liveRun, entry.run, events, live, fixture]);
  const elapsed = useMemo(() => (latest && session.liveRun === entry.run ? eventsElapsedMs(events) : null), [latest, session.liveRun, entry.run, events]);

  if (entry.failed) {
    return (
      <Rivet tone="danger" testId="workspace-chat-failed">
        <p>I stopped before the build was finished.</p>
        <p className="ws-msg__quiet">{entry.failed}</p>
        {latest ? (
          <div className="ws-chips">
            <button type="button" className="ws-chip" onClick={session.retry} data-testid="workspace-chat-retry">
              {session.reread ? 'Read it again' : 'Try again'}
            </button>
          </div>
        ) : null}
      </Rivet>
    );
  }

  const s = entry.summary;
  return (
    <Rivet testId={s ? 'workspace-chat-built' : 'workspace-chat-building'}>
      {steps.length > 0 || (!s && latest) ? (
        <Thinking
          title="Building your robot"
          running={live}
          steps={steps}
          elapsedMs={elapsed}
          doneLabel={steps.length === 1 && fixture ? 'Loaded instantly' : undefined}
          waitingText={session.stageText}
          replayable={false}
          testId="workspace-gen-thinking"
        />
      ) : null}
      {s ? (
        <>
          <p className="ws-msg__eyebrow">{s.concept ? 'Concept model' : s.fixture ? 'Saved example' : 'Built'}</p>
          <p className="ws-msg__lead" data-testid="workspace-chat-title">
            {s.title}
          </p>
          <p className="ws-msg__stats">
            <span>{s.parts === 1 ? '1 part' : `${s.parts} parts`}</span>
            {s.total ? <span>{s.total}</span> : null}
          </p>
          <ul className="ws-msg__decisions">
            {s.decisions.map((d) => (
              <li key={d.text}>
                <Icon name="check" size={12} />
                <span>
                  {d.text}
                  {d.detail ? <span className="ws-msg__quiet"> {d.detail}</span> : null}
                </span>
              </li>
            ))}
          </ul>
          {s.fixture ? <p className="ws-msg__quiet">This is a saved example. Rivet didn&apos;t design it from your words.</p> : null}
        </>
      ) : !latest ? (
        <p className="ws-msg__quiet">Replaced by a newer build.</p>
      ) : null}
    </Rivet>
  );
}

/* ── Questions ── */

const QUESTION_TEXT: Record<ChatQuestion, { title: string; hint: string }> = {
  use: { title: 'What should Rivet use?', hint: "I can't fully engineer this kind of robot yet. Pick how to continue." },
  budget: { title: 'Do you have a budget?', hint: 'A limit tells me to leave out parts that would push the total over it.' },
  size: { title: 'Does it need to fit somewhere?', hint: 'A shelf, a box, a doorway. Give the longest side it can have.' },
};

function Question({ question, project, session, open }: { question: ChatQuestion; project: ProjectRecord; session: WorkspaceSession; open: boolean }) {
  const text = QUESTION_TEXT[question];
  const [custom, setCustom] = useState<string | null>(null);
  const number = custom !== null ? Number(custom) : NaN;
  const valid = Number.isFinite(number) && number > 0;

  function submitCustom(e: FormEvent) {
    e.preventDefault();
    if (valid) session.answer(question, question === 'size' ? Math.round(number) : number);
  }

  return (
    <Rivet testId={`workspace-question-${question}`}>
      <p className="ws-msg__lead">{text.title}</p>
      {open ? <p className="ws-msg__quiet">{text.hint}</p> : null}
      {open ? (
        <>
          <div className="ws-chips" role="group" aria-label={text.title}>
            {question === 'use' ? (
              <>
                <button type="button" className="ws-chip ws-chip--block" onClick={() => session.answer('use', 'concept_model')} data-testid="workspace-answer-concept">
                  <strong>Build a 3D model of this</strong>
                  <span>Its parts, with suggested real products. Fit and wiring aren&apos;t checked.</span>
                </button>
                <button
                  type="button"
                  className="ws-chip ws-chip--block"
                  onClick={() => session.answer('use', 'closest_supported_rover')}
                  data-testid="workspace-answer-rover"
                >
                  <strong>Use the closest supported rover</strong>
                  <span>Fully engineered: checked parts, wiring, simulation and code.</span>
                </button>
              </>
            ) : question === 'budget' ? (
              <>
                <Chip onClick={() => session.answer('budget', null)} testId="workspace-answer-budget-none" current={project.clarify.max_budget === null}>
                  No limit
                </Chip>
                <Chip onClick={() => session.answer('budget', 50)} testId="workspace-answer-budget-50">
                  Under $50
                </Chip>
                <Chip onClick={() => session.answer('budget', 100)} testId="workspace-answer-budget-100">
                  Under $100
                </Chip>
                <Chip onClick={() => setCustom('')} pressed={custom !== null} testId="workspace-answer-budget-custom">
                  Other amount
                </Chip>
              </>
            ) : (
              <>
                <Chip onClick={() => session.answer('size', null)} testId="workspace-answer-size-none" current={project.clarify.max_length_mm === null}>
                  No limit
                </Chip>
                <Chip onClick={() => setCustom('')} pressed={custom !== null} testId="workspace-answer-size-custom">
                  Set a maximum length
                </Chip>
              </>
            )}
          </div>
          {custom !== null ? (
            <form className="ws-inline-field" onSubmit={submitCustom}>
              {question === 'budget' ? <span aria-hidden="true">$</span> : null}
              <input
                className="ws-input"
                type="number"
                inputMode="decimal"
                min={1}
                placeholder={question === 'budget' ? '75' : '200'}
                aria-label={question === 'budget' ? 'Budget in US dollars' : 'Maximum length in millimetres'}
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                autoFocus
                data-testid={`workspace-answer-${question}-amount`}
              />
              <span className="ws-inline-field__unit">{question === 'budget' ? 'USD' : 'mm'}</span>
              <button type="submit" className="ws-btn ws-btn--primary ws-btn--sm" disabled={!valid} data-testid={`workspace-answer-${question}-set`}>
                Set
              </button>
            </form>
          ) : null}
        </>
      ) : null}
    </Rivet>
  );
}

function Chip({
  children,
  onClick,
  pressed,
  current,
  testId,
}: {
  children: ReactNode;
  onClick: () => void;
  pressed?: boolean;
  /** What the build already uses. */
  current?: boolean;
  testId?: string;
}) {
  return (
    <button type="button" className="ws-chip" aria-pressed={pressed} data-current={current || undefined} onClick={onClick} data-testid={testId}>
      {children}
    </button>
  );
}

/* ── Composer ── */

function Composer({ session, plan }: { session: WorkspaceSession; plan: BuildPlan | null }) {
  const [text, setText] = useState('');
  const [preset, setPreset] = useState<Preset | null>(null);
  const presets = useMemo(() => (plan ? presetsFor(plan) : []), [plan]);
  const ready = Boolean(plan);
  const pending = session.editPending;
  const canSend = ready && !pending && text.trim().length > 0;

  async function send() {
    if (!canSend) return;
    const value = text.trim();
    const operation = preset && preset.instruction === value ? preset.operation : undefined;
    setText('');
    setPreset(null);
    await session.send(value, operation);
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <div className="ws-composer">
      {presets.length > 0 ? (
        <div className="ws-suggest" role="group" aria-label="Changes Rivet can make">
          {presets.map((p) => (
            <button
              key={p.id}
              type="button"
              className="ws-suggest__item"
              onClick={() => {
                setPreset(p);
                setText(p.instruction);
              }}
              disabled={pending}
              data-testid="workspace-suggestion"
            >
              {p.label}
            </button>
          ))}
        </div>
      ) : null}
      <form
        className="ws-composer__box"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          className="ws-composer__input"
          rows={2}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (preset && e.target.value.trim() !== preset.instruction) setPreset(null);
          }}
          onKeyDown={onKey}
          placeholder={ready ? 'Ask Rivet to change something…' : 'Rivet is building. You can ask for changes once it’s done.'}
          disabled={!ready}
          aria-label="Message Rivet"
          data-testid="workspace-composer"
        />
        <div className="ws-composer__row">
          <span className="ws-composer__hint">{pending ? 'Rivet is re-checking the build…' : ready ? 'Enter to send' : ''}</span>
          <button type="submit" className="ws-send" disabled={!canSend} aria-label="Send" data-testid="workspace-send">
            {pending ? <span className="ws-spin" aria-hidden="true" /> : <Icon name="arrowRight" size={15} />}
          </button>
        </div>
      </form>
    </div>
  );
}
