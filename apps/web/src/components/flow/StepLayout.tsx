'use client';

import type { ReactNode } from 'react';
import { OverflowMenu, type OverflowItem } from '../system/OverflowMenu';

export interface PrimaryAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** Why the CTA is waiting, read by screen readers and shown under it. */
  waitingFor?: string;
  testId?: string;
}

export interface StepLayoutProps {
  title: string;
  /** One sentence: what this step is for. */
  purpose: string;
  children: ReactNode;
  /** The single primary CTA. */
  primary: PrimaryAction | null;
  /** Secondary actions live here, never as extra buttons. */
  overflow?: readonly OverflowItem[];
  /** Full-bleed body (Build step) instead of the padded column. */
  bleed?: boolean;
  testId?: string;
}

/** Shared frame for every step: title, purpose, body, and a footer with one primary CTA. */
export function StepLayout({ title, purpose, children, primary, overflow = [], bleed = false, testId }: StepLayoutProps) {
  return (
    <section className={bleed ? 'step step--bleed' : 'step'} aria-labelledby="step-title" data-testid={testId}>
      <header className="step__head">
        <div>
          <h1 id="step-title" className="ui-h1">
            {title}
          </h1>
          <p className="ui-lede" style={{ marginTop: 6 }}>
            {purpose}
          </p>
        </div>
      </header>
      <div className="step__body">{children}</div>
      <footer className="step__foot">
        {overflow.length > 0 ? <OverflowMenu items={overflow} testId="step-overflow" /> : <span />}
        {primary ? (
          <div className="step__cta">
            {primary.waitingFor ? (
              <span className="ui-small ui-muted" id="step-cta-wait">
                {primary.waitingFor}
              </span>
            ) : null}
            <button
              type="button"
              className="ui-btn ui-btn--primary ui-btn--lg"
              onClick={primary.onClick}
              disabled={primary.disabled}
              aria-describedby={primary.waitingFor ? 'step-cta-wait' : undefined}
              data-testid={primary.testId ?? 'step-primary'}
            >
              {primary.label}
            </button>
          </div>
        ) : null}
      </footer>
    </section>
  );
}
