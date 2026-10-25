'use client';

import Link from 'next/link';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { buyLines, formatMoney, partNicknames, plainInstructions } from '../../lib/flow/derive';
import type { ProjectRecord } from '../../lib/flow/projects';
import { STEPS, advance, projectPath, type StepId } from '../../lib/flow/steps';
import type { BuildPlan, CatalogComponent } from '../../lib/rivet/types';
import { Icon } from '../system/Icon';
import { usePrintFiles } from '../three/enclosure/usePrintFiles';

/**
 * The guide's steps: buy, then build. Parts have their own tab, wiring shows on the model (the Wires
 * toggle), and the checks stay on the full Review page.
 */
const GUIDE = ['buy', 'build'] as const;
type GuideStep = (typeof GUIDE)[number];

/** How far through the guide a project is: 0 = buying … 2 = built. Earlier steps all count as buying. */
function reached(furthest: StepId): number {
  if (furthest === 'build') return 1;
  if (furthest === 'done') return 2;
  return 0;
}

const LABEL = Object.fromEntries(STEPS.map((s) => [s.id, s.label])) as Record<GuideStep, string>;

/**
 * The Build tab: from design to a finished robot in the panel. Each step opens in place with what it
 * needs (a shopping list, then the assembly order) and a button to the next one; later steps
 * unlock in order. Each also links to its full page for the deeper tools.
 */
export function BuildGuide({
  project,
  update,
  plan,
  catalog,
  onStep,
}: {
  project: ProjectRecord;
  update: (patch: Partial<ProjectRecord>) => void;
  plan: BuildPlan;
  catalog: readonly CatalogComponent[];
  onStep: (step: number) => void;
}) {
  const at = reached(project.furthestStep);
  // A new project starts with every step closed and a hint pointing at Buy; once started (or
  // already past Buy), the step reached opens.
  const started = Boolean(project.guideStarted) || project.furthestStep !== 'review';
  const [open, setOpen] = useState<GuideStep | null>(started ? (GUIDE[at] ?? null) : null);
  const firstRef = useRef<HTMLButtonElement>(null);
  const lastAt = useRef(at);

  // Moving on (from here or a full page) opens the step reached.
  useEffect(() => {
    if (lastAt.current === at) return;
    lastAt.current = at;
    setOpen(GUIDE[at] ?? null);
  }, [at]);

  function toggle(id: GuideStep, isOpen: boolean) {
    setOpen(isOpen ? null : id);
    if (!isOpen && !started) update({ guideStarted: true });
  }

  function next(from: GuideStep, patch: Partial<ProjectRecord> = {}) {
    const to: StepId = from === 'buy' ? 'build' : 'done';
    update({ ...patch, furthestStep: advance(project.furthestStep, to) });
  }

  return (
    <ol className="ws-guide" data-testid="workspace-guide">
      {GUIDE.map((id, i) => {
        const unlocked = i <= at;
        const done = i < at;
        const isOpen = open === id && unlocked;
        return (
          <li key={id} className="ws-guide__step" data-state={done ? 'done' : unlocked ? 'open' : 'locked'} data-testid={`workspace-guide-${id}`}>
            <button
              type="button"
              className="ws-guide__head"
              aria-expanded={isOpen}
              disabled={!unlocked}
              onClick={() => toggle(id, isOpen)}
              ref={id === GUIDE[0] ? firstRef : undefined}
              data-testid={`workspace-guide-${id}-toggle`}
            >
              <span className="ws-guide__num" aria-hidden="true">
                {done ? <Icon name="check" size={11} /> : i + 1}
              </span>
              <span className="ws-guide__title">{LABEL[id]}</span>
              <span className="ws-guide__state">{done ? 'Done' : unlocked ? '' : 'Locked'}</span>
              {unlocked ? <Icon name="chevronDown" size={14} className="ws-guide__chev" /> : null}
            </button>
            {isOpen ? (
              <div className="ws-guide__body">
                {id === 'buy' ? (
                  <BuyBody project={project} update={update} plan={plan} catalog={catalog} onNext={() => next('buy')} />
                ) : (
                  <BuildBody
                    project={project}
                    update={update}
                    plan={plan}
                    catalog={catalog}
                    onStep={onStep}
                    onFinish={() => next('build', { completedAt: project.completedAt ?? new Date().toISOString() })}
                  />
                )}
                <Link href={projectPath(project.id, id)} className="ws-guide__full" data-testid={`workspace-guide-${id}-full`}>
                  Open the full {LABEL[id]} page
                </Link>
              </div>
            ) : null}
          </li>
        );
      })}
      {!started ? <StartHint anchor={firstRef} /> : null}
      {project.completedAt ? (
        <li className="ws-guide__finished" data-testid="workspace-guide-finished">
          <Icon name="check" size={14} />
          <span>Built. Nice work.</span>
        </li>
      ) : null}
    </ol>
  );
}

