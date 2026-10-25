'use client';

import { useAppRouter } from '../system/Navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { ClarifyAnswers } from '../../lib/flow/projects';
import { projectPath } from '../../lib/flow/steps';
import type { InterpretResponse } from '../../lib/rivet/types';
import { useProjectContext } from '../flow/ProjectShell';
import { Icon } from '../system/Icon';
import { Thinking, formatElapsed, type ThinkingStep } from '../system/Thinking';
import { requestInput, summarizeIntent } from './shared';
import '../../styles/start.css';

const CARD_COUNT = 3;

type InterpretState =
  | { status: 'loading' }
  | { status: 'error'; message: string; ms: number }
  | { status: 'ok'; data: InterpretResponse; ms: number };

type BudgetChoice = 'none' | '50' | '100' | 'custom';
type SizeChoice = 'none' | 'max';

function budgetChoiceFrom(answers: ClarifyAnswers): { choice: BudgetChoice; custom: string } {
  const b = answers.max_budget;
  if (b === null || b === undefined) return { choice: 'none', custom: '' };
  if (b === 50) return { choice: '50', custom: '' };
  if (b === 100) return { choice: '100', custom: '' };
  return { choice: 'custom', custom: String(b) };
}

/**
 * A2 Clarify: up to three questions, one card at a time, each pre-filled with a default so most
 * cards are a confirmation. Card 1 shows what Rivet read from the prompt; "Skip the rest" goes
 * straight to Generate with the defaults.
 */
