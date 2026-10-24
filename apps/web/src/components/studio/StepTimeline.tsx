'use client';

import { useEffect } from 'react';
import type { BuildPlan } from '../../lib/rivet/types';
import {
  AssemblyTimelineControls,
  advancePlayback,
  nextStepPosition,
  previousStepPosition,
  scrubToStep,
  type AssemblyMode,
} from '../three/assembly';

export interface StepTimelineProps {
  plan: BuildPlan;
  assemblyMode: AssemblyMode;
  scrubPosition: number;
  playing: boolean;
  explodeAmount: number;
  ghostFutureSteps: boolean;
  selectedInstanceId: string | null;
  onScrubChange: (position: number) => void;
  onPlayingChange: (playing: boolean) => void;
  onExplodeChange: (explode: number) => void;
  onGhostFutureChange: (ghost: boolean) => void;
  onResetToFullAssembly: () => void;
  onSelectInstance: (instanceId: string) => void;
}

export function StepTimeline({
  plan,
  assemblyMode,
  scrubPosition,
  playing,
  explodeAmount,
  ghostFutureSteps,
  selectedInstanceId,
  onScrubChange,
  onPlayingChange,
  onExplodeChange,
  onGhostFutureChange,
  onResetToFullAssembly,
  onSelectInstance,
}: StepTimelineProps) {
  const steps = plan.assembly_steps;
  const stepCount = steps.length;
  const { step: activeStepIndex } = scrubToStep(scrubPosition, stepCount);
  const currentStep = activeStepIndex > 0 ? steps[activeStepIndex - 1] ?? null : null;

  useEffect(() => {
    if (!playing || stepCount === 0) return;
    let rafId = 0;
    let lastNow: number | null = null;
    let pos = scrubPosition >= stepCount ? 0 : scrubPosition;

    const tick = (now: number) => {
      if (lastNow !== null) {
        const dtMs = Math.min(now - lastNow, 100);
        const next = advancePlayback({ position: pos, playing: true }, dtMs, {
          stepCount,
          stepDurationMs: 1100,
        });
        pos = next.position;
        onScrubChange(next.position);
        if (!next.playing) {
          onPlayingChange(false);
          return;
        }
      }
      lastNow = now;
      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(rafId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, stepCount]);

  const stepLabels = steps.map((s, idx) => ({
    index: idx + 1,
    title: s.title,
  }));

  return (
    <section
      aria-label="Assembly timeline and step instructions"
      data-testid="step-timeline-panel"
      style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
        }}
      >
        <AssemblyTimelineControls
          stepCount={stepCount}
          position={scrubPosition}
          playing={playing}
          explode={explodeAmount}
          steps={stepLabels}
          onPlay={() => {
            if (scrubPosition >= stepCount) onScrubChange(0);
            onPlayingChange(true);
          }}
          onPause={() => onPlayingChange(false)}
          onBack={() => {
            onPlayingChange(false);
            onScrubChange(previousStepPosition(scrubPosition, stepCount));
          }}
          onNext={() => {
            onPlayingChange(false);
            onScrubChange(nextStepPosition(scrubPosition, stepCount));
          }}
          onScrub={(pos) => {
            onPlayingChange(false);
            onScrubChange(pos);
          }}
          onExplodeChange={onExplodeChange}
          onReset={onResetToFullAssembly}
        />

        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12,
            color: '#cbd5e1',
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            data-testid="timeline-ghost-future"
            checked={ghostFutureSteps}
            onChange={(e) => onGhostFutureChange(e.target.checked)}
          />
          <span>Ghost forthcoming parts</span>
        </label>
      </div>

      {/* Step Quick-Jump Pills */}
      <div
        role="list"
        aria-label="Assembly steps list"
        style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}
      >
        <button
          type="button"
          data-testid="timeline-step-pill-0"
          aria-pressed={assemblyMode === 'step' && activeStepIndex === 0}
          onClick={() => {
            onPlayingChange(false);
            onScrubChange(0);
          }}
          style={{
            background: assemblyMode === 'step' && activeStepIndex === 0 ? '#1d4ed8' : '#181d27',
            color: '#e2e8f0',
            border: '1px solid #2b3445',
            borderRadius: 5,
            padding: '3px 8px',
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          0 · Prep
        </button>
        {steps.map((s, idx) => {
          const stepIdx = idx + 1;
          const isCurrent = assemblyMode === 'step' && activeStepIndex === stepIdx;
          const touchesSelected = !!selectedInstanceId && s.instance_ids.includes(selectedInstanceId);
          return (
            <button
              key={s.step}
              type="button"
              data-testid={`timeline-step-pill-${stepIdx}`}
              aria-pressed={isCurrent}
              onClick={() => {
                onPlayingChange(false);
                onScrubChange(stepIdx);
              }}
              style={{
                background: isCurrent ? '#1d4ed8' : touchesSelected ? '#1e293b' : '#181d27',
                color: isCurrent ? '#ffffff' : '#cbd5e1',
                border: isCurrent
                  ? '1px solid #3b82f6'
                  : touchesSelected
                    ? '1px solid #60a5fa'
                    : '1px solid #2b3445',
                borderRadius: 5,
                padding: '3px 8px',
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              {s.step} · {s.title}
            </button>
          );
        })}
      </div>

      {/* Active Step Instructions & Referenced Instances */}
      {currentStep ? (
        <div
          data-testid="timeline-active-step-details"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            padding: '8px 10px',
            background: '#141923',
            border: '1px solid #242c3d',
            borderRadius: 6,
            fontSize: 12,
          }}
        >
          <div>
            <div>
              <strong>
                Step {currentStep.step}: {currentStep.title}
              </strong>{' '}
              — {currentStep.instructions}
            </div>
            {currentStep.safety_notes.length > 0 && (
              <div style={{ color: '#fcd34d', fontSize: 11, marginTop: 3 }}>
                Caution: {currentStep.safety_notes.join(' · ')}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 5 }}>
            <span style={{ fontSize: 11, color: '#94a3b8' }}>Step parts:</span>
            {currentStep.instance_ids.map((id) => (
              <button
                key={id}
                type="button"
                data-testid={`timeline-step-instance-${id}`}
                onClick={() => onSelectInstance(id)}
                style={{
                  background: selectedInstanceId === id ? '#2563eb' : '#1e293b',
                  color: '#f1f5f9',
                  border: '1px solid #3b82f6',
                  borderRadius: 4,
                  padding: '2px 7px',
                  fontSize: 11,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  cursor: 'pointer',
                }}
              >
                {id}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
