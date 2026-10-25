'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from './Icon';
import '../../styles/thinking.css';

/** One real step of work. Callers pass only steps that actually happened. */
export interface ThinkingStep {
  id: string;
  text: string;
  /** Muted second line, e.g. the engine's own message without ids. */
  detail?: string;
  status?: 'running' | 'done' | 'warning' | 'failed';
}

export interface ThinkingProps {
  /** The shimmering word while it works. Default "Thinking". */
  title?: string;
  running: boolean;
  steps: readonly ThinkingStep[];
  /** Real time the work took; shown as "Thought for 4s" once done. */
  elapsedMs?: number | null;
  /** Replaces the "Thought for Ns" line once done (e.g. "Loaded instantly"). */
  doneLabel?: string;
  /** Called when Replay is pressed; the recorded steps replay either way. */
  onReplay?: () => void;
  /** Show the Replay pill once done. Default: when there is more than one step. */
  replayable?: boolean;
  defaultOpen?: boolean;
  /** Fold into one line when done. Never folds while a step failed. Default true. */
  foldWhenDone?: boolean;
  /** Shown under the title while running with no steps yet. */
  waitingText?: string;
  testId?: string;
}

const STATUS_TEXT: Record<NonNullable<ThinkingStep['status']>, string | null> = {
  running: null,
  done: null,
  warning: 'Needs a look',
  failed: "Didn't work",
};

/** "0.4s", "12s", "2m 5s". */
export function formatElapsed(ms: number): string {
  if (ms < 1000) return `${Math.max(0.1, ms / 1000).toFixed(1)}s`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const REPLAY_PACE_MS = 450;
const FOLD_DELAY_MS = 700;

/**
 * A trace of work as it happens (adapted from Bencho's Thinking): the title shimmers while
 * running, steps hang on a dotted thread with the newest lit, and when it is done the trace
 * folds into one line ("Thought for 4s") that opens it again. Replay re-shows the same recorded
 * steps one at a time; it never adds any.
 */
export function Thinking({
  title = 'Thinking',
  running,
  steps,
  elapsedMs = null,
  doneLabel,
  onReplay,
  replayable,
  defaultOpen,
  foldWhenDone = true,
  waitingText,
  testId,
}: ThinkingProps) {
  const [open, setOpen] = useState(defaultOpen ?? running);
  const [replayShown, setReplayShown] = useState<number | null>(null);
  const bodyId = useId();
  const anyFailed = steps.some((s) => s.status === 'failed');
  const wasRunning = useRef(running);

  // Running opens the trace; finishing folds it after a beat, unless something failed.
  useEffect(() => {
    if (running) {
      wasRunning.current = true;
      setOpen(true);
      return;
    }
    if (!wasRunning.current) return;
    wasRunning.current = false;
    if (anyFailed || !foldWhenDone) {
      setOpen(true);
      return;
    }
    const t = window.setTimeout(() => setOpen(false), FOLD_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [running, anyFailed, foldWhenDone]);

  // A failure that arrives after the fold opens the trace again.
  useEffect(() => {
    if (anyFailed) setOpen(true);
  }, [anyFailed]);

  // Replay: the recorded steps again, one at a time.
  useEffect(() => {
    if (replayShown === null) return;
    if (replayShown >= steps.length) {
      setReplayShown(null);
      return;
    }
    const t = window.setTimeout(() => setReplayShown((n) => (n === null ? null : n + 1)), REPLAY_PACE_MS);
    return () => window.clearTimeout(t);
  }, [replayShown, steps.length]);

  function replay() {
    onReplay?.();
    setOpen(true);
    setReplayShown(prefersReducedMotion() ? null : 0);
  }

  const replaying = replayShown !== null;
  const busy = running || replaying;
  const visible = replaying ? steps.slice(0, replayShown) : steps;
  const label = running
    ? title
    : replaying
      ? 'Replaying what happened'
      : doneLabel ?? (elapsedMs !== null && elapsedMs !== undefined ? `Thought for ${formatElapsed(elapsedMs)}` : 'Done');
  const canReplay = !running && steps.length > 0 && (replayable ?? steps.length > 1);
  const newest = steps[steps.length - 1];

  return (
    <div className="thk" data-thinking={busy || undefined} data-testid={testId}>
      <div className="thk__head">
        <button type="button" className="thk__title" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={bodyId} data-testid={testId ? `${testId}-toggle` : undefined}>
          <span className="thk__word" data-testid={testId ? `${testId}-label` : undefined}>
            {label}
          </span>
          <Icon name="chevronRight" size={14} className="thk__chev" data-open={open || undefined} />
        </button>
      </div>
      {running && steps.length === 0 && waitingText ? <p className="thk__wait">{waitingText}</p> : null}
      <div id={bodyId} className="thk__body" data-open={open || undefined} aria-hidden={!open || undefined}>
        <div className="thk__clip">
          <ol className="thk__steps" data-testid={testId ? `${testId}-steps` : undefined}>
            {visible.map((s, i) => {
              const now = busy && i === visible.length - 1;
              const marker = s.status ? STATUS_TEXT[s.status] : null;
              return (
                <li key={replaying ? `r-${s.id}` : s.id} data-now={now || undefined} data-status={s.status}>
                  <span className="thk__text">
                    {s.text}
                    {marker ? (
                      <span className="thk__flag" data-status={s.status}>
                        <Icon name="alert" size={12} />
                        {marker}
                      </span>
                    ) : null}
                  </span>
                  {s.detail ? <span className="thk__detail">{s.detail}</span> : null}
                </li>
              );
            })}
          </ol>
        </div>
      </div>
      {canReplay ? (
        <button type="button" className="thk__again" data-on={!replaying || undefined} onClick={replay} disabled={replaying} data-testid={testId ? `${testId}-replay` : undefined}>
          <Icon name="replay" size={14} />
          Replay
        </button>
      ) : null}
      {/* New real steps are announced once; replays stay quiet. */}
      <span className="ui-sr-only" aria-live="polite">
        {running && newest ? `${newest.text}${newest.status && STATUS_TEXT[newest.status] ? `: ${STATUS_TEXT[newest.status]}` : ''}` : !running && steps.length > 0 ? label : ''}
      </span>
    </div>
  );
}
