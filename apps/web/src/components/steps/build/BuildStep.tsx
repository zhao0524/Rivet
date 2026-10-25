'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import '../../../styles/phase2.css';
import { catalogIndex, partNicknames, plainInstructions, roleLabel } from '../../../lib/flow/derive';
import { useProjectContext } from '../../flow/ProjectShell';
import { StepLayout } from '../../flow/StepLayout';
import { Icon } from '../../system/Icon';
import type { OverflowItem } from '../../system/OverflowMenu';
import { useThemeMode } from '../../system/ThemeToggle';
import { RoverScene } from '../../three/RoverScene';
import { clampStep, firmwareStep, needsSafetyAck, orderedSteps, stepParts } from './build-model';
import { FlashFirmwareCard } from './FlashFirmwareCard';
import { MissingPartModal } from './MissingPartModal';

const PURPOSE = 'Put it together one step at a time. Parts for this step are solid in the model; later ones are see-through.';
const SEAT_MS = 650;

/** 0 → 1 over SEAT_MS whenever `key` changes, so the step's parts seat into place. Reduced motion jumps to 1. */
function useSeatIn(key: number): number {
  const [progress, setProgress] = useState(1);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || typeof requestAnimationFrame !== 'function') {
      setProgress(1);
      return;
    }
    let frame = 0;
    const start = performance.now();
    setProgress(0);
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / SEAT_MS);
      setProgress(t);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [key]);
  return progress;
}

