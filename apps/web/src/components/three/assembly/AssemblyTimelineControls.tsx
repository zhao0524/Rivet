'use client';

import type { ChangeEvent } from 'react';

export interface AssemblyTimelineStepLabel {
  /** Timeline index, 1..stepCount. */
  readonly index: number;
  readonly title: string;
}

export interface AssemblyTimelineControlsProps {
  readonly stepCount: number;
  /** Continuous scrub position in [0, stepCount]; see `scrubToStep`. */
  readonly position: number;
  readonly playing: boolean;
  /** Explode amount in [0, 1]. Omit to hide the explode slider. */
  readonly explode?: number;
  readonly steps?: readonly AssemblyTimelineStepLabel[];
  readonly disabled?: boolean;
  readonly className?: string;
  readonly onPlay: () => void;
  readonly onPause: () => void;
  readonly onNext: () => void;
  readonly onBack: () => void;
  readonly onScrub: (position: number) => void;
  readonly onExplodeChange?: (explode: number) => void;
  /** Return to the intact assembly. Omit to hide the button. */
  readonly onReset?: () => void;
}

/**
 * Unstyled, controlled timeline controls. Holds no state: every interaction is
 * emitted through a callback. Style via `className` and `data-part` hooks.
 */
export function AssemblyTimelineControls({
  stepCount,
  position,
  playing,
  explode,
  steps,
  disabled = false,
  className,
  onPlay,
  onPause,
  onNext,
  onBack,
  onScrub,
  onExplodeChange,
  onReset,
}: AssemblyTimelineControlsProps) {
  const count = Math.max(0, Math.trunc(stepCount) || 0);
  const pos = Math.min(Math.max(Number.isFinite(position) ? position : 0, 0), count);
  const stepIndex = pos <= 0 ? 0 : Math.ceil(pos - 1e-9);
  const title = steps?.find((s) => s.index === stepIndex)?.title;
  const label =
    stepIndex === 0 ? `Prep · 0 of ${count}` : `Step ${stepIndex} of ${count}${title ? ` · ${title}` : ''}`;
  const noSteps = disabled || count === 0;

  return (
    <div className={className} data-part="assembly-timeline" role="group" aria-label="Assembly timeline">
      <button type="button" data-part="back" onClick={onBack} disabled={noSteps || pos <= 0} aria-label="Previous step">
        Back
      </button>
      {playing ? (
        <button type="button" data-part="pause" onClick={onPause} disabled={disabled} aria-label="Pause">
          Pause
        </button>
      ) : (
        <button type="button" data-part="play" onClick={onPlay} disabled={noSteps} aria-label="Play">
          Play
        </button>
      )}
      <button type="button" data-part="next" onClick={onNext} disabled={noSteps || pos >= count} aria-label="Next step">
        Next
      </button>
      <input
        type="range"
        data-part="scrub"
        aria-label="Assembly step"
        aria-valuetext={label}
        min={0}
        max={count}
        step={0.01}
        value={pos}
        disabled={noSteps}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onScrub(Number(e.currentTarget.value))}
      />
      <output data-part="step-label" aria-live="polite">
        {label}
      </output>
      {explode !== undefined && onExplodeChange ? (
        <input
          type="range"
          data-part="explode"
          aria-label="Explode"
          min={0}
          max={1}
          step={0.01}
          value={Math.min(Math.max(explode, 0), 1)}
          disabled={disabled}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onExplodeChange(Number(e.currentTarget.value))}
        />
      ) : null}
      {onReset ? (
        <button type="button" data-part="reset" onClick={onReset} disabled={disabled}>
          Full assembly
        </button>
      ) : null}
    </div>
  );
}
