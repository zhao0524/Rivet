'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { buyLines, formatMoney, partNicknames, partRows, plainInstructions } from '../../lib/flow/derive';
import type { ProjectRecord } from '../../lib/flow/projects';
import { STEPS, advance, projectPath, type StepId } from '../../lib/flow/steps';
import { isConceptPlan } from '../../lib/rivet/honesty';
import type { BuildPlan, CatalogComponent } from '../../lib/rivet/types';
import { Icon } from '../system/Icon';
import type { PartSelectionApi } from '../three/interactions';
import { usePrintFiles } from '../three/enclosure/usePrintFiles';
import { attentionChecks, partNames } from '../start/shared';

/**
 * The guide's steps. Parts have their own tab, and wiring shows on the model (the Wires toggle), so
 * the guide is review, buy, build.
 */
const GUIDE = ['review', 'buy', 'build'] as const;
type GuideStep = (typeof GUIDE)[number];

/** How far through the guide a project is: 0 = on Review … 3 = built. Older projects may sit on Parts or Wiring. */
function reached(furthest: StepId): number {
  if (furthest === 'review') return 0;
  if (furthest === 'parts' || furthest === 'wiring' || furthest === 'buy') return 1;
  if (furthest === 'build') return 2;
  return 3;
}

const LABEL = Object.fromEntries(STEPS.map((s) => [s.id, s.label])) as Record<GuideStep, string>;

/**
 * The Build tab: from design to a finished robot in the panel. Each step opens in place with what it
 * needs (the risks, a shopping list, the assembly order) and a button to the next one; later steps
 * unlock in order. Each also links to its full page for the deeper tools.
 */
export function BuildGuide({
  project,
  update,
  plan,
  catalog,
  selection,
  onStep,
}: {
  project: ProjectRecord;
  update: (patch: Partial<ProjectRecord>) => void;
  plan: BuildPlan;
  catalog: readonly CatalogComponent[];
  selection: PartSelectionApi;
  onStep: (step: number) => void;
}) {
  const at = reached(project.furthestStep);
  const [open, setOpen] = useState<GuideStep | null>(GUIDE[at] ?? null);

  // Moving on (from here or a full page) opens the step reached.
  useEffect(() => {
    setOpen(GUIDE[at] ?? null);
  }, [at]);

  function next(from: GuideStep, patch: Partial<ProjectRecord> = {}) {
    const to: StepId = from === 'review' ? 'buy' : from === 'buy' ? 'build' : 'done';
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
              onClick={() => setOpen(isOpen ? null : id)}
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
                {id === 'review' ? (
                  <ReviewBody plan={plan} catalog={catalog} selection={selection} onNext={() => next('review', { reviewDone: true })} />
                ) : id === 'buy' ? (
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
      {project.completedAt ? (
        <li className="ws-guide__finished" data-testid="workspace-guide-finished">
          <Icon name="check" size={14} />
          <span>Built. Nice work.</span>
        </li>
      ) : null}
    </ol>
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

/* ── 1. Review: one card per risk ── */

function ReviewBody({
  plan,
  catalog,
  selection,
  onNext,
}: {
  plan: BuildPlan;
  catalog: readonly CatalogComponent[];
  selection: PartSelectionApi;
  onNext: () => void;
}) {
  const names = useMemo(() => partNames(partRows(plan, catalog)), [plan, catalog]);
  const checks = useMemo(() => attentionChecks(plan, names), [plan, names]);
  const passed = plan.verification.findings.filter((f) => f.result === 'PASS').length;

  if (isConceptPlan(plan)) {
    return (
      <>
        <p className="ws-guide__text">This is a concept model: it shows how the idea could look. Fit, wiring and power aren&apos;t checked.</p>
        <Next onClick={onNext} testId="workspace-guide-review-next">
          Looks good, continue to Buy
        </Next>
      </>
    );
  }

  return (
    <>
      <p className="ws-guide__text">
        {checks.length === 0
          ? `All ${passed} checks passed.`
          : `${passed} of ${plan.verification.findings.length} checks passed. ${checks.length === 1 ? 'One risk' : `${checks.length} risks`} to look at:`}
      </p>
      <ul className="ws-risks" data-testid="workspace-risks">
        {checks.map((c) => {
          const parts = Array.from(new Set(c.findings.flatMap((f) => f.affected_instance_ids)));
          return (
            <li key={c.ruleId} className="ws-risk" data-level={c.blocking ? 'blocking' : 'advisory'} data-testid="workspace-risk">
              <div className="ws-risk__head">
                <Icon name={c.blocking ? 'alert' : 'info'} size={14} />
                <strong>{c.title}</strong>
              </div>
              <span className="ws-risk__tag">{c.blocking ? 'Sort out before you build' : 'Worth a look'}</span>
              <p className="ws-risk__text">{c.detail}</p>
              {parts.length > 0 ? (
                <button type="button" className="ws-guide__link" onClick={() => selection.select(parts[0]!, { reason: 'api', reveal: true })}>
                  Show in the model
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      <Next onClick={onNext} testId="workspace-guide-review-next">
        Looks good, continue to Buy
      </Next>
    </>
  );
}

/* ── 2. Buy ── */

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
      <p className="ws-guide__text">Tick what you already have. Links go to the store Rivet checked.</p>
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
        I have everything, continue to Build
      </Next>
    </>
  );
}

/* ── 3. Build ── */

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