/** Step 5 Build: full-bleed 3D of the current step with a step panel, firmware card and safety gate. */
export function BuildStep() {
  const { project, update, build, goTo, openIterate } = useProjectContext();
  const { plan, catalog, dataSource } = build.store;
  const theme = useThemeMode();
  const [missingOpen, setMissingOpen] = useState(false);

  const steps = useMemo(() => orderedSteps(plan), [plan]);
  const count = steps.length;
  const current = build.ready ? clampStep(project.buildStep, count) : 0;
  const step = current > 0 ? steps[current - 1] ?? null : null;
  const parts = useMemo(() => (step ? stepParts(step, plan, catalog) : []), [step, plan, catalog]);
  const fwStep = useMemo(() => (build.ready ? firmwareStep(plan, catalog) : null), [build.ready, plan, catalog]);
  const byId = useMemo(() => catalogIndex(catalog), [catalog]);
  const nicknames = useMemo(() => partNicknames(plan, catalog), [plan, catalog]);
  const synthetic = build.ready && build.store.trust?.isSynthetic === true;
  const progress = useSeatIn(current);

  const needsAck = step ? needsSafetyAck(step, parts) : false;
  const acked = step ? project.acknowledgedSteps.includes(step.step) : false;
  const gated = needsAck && !acked;
  const last = current === count;
  const missingHere = parts.filter((p) => project.missingCatalogIds.includes(p.catalogId));

  // Resume: a project that never started Build is saved at step 1 once the plan is ready.
  useEffect(() => {
    if (build.ready && count > 0 && project.buildStep === 0) update({ buildStep: 1 });
  }, [build.ready, count, project.buildStep, update]);

  function setAck(next: boolean) {
    if (!step) return;
    const set = new Set(project.acknowledgedSteps);
    if (next) set.add(step.step);
    else set.delete(step.step);
    update({ acknowledgedSteps: Array.from(set).sort((a, b) => a - b) });
  }

  function next() {
    if (gated) return;
    if (last) {
      update({ buildStep: count, completedAt: project.completedAt ?? new Date().toISOString() });
      goTo('done');
      return;
    }
    update({ buildStep: current + 1 });
  }

  function back() {
    if (current > 1) update({ buildStep: current - 1 });
  }

  const overflow: OverflowItem[] = [
    { id: 'missing', label: 'Mark a part missing', disabled: !step, onSelect: () => setMissingOpen(true), testId: 'build-mark-missing' },
    { id: 'buy', label: 'Back to Buy', onSelect: () => goTo('buy'), testId: 'build-back-to-buy' },
    { id: 'iterate', label: 'Change something', onSelect: openIterate, testId: 'build-iterate' },
  ];

  if (!build.ready || !step) {
    const empty = build.ready && count === 0;
    return (
      <StepLayout
        title="Build"
        purpose={PURPOSE}
        primary={{ label: 'Next step', onClick: () => undefined, disabled: true, waitingFor: build.error || empty ? undefined : 'Loading the build steps…', testId: 'build-primary' }}
        overflow={overflow}
        bleed
        testId="build-step"
      >
        <div style={{ padding: '0 20px' }}>
          {build.error ? (
            <p className="ui-notice ui-notice--danger" role="alert" data-testid="build-error">
              <Icon name="alert" aria-hidden="true" /> {build.error}
            </p>
          ) : empty ? (
            <p className="ui-notice" data-testid="build-empty">
              This design has no build steps yet, so there&apos;s nothing to guide you through. Use Change something to ask for a new version.
            </p>
          ) : (
            <div className="build" aria-busy="true" aria-label="Loading the build steps">
              <div className="ui-skeleton build__stage" style={{ borderRadius: 0 }} />
              <div className="p2-skeleton-lines" style={{ padding: 20 }}>
                <div className="ui-skeleton" style={{ height: 14, width: 90 }} />
                <div className="ui-skeleton" style={{ height: 28, width: '70%' }} />
                <div className="ui-skeleton" style={{ height: 80 }} />
              </div>
            </div>
          )}
        </div>
      </StepLayout>
    );
  }

  const plainText = plainInstructions(step.instructions, nicknames);
  const firmwareUrl = dataSource.getExportUrl?.(plan.build_id, 'firmware.zip', plan.revision) ?? null;

  return (
    <StepLayout
      title="Build"
      purpose={PURPOSE}
      primary={{
        label: last ? 'Finish' : 'Next step',
        onClick: next,
        disabled: gated,
        waitingFor: gated ? 'Tick the safety note to continue' : undefined,
        testId: 'build-primary',
      }}
      overflow={overflow}
      bleed
      testId="build-step"
    >
      <div className="build">
        <div className="build__stage" data-testid="build-stage">
          <RoverScene
            plan={plan}
            catalog={catalog}
            assemblyMode="step"
            assemblyStep={current}
            assemblyProgress={progress}
            ghostFutureSteps
            themeMode={theme}
            showGrid={false}
          />
          <span className="build__stage-label" aria-hidden="true">
            <Icon name="cube" size={14} /> Step {current}: solid parts go on now, see-through ones come later
          </span>
        </div>

        <aside className="build__panel" aria-labelledby="build-step-title" data-testid="build-panel">
          <div className="build__panel-head">
            <span className="ui-eyebrow" aria-live="polite" data-testid="build-step-count">
              Step {current} of {count}
            </span>
            <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={back} disabled={current <= 1} data-testid="build-back">
              <Icon name="arrowLeft" aria-hidden="true" /> Back
            </button>
          </div>
          <div className="build__progress" role="progressbar" aria-valuemin={1} aria-valuemax={count} aria-valuenow={current} aria-label="Build progress">
            <span style={{ width: `${(current / count) * 100}%` }} />
          </div>
          <h2 id="build-step-title" className="ui-h2">
            {step.title}
          </h2>
          {synthetic ? (
            <p className="ui-notice" data-testid="build-placeholder-note">
              This is a practice example made of placeholder parts. Follow along on screen, but don&apos;t wire real parts from
              it.
            </p>
          ) : null}
          <p className="build__instructions" data-testid="build-instructions">
            {plainText}
          </p>
          {plainText !== step.instructions ? (
            <details className="p2-details">
              <summary className="ui-small">Show the exact pin and part names</summary>
              <p className="p2-details__body ui-small ui-muted" data-testid="build-instructions-original">
                {step.instructions}
              </p>
            </details>
          ) : null}

          {parts.length > 0 ? (
            <section aria-labelledby="build-parts-title">
              <h3 id="build-parts-title" className="ui-eyebrow" style={{ marginBottom: 8 }}>
                Parts in this step
              </h3>
              <ul className="build__parts" data-testid="build-parts">
                {parts.map((p) => {
                  const missing = project.missingCatalogIds.includes(p.catalogId);
                  return (
                    <li key={p.instanceId} className="build__part" data-testid={`build-part-${p.instanceId}`}>
                      <span className="build__part-name">{p.name}</span>
                      {missing ? <span className="ui-badge ui-badge--warn">Missing</span> : null}
                      <span className="build__part-id" title={p.instanceId} style={{ fontFamily: 'var(--ui-font)' }}>
                        {nicknames.get(p.instanceId) && nicknames.get(p.instanceId) !== p.name ? nicknames.get(p.instanceId) : roleLabel(p.role)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {missingHere.length > 0 ? (
            <p className="build__missing" data-testid="build-missing-note">
              Missing: {missingHere.map((p) => p.name).join(', ')}.{' '}
              <button type="button" className="ui-btn ui-btn--link ui-small" onClick={() => goTo('buy')}>
                Order it from Buy
              </button>
            </p>
          ) : null}

          {needsAck ? (
            <div className="ui-notice ui-notice--warn build__safety" data-testid="build-safety">
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <Icon name="alert" aria-hidden="true" style={{ flex: 'none', marginTop: 2 }} />
                <div>
                  <strong>Safety</strong>
                  {step.safety_notes.length > 0 ? (
                    <ul>
                      {step.safety_notes.map((note) => (
                        <li key={note}>{note}</li>
                      ))}
                    </ul>
                  ) : (
                    <p style={{ margin: '4px 0 0' }}>This step uses batteries or other power parts. Keep them unplugged until a later step says to connect them.</p>
                  )}
                </div>
              </div>
              <label className="ui-check" style={{ color: 'var(--ui-text)' }}>
                <input type="checkbox" checked={acked} onChange={(e) => setAck(e.target.checked)} data-testid="build-safety-ack" />
                <span>I&apos;ve read the safety note</span>
              </label>
            </div>
          ) : null}

          {fwStep === step.step ? <FlashFirmwareCard firmware={plan.firmware} downloadUrl={firmwareUrl} /> : null}

          {byId.size === 0 ? <p className="p2-note">Part names show as codes until the parts list loads.</p> : null}
        </aside>
      </div>

      <MissingPartModal
        open={missingOpen}
        onClose={() => setMissingOpen(false)}
        parts={parts}
        nicknames={nicknames}
        alreadyMissing={project.missingCatalogIds}
        onMark={(catalogId) => update({ missingCatalogIds: Array.from(new Set([...project.missingCatalogIds, catalogId])) })}
      />
    </StepLayout>
  );
}