/**
 * "Start here" label beside the first step, bouncing gently until that step is opened. It floats over the edge
 * of the model, so it is placed from Review's position and drawn inside the workspace (the panel
 * clips anything that overflows it).
 */
function StartHint({ anchor }: { anchor: React.RefObject<HTMLButtonElement> }) {
  const [spot, setSpot] = useState<{ left: number; top: number } | null>(null);
  const [host, setHost] = useState<Element | null>(null);

  useLayoutEffect(() => {
    const el = anchor.current;
    if (!el) return;
    setHost(el.closest('.ws'));
    const place = () => {
      const r = el.getBoundingClientRect();
      // Only beside the step when there is room (on a phone the panel fills the screen).
      setSpot(r.width > 0 && r.right + 14 + 240 <= window.innerWidth ? { left: r.right + 14, top: r.top + r.height / 2 } : null);
    };
    place();
    const scroller = el.closest('.ws-left__scroll');
    window.addEventListener('resize', place);
    scroller?.addEventListener('scroll', place, { passive: true });
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    ro?.observe(el);
    return () => {
      window.removeEventListener('resize', place);
      scroller?.removeEventListener('scroll', place);
      ro?.disconnect();
    };
  }, [anchor]);

  if (!spot || !host) return null;
  return createPortal(
    <div className="ws-hint" style={{ left: spot.left, top: spot.top }} role="note" data-testid="workspace-start-hint">
      Step 1: Buy. Work your way sequentially through the steps.
    </div>,
    host,
  );
}

function Next({ children, onClick, testId }: { children: ReactNode; onClick: () => void; testId: string }) {
  return (
    <button type="button" className="ws-btn ws-btn--primary ws-btn--sm ws-guide__next" onClick={onClick} data-testid={testId}>
      {children}
      <Icon name="arrowRight" size={13} />
    </button>
  );
}

/* ── 1. Buy ── */

