'use client';

import Link from 'next/link';
import { Fragment } from 'react';
import { PHASES, STEPS, isUnlocked, projectPath, stepIndex, type StepId } from '../../lib/flow/steps';
import { Icon } from '../system/Icon';

export interface StepperProps {
  projectId: string;
  current: StepId;
  furthest: StepId;
}

/** Persistent two-phase, five-step stepper shown once generation finishes. */
export function Stepper({ projectId, current, furthest }: StepperProps) {
  return (
    <nav className="stepper" aria-label="Build steps" data-testid="stepper">
      {PHASES.map((phase) => (
        <div key={phase.n} className="stepper__phase" data-phase={phase.n}>
          <span className="stepper__phase-label">
            Phase {phase.n} · {phase.label}
          </span>
          <ol className="stepper__steps">
            {STEPS.filter((s) => s.phase === phase.n).map((s) => {
              const unlocked = isUnlocked(s.id, furthest) || (s.id === 'buy' && current === 'buy');
              const isCurrent = current === s.id;
              const done = !isCurrent && stepIndex(s.id) < stepIndex(furthest);
              const body = (
                <Fragment>
                  <span className="stepper__num" aria-hidden="true">
                    {done ? <Icon name="check" size={12} /> : s.n}
                  </span>
                  <span className="stepper__label">{s.label}</span>
                </Fragment>
              );
              return (
                <li key={s.id}>
                  {unlocked && !isCurrent ? (
                    <Link
                      href={projectPath(projectId, s.id)}
                      className="stepper__step"
                      data-state={done ? 'done' : 'open'}
                      data-testid={`stepper-${s.id}`}
                    >
                      {body}
                      {done ? <span className="ui-sr-only"> (done)</span> : null}
                    </Link>
                  ) : (
                    <span
                      className="stepper__step"
                      data-state={isCurrent ? 'current' : 'locked'}
                      aria-current={isCurrent ? 'step' : undefined}
                      aria-disabled={isCurrent ? undefined : true}
                      data-testid={`stepper-${s.id}`}
                    >
                      {body}
                      {!isCurrent ? <span className="ui-sr-only"> (locked)</span> : null}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </nav>
  );
}