export function ClarifyScreen() {
  const router = useAppRouter();
  const { project, update, build } = useProjectContext();
  const store = build.store;
  const [card, setCard] = useState(0);
  const [interp, setInterp] = useState<InterpretState>({ status: 'loading' });
  const [budget, setBudget] = useState(() => budgetChoiceFrom(project.clarify));
  const [size, setSize] = useState<{ choice: SizeChoice; mm: string }>(() => ({
    choice: project.clarify.max_length_mm ? 'max' : 'none',
    mm: project.clarify.max_length_mm ? String(project.clarify.max_length_mm) : '',
  }));
  const requested = useRef<string | null>(null);
  const [unsupportedChoice, setUnsupportedChoice] = useState<UnsupportedChoice>(() =>
    project.clarify.interpretation_choice === 'closest_supported_rover' ? 'closest_supported_rover' : 'concept_model',
  );

  const interpret = useCallback(async () => {
    setInterp({ status: 'loading' });
    const source = store.dataSource;
    const t0 = performance.now();
    if (!source.interpret) {
      setInterp({ status: 'error', message: "Rivet can't read ideas right now. Try again once it's connected.", ms: 0 });
      return;
    }
    try {
      const data = await source.interpret({ input: requestInput(project), requirements: { currency: 'USD' } });
      setInterp({ status: 'ok', data, ms: performance.now() - t0 });
      // A toy car is closest to the engineered rover (real parts, wiring, firmware); anything else
      // becomes a 3D model of the photo. An explicit earlier choice is kept.
      if (!data.supported && !project.clarify.interpretation_choice) {
        setUnsupportedChoice(data.intent.project_family === 'rc_car' ? 'closest_supported_rover' : 'concept_model');
      }
      update({ intentId: data.intent_id, assumptions: data.intent.assumptions });
    } catch (err) {
      setInterp({
        status: 'error',
        message: err instanceof Error && err.message ? err.message : "Rivet couldn't read your idea.",
        ms: performance.now() - t0,
      });
    }
  }, [store.dataSource, project, update]);

  // Once per project (guards React strict mode's double effect).
  useEffect(() => {
    if (requested.current === project.id) return;
    requested.current = project.id;
    void interpret();
  }, [project.id, interpret]);

  const interpretationChoice: ClarifyAnswers['interpretation_choice'] =
    interp.status === 'ok' && !interp.data.supported ? unsupportedChoice : 'as_interpreted';

  const budgetValue = (): number | null => {
    if (budget.choice === '50') return 50;
    if (budget.choice === '100') return 100;
    if (budget.choice === 'custom') {
      const n = Number(budget.custom);
      return Number.isFinite(n) && n > 0 ? n : null;
    }
    return null;
  };
  const sizeValue = (): number | null => {
    if (size.choice !== 'max') return null;
    const n = Number(size.mm);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  };

  /** Everything answered so far, with defaults for the rest. */
  function answers(): ClarifyAnswers {
    return {
      max_budget: budgetValue(),
      max_length_mm: sizeValue(),
      interpretation_choice: interpretationChoice,
    };
  }

  function generate(clarify: ClarifyAnswers) {
    update({ clarify, phase: 'generating' });
    router.push(projectPath(project.id, 'generate'));
  }

  function next() {
    const clarify = answers();
    if (card === CARD_COUNT - 1) {
      generate(clarify);
      return;
    }
    update({ clarify });
    setCard((c) => c + 1);
  }

  function skip() {
    generate(answers());
  }

  const busy = interp.status === 'loading';
  // Families the build flow refuses (drones, arms…) can still get a v2 geometry-first design.
  const designParams = new URLSearchParams();
  if (project.prompt.trim()) designParams.set('prompt', project.prompt.trim());
  if (project.imageAssetId) designParams.set('ref', project.imageAssetId);
  const designQuery = designParams.toString();
  const designHref = designQuery ? `/design?${designQuery}` : '/design';
  const isLast = card === CARD_COUNT - 1;
  // Card 1 waits for the reading; a custom amount must be a number before moving on.
  const nextDisabled =
    (card === 0 && interp.status !== 'ok') ||
    (card === 1 && budget.choice === 'custom' && budgetValue() === null) ||
    (card === 2 && size.choice === 'max' && sizeValue() === null);

  return (
    <div className="q" data-testid="clarify-screen">
      <div className="q__progress">
        <span aria-live="polite" data-testid="clarify-progress">
          Question {card + 1} of {CARD_COUNT}
        </span>
        <span className="dots" aria-hidden="true">
          {Array.from({ length: CARD_COUNT }, (_, i) => (
            <span key={i} className="dots__dot" data-state={i < card ? 'done' : i === card ? 'current' : undefined} />
          ))}
        </span>
      </div>

      <section className="ui-card q__card" aria-labelledby="clarify-title">
        {card === 0 ? (
          <UnderstoodCard
            state={interp}
            onRetry={() => void interpret()}
            designHref={designHref}
            choice={unsupportedChoice}
            onChoice={setUnsupportedChoice}
          />
        ) : card === 1 ? (
          <BudgetCard value={budget} onChange={setBudget} />
        ) : (
          <SizeCard value={size} onChange={setSize} />
        )}

        <footer className="q__foot">
          <button type="button" className="ui-btn ui-btn--link" onClick={skip} disabled={busy} data-testid="clarify-skip">
            Skip the rest
          </button>
          <button
            type="button"
            className="ui-btn ui-btn--primary ui-btn--lg"
            onClick={next}
            disabled={nextDisabled}
            data-testid="clarify-next"
          >
            {isLast ? 'Generate' : 'Next'}
            {isLast ? <Icon name="sparkle" /> : <Icon name="arrowRight" />}
          </button>
        </footer>
      </section>
    </div>
  );
}

/* ── Card 1: what Rivet understood ─────────────────────── */

/** The real outcome of the interpret call as one step; nothing while it is still running. */
function readingSteps(state: InterpretState): ThinkingStep[] {
  if (state.status === 'loading') return [];
  if (state.status === 'error') return [{ id: 'read', text: "Couldn't read your idea", detail: state.message, status: 'failed' }];
  const { data } = state;
  if (data.vision_mode === 'fixture' || data.vision_mode === 'fallback') {
    return [
      {
        id: 'read',
        text: 'Used a saved example instead of reading your words',
        detail: "Rivet's live reader isn't connected, so your words and picture weren't read.",
        status: 'warning',
      },
    ];
  }
  return [{ id: 'read', text: summarizeIntent(data.intent).headline, status: 'done' }];
}

function ReadingTrace({ state }: { state: InterpretState }) {
  const ms = state.status === 'loading' ? null : state.ms;
  return (
    <Thinking
      title="Reading your idea"
      running={state.status === 'loading'}
      steps={readingSteps(state)}
      elapsedMs={ms}
      doneLabel={
        ms === null
          ? undefined
          : state.status === 'error'
            ? `Stopped after ${formatElapsed(ms)}`
            : state.status === 'ok' && state.data.vision_mode === 'live'
              ? `Read in ${formatElapsed(ms)}`
              : `Answered in ${formatElapsed(ms)}`
      }
      replayable={false}
      testId="clarify-thinking"
    />
  );
}