function BuyBody({
  project,
  update,
  plan,
  catalog,
  onNext,
}: {
  project: ProjectRecord;
  update: (patch: Partial<ProjectRecord>) => void;
  plan: BuildPlan;
  catalog: readonly CatalogComponent[];
  onNext: () => void;
}) {
  const lines = useMemo(() => buyLines(plan, catalog).filter((l) => !l.fabricated), [plan, catalog]);
  const owned = new Set(project.ownedCatalogIds);
  const toBuy = lines.filter((l) => !owned.has(l.catalogId));
  const priced = toBuy.filter((l) => l.unitPrice !== null);
  const total = priced.reduce((sum, l) => sum + (l.unitPrice ?? 0) * l.quantity, 0);

  function toggle(id: string) {
    const next = owned.has(id) ? project.ownedCatalogIds.filter((x) => x !== id) : [...project.ownedCatalogIds, id];
    update({ ownedCatalogIds: next });
  }

  return (
    <>
      <p className="ws-guide__text">
        This is a list of components you will need for your project. Rivet has gathered the best sources for purchasing these
        components.
      </p>
      <ul className="ws-guide__list">
        {lines.map((l) => (
          <li key={l.catalogId} className="ws-guide__buy" data-owned={owned.has(l.catalogId) || undefined}>
            <label className="ws-check">
              <input type="checkbox" checked={owned.has(l.catalogId)} onChange={() => toggle(l.catalogId)} data-testid={`workspace-buy-own-${l.catalogId}`} />
              <span className="ws-check__box" aria-hidden="true" />
              <span className="ui-sr-only">I already have {l.name}</span>
            </label>
            <span className="ws-guide__buy-name">
              <strong>
                {l.quantity > 1 ? `${l.quantity} × ` : ''}
                {l.name}
              </strong>
              <span className="ws-guide__sub">
                {l.unitPrice !== null ? formatMoney(l.unitPrice * l.quantity, plan.bom.currency) : 'No price yet'}
                {l.url ? ` · ${l.vendor}` : ''}
              </span>
            </span>
            {l.url ? (
              <a className="ws-guide__shop" href={l.url} target="_blank" rel="noreferrer" aria-label={`Buy ${l.name} at ${l.vendor}`}>
                <Icon name="external" size={13} />
              </a>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="ws-guide__total" data-testid="workspace-buy-total">
        <span>Still to buy</span>
        <strong>
          {formatMoney(total, plan.bom.currency)}
          {priced.length < toBuy.length ? ' + unpriced' : ''}
        </strong>
      </p>
      <Next onClick={onNext} testId="workspace-guide-buy-next">
        Continue to Build
      </Next>
    </>
  );
}

/* ── 2. Build ── */

function BuildBody({
  project,
  update,
  plan,
  catalog,
  onStep,
  onFinish,
}: {
  project: ProjectRecord;
  update: (patch: Partial<ProjectRecord>) => void;
  plan: BuildPlan;
  catalog: readonly CatalogComponent[];
  onStep: (step: number) => void;
  onFinish: () => void;
}) {
  const steps = useMemo(() => [...plan.assembly_steps].sort((a, b) => a.step - b.step), [plan.assembly_steps]);
  const print = usePrintFiles(plan, catalog);
  const nicknames = useMemo(() => partNicknames(plan, catalog), [plan, catalog]);
  const finished = Boolean(project.completedAt);
  // Steps before `buildStep` are done; a finished build has them all done.
  const doneUpTo = finished ? steps.length : Math.max(0, project.buildStep - 1);

  function toggle(n: number) {
    update({ buildStep: n <= doneUpTo ? n : n + 1, ...(n <= doneUpTo ? { completedAt: null } : {}) });
  }

  return (
    <>
      {print.spec && print.size ? (
        <div className="ws-guide__print">
          <p className="ws-guide__label">First, print the body</p>
          <p className="ws-guide__sub">
            {print.size[0]} × {print.size[1]} × {print.size[2]} mm, laid out for one build plate.
          </p>
          <div className="ws-guide__btns">
            <button type="button" className="ws-btn ws-btn--sm" onClick={() => void print.download('obj')} disabled={print.busy !== null} data-testid="workspace-guide-print-obj">
              <Icon name="download" size={13} /> .obj
            </button>
            <button type="button" className="ws-btn ws-btn--sm" onClick={() => void print.download('stl')} disabled={print.busy !== null}>
              <Icon name="download" size={13} /> .stl
            </button>
          </div>
          {print.error ? <p className="ws-guide__sub ws-guide__sub--danger">{print.error}</p> : null}
        </div>
      ) : null}
      <p className="ws-guide__label">
        Put it together · {doneUpTo} of {steps.length} done
      </p>
      <ol className="ws-guide__list ws-guide__assembly">
        {steps.map((s) => {
          const done = s.step <= doneUpTo;
          return (
            <li key={s.step} data-done={done || undefined} data-current={!done && s.step === doneUpTo + 1 ? true : undefined}>
              <label className="ws-check">
                <input type="checkbox" checked={done} onChange={() => toggle(s.step)} data-testid={`workspace-assembly-done-${s.step}`} />
                <span className="ws-check__box" aria-hidden="true" />
                <span className="ui-sr-only">Step {s.step} done</span>
              </label>
              <button type="button" className="ws-guide__step-btn" onClick={() => onStep(s.step)} data-testid={`workspace-assembly-${s.step}`}>
                <strong>
                  {s.step}. {s.title}
                </strong>
                {!done ? <span className="ws-guide__sub">{plainInstructions(s.instructions, nicknames)}</span> : null}
                {!done && s.safety_notes.length > 0 ? (
                  <span className="ws-guide__safety">
                    <Icon name="alert" size={12} />
                    {s.safety_notes.join(' ')}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ol>
      {!finished && doneUpTo >= steps.length ? (
        <Next onClick={onFinish} testId="workspace-guide-finish">
          Mark it built
        </Next>
      ) : null}
    </>
  );
}