type UnsupportedChoice = 'concept_model' | 'closest_supported_rover';

const UNSUPPORTED_OPTIONS: readonly (ChoiceOption & { id: UnsupportedChoice })[] = [
  {
    id: 'concept_model',
    label: 'Build a 3D model of this',
    hint: 'Its parts, with suggested real products and vendor links. Fit and wiring are not checked.',
  },
  {
    id: 'closest_supported_rover',
    label: 'Use the closest supported rover',
    hint: 'A fully engineered indoor rover: verified parts, wiring, simulation and firmware.',
  },
];

function UnderstoodCard({
  state,
  onRetry,
  designHref,
  choice,
  onChoice,
}: {
  state: InterpretState;
  onRetry: () => void;
  designHref: string;
  choice: UnsupportedChoice;
  onChoice: (choice: UnsupportedChoice) => void;
}) {
  if (state.status === 'loading') {
    return (
      <div className="q__body" aria-busy="true" data-testid="clarify-skeleton">
        <h1 id="clarify-title" className="ui-sr-only">
          Reading your idea
        </h1>
        <ReadingTrace state={state} />
        <div className="q__skel">
          <span className="ui-skeleton" style={{ height: 18, width: '85%' }} />
          <span className="ui-skeleton" style={{ height: 14, width: '60%' }} />
          <span className="ui-skeleton" style={{ height: 14, width: '70%' }} />
        </div>
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="q__body">
        <ReadingTrace state={state} />
        <h1 id="clarify-title" className="ui-h2">
          Rivet couldn&apos;t read your idea
        </h1>
        <p className="ui-notice ui-notice--danger" role="alert" style={{ margin: 0 }} data-testid="clarify-error">
          {state.message}
        </p>
        <div>
          <button type="button" className="ui-btn ui-btn--secondary" onClick={onRetry} data-testid="clarify-retry">
            Try again
          </button>
        </div>
      </div>
    );
  }

  const { data } = state;
  const offline = data.vision_mode === 'fixture' || data.vision_mode === 'fallback';
  const read = summarizeIntent(data.intent);
  // Offline nothing was read: describe the saved example, not "what Rivet read".
  const summary = offline
    ? {
        ...read,
        headline: read.headline.replace(/^Rivet read this as /, 'The saved example is '),
        facts: read.facts.filter((f) => !f.startsWith('From the picture')),
      }
    : read;

  return (
    <div className="q__body" data-testid="clarify-understood">
      <ReadingTrace state={state} />
      <div>
        <p className="ui-eyebrow" style={{ marginBottom: 8 }}>
          {offline ? 'What Rivet will use' : "Here's what Rivet understood"}
        </p>
        <h1 id="clarify-title" className="ui-h2">
          {summary.headline}
        </h1>
      </div>

      {offline ? (
        <p className="ui-notice ui-notice--warn" style={{ margin: 0 }} data-testid="clarify-offline">
          <Icon name="info" style={{ flex: 'none', marginTop: 3 }} />
          <span>
            This is a saved example. Rivet didn&apos;t read your words or picture, so it will use a rover that was saved earlier.
          </span>
        </p>
      ) : null}

      {summary.facts.length > 0 ? (
        <ul className="q__facts">
          {summary.facts.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      ) : null}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        {!offline ? <span className="ui-badge">{summary.confidence}</span> : null}
        {summary.unknowns ? <span className="ui-small ui-subtle">{summary.unknowns}</span> : null}
      </div>

      {!data.supported ? (
        <>
          <p className="ui-notice ui-notice--danger" style={{ margin: 0 }} data-testid="clarify-limitation">
            <Icon name="alert" style={{ flex: 'none', marginTop: 3 }} />
            <span>{data.limitation?.message ?? 'This kind of robot is not supported yet.'}</span>
          </p>
          <ChoiceList
            label="How should Rivet continue?"
            options={UNSUPPORTED_OPTIONS}
            value={choice}
            onChange={(id) => onChoice(id as UnsupportedChoice)}
            testId="clarify-unsupported"
          />
          <p className="ui-small ui-muted" style={{ margin: 0 }}>
            Need engineered geometry with three candidates?{' '}
            <a href={designHref} data-testid="clarify-design-v2-link">
              Generate a 3D design
            </a>{' '}
            from the same prompt and photo.
          </p>
        </>
      ) : null}
    </div>
  );
}

/* ── Card 2: budget ────────────────────────────────────── */

function BudgetCard({
  value,
  onChange,
}: {
  value: { choice: BudgetChoice; custom: string };
  onChange: (next: { choice: BudgetChoice; custom: string }) => void;
}) {
  return (
    <div className="q__body">
      <h1 id="clarify-title" className="ui-h2">
        Do you have a budget?
      </h1>
      <p className="ui-muted" style={{ margin: 0 }}>
        A limit tells Rivet to leave out parts that would push the total over it.
      </p>
      <ChoiceList
        label="Budget"
        options={[
          { id: 'none', label: 'No limit', hint: 'Default' },
          { id: '50', label: 'Under $50' },
          { id: '100', label: 'Under $100' },
          { id: 'custom', label: 'Custom amount' },
        ]}
        value={value.choice}
        onChange={(id) => onChange({ ...value, choice: id as BudgetChoice })}
        testId="clarify-budget"
        after={
          value.choice === 'custom' ? (
            <div className="choice__sub">
              <label htmlFor="clarify-budget-custom" className="ui-label">
                Up to
              </label>
              <span className="choice__unit" aria-hidden="true">
                $
              </span>
              <input
                id="clarify-budget-custom"
                className="ui-input"
                type="number"
                inputMode="decimal"
                min={1}
                step={1}
                placeholder="75"
                value={value.custom}
                onChange={(e) => onChange({ ...value, custom: e.target.value })}
                data-testid="clarify-budget-amount"
                autoFocus
              />
              <span className="choice__unit">USD</span>
            </div>
          ) : null
        }
      />
    </div>
  );
}

/* ── Card 3: size ──────────────────────────────────────── */

function SizeCard({
  value,
  onChange,
}: {
  value: { choice: SizeChoice; mm: string };
  onChange: (next: { choice: SizeChoice; mm: string }) => void;
}) {
  return (
    <div className="q__body">
      <h1 id="clarify-title" className="ui-h2">
        Does it need to fit somewhere?
      </h1>
      <p className="ui-muted" style={{ margin: 0 }}>
        A shelf, a box, a doorway. Give the longest side it can have.
      </p>
      <ChoiceList
        label="Size"
        options={[
          { id: 'none', label: 'No limit', hint: 'Default' },
          { id: 'max', label: 'Keep it under a maximum length' },
        ]}
        value={value.choice}
        onChange={(id) => onChange({ ...value, choice: id as SizeChoice })}
        testId="clarify-size"
        after={
          value.choice === 'max' ? (
            <div className="choice__sub">
              <label htmlFor="clarify-size-mm" className="ui-label">
                Max length
              </label>
              <input
                id="clarify-size-mm"
                className="ui-input"
                type="number"
                inputMode="numeric"
                min={50}
                step={10}
                placeholder="200"
                value={value.mm}
                onChange={(e) => onChange({ ...value, mm: e.target.value })}
                data-testid="clarify-size-mm"
                autoFocus
              />
              <span className="choice__unit">mm</span>
            </div>
          ) : null
        }
      />
    </div>
  );
}

/* ── Radio-style choice list ───────────────────────────── */

interface ChoiceOption {
  id: string;
  label: string;
  hint?: string;
}

function ChoiceList({
  label,
  options,
  value,
  onChange,
  after,
  testId,
}: {
  label: string;
  options: readonly ChoiceOption[];
  value: string;
  onChange: (id: string) => void;
  /** Rendered after the selected option (e.g. a number field). */
  after?: ReactNode;
  testId?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="choice" data-testid={testId}>
      {options.map((opt) => {
        const checked = opt.id === value;
        return (
          <div key={opt.id} style={{ display: 'grid', gap: 8 }}>
            <button
              type="button"
              role="radio"
              aria-checked={checked}
              className="choice__item"
              onClick={() => onChange(opt.id)}
              data-testid={testId ? `${testId}-${opt.id}` : undefined}
            >
              <span className="choice__radio" aria-hidden="true" />
              <span className="choice__label">{opt.label}</span>
              {opt.hint ? <span className="choice__hint">{opt.hint}</span> : null}
            </button>
            {checked ? after : null}
          </div>
        );
      })}
    </div>
  );
}
