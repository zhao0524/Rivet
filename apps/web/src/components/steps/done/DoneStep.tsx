'use client';

import { useMemo, useState } from 'react';
import '../../../styles/phase2.css';
import { blockers, catalogIndex, ruleTitle } from '../../../lib/flow/derive';
import { useProjectContext } from '../../flow/ProjectShell';
import { StepLayout } from '../../flow/StepLayout';
import { Icon } from '../../system/Icon';
import type { OverflowItem } from '../../system/OverflowMenu';
import { useThemeMode } from '../../system/ThemeToggle';
import { RoverScene } from '../../three/RoverScene';
import { downloadTextFile } from '../buy/download';

const PURPOSE = 'Your rover is assembled. Here is what you built, and anything still worth a look.';

function finishedLabel(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `Finished ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

/** Done: calm summary of the finished build with Share as the one primary action. */
export function DoneStep() {
  const { project, build, openIterate } = useProjectContext();
  const { plan, catalog, dataSource } = build.store;
  const theme = useThemeMode();
  const [status, setStatus] = useState<string | null>(null);

  const byId = useMemo(() => catalogIndex(catalog), [catalog]);
  // Every component counts as a part, including wiring and accessories that have no visible mesh.
  const partCount = plan.components.length;
  const stepCount = plan.assembly_steps.length;
  const open = useMemo(() => (build.ready ? blockers(plan) : []), [build.ready, plan]);
  const missing = project.missingCatalogIds.map((id) => byId.get(id)?.identity.model ?? id);

  async function share() {
    const url = typeof window !== 'undefined' ? window.location.href : '';
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        await navigator.share({ title: project.title, url });
        setStatus('Shared. The link opens on this device only, because projects are saved in this browser.');
        return;
      }
      await navigator.clipboard.writeText(url);
      setStatus('Link copied. It opens on this device only, because projects are saved in this browser.');
    } catch {
      setStatus(`Copy this link yourself: ${url}. It opens on this device only, because projects are saved in this browser.`);
    }
  }

  function exportBuild() {
    const url = dataSource.getExportUrl?.(plan.build_id, 'build.json', plan.revision) ?? null;
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
    downloadTextFile(`${plan.build_id}-r${plan.revision}.build.json`, JSON.stringify(plan, null, 2), 'application/json');
    setStatus('Downloaded build.json from the loaded plan.');
  }

  const overflow: OverflowItem[] = [
    { id: 'iterate', label: 'Change something', onSelect: openIterate, testId: 'done-iterate' },
    { id: 'export', label: 'Export build.json', disabled: !build.ready, onSelect: exportBuild, testId: 'done-export' },
  ];

  if (!build.ready) {
    return (
      <StepLayout title="Done" purpose={PURPOSE} primary={{ label: 'Share', onClick: () => undefined, disabled: true, waitingFor: build.error ? undefined : 'Loading the build', testId: 'done-primary' }} overflow={overflow} testId="done-step">
        {build.error ? (
          <p className="ui-notice ui-notice--danger" role="alert" data-testid="done-error">
            <Icon name="alert" aria-hidden="true" /> {build.error}
          </p>
        ) : (
          <div className="p2-grid" aria-busy="true" aria-label="Loading the build">
            <div className="ui-skeleton viewport viewport--sm" />
            <div className="p2-skeleton-lines">
              <div className="ui-skeleton" style={{ height: 72 }} />
              <div className="ui-skeleton" style={{ height: 72 }} />
            </div>
          </div>
        )}
      </StepLayout>
    );
  }

  const finished = finishedLabel(project.completedAt);

  return (
    <StepLayout title="Built" purpose={PURPOSE} primary={{ label: 'Share', onClick: () => void share(), testId: 'done-primary' }} overflow={overflow} testId="done-step">
      <div className="p2-grid">
        <div className="p2-stack">
          <div className="viewport viewport--sm" data-testid="done-viewport">
            <RoverScene plan={plan} catalog={catalog} assemblyMode="assembled" themeMode={theme} showGrid={false} />
            <span className="viewport__label">{plan.title}</span>
          </div>
          <section className="ui-island" aria-labelledby="done-summary-title" data-testid="done-summary">
            <div className="p2-kv">
              <h2 id="done-summary-title" className="ui-h3">
                {project.title}
              </h2>
              {finished ? <span className="ui-badge ui-badge--ok">{finished}</span> : null}
            </div>
            <div className="p2-stat-grid" style={{ marginTop: 12 }}>
              <div className="p2-stat">
                <span className="p2-stat__n" data-testid="done-part-count">
                  {partCount}
                </span>
                <span className="p2-stat__l">parts</span>
              </div>
              <div className="p2-stat">
                <span className="p2-stat__n" data-testid="done-step-count">
                  {stepCount}
                </span>
                <span className="p2-stat__l">assembly steps</span>
              </div>
              <div className="p2-stat">
                <span className="p2-stat__n">{plan.revision}</span>
                <span className="p2-stat__l">revision</span>
              </div>
            </div>
            <p className="p2-note" style={{ marginTop: 14 }}>
              Want it cheaper, taller, or different?{' '}
              <button type="button" className="ui-btn ui-btn--link" onClick={openIterate} data-testid="done-change">
                Change something
              </button>{' '}
              and Rivet re-checks the whole build.
            </p>
          </section>
        </div>

        <aside className="p2-grid__side">
          <section className="ui-island" aria-labelledby="done-missing-title" data-testid="done-missing">
            <h2 id="done-missing-title" className="ui-h3">
              Parts marked missing
            </h2>
            {missing.length === 0 ? (
              <p className="p2-note">None. Every part was on hand.</p>
            ) : (
              <ul className="done__list" style={{ marginTop: 10 }}>
                {missing.map((name) => (
                  <li key={name} className="done__item">
                    <Icon name="alert" aria-hidden="true" style={{ color: 'var(--ui-warn)' }} />
                    <span>{name}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="ui-island" aria-labelledby="done-blockers-title" data-testid="done-blockers">
            <h2 id="done-blockers-title" className="ui-h3">
              Checks left unresolved
            </h2>
            {open.length === 0 ? (
              <p className="p2-note">None. Every blocking check passed.</p>
            ) : (
              <>
                <p className="p2-note">
                  {open.length} {open.length === 1 ? 'check' : 'checks'} could not be settled from the data Rivet has. Nothing here is hidden.
                </p>
                <ul className="done__list" style={{ marginTop: 10 }}>
                  {open.map((f, i) => (
                    <li key={`${f.rule_id}-${i}`} className="done__item">
                      <Icon name="alert" aria-hidden="true" style={{ color: 'var(--ui-danger)' }} />
                      <span>
                        <strong>{ruleTitle(f.rule_id)}</strong> <span className="ui-badge">{f.result}</span>
                        <br />
                        <span className="ui-muted ui-small">{f.message}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          <p className="p2-status" role="status" aria-live="polite" data-testid="done-status">
            {status}
          </p>
        </aside>
      </div>
    </StepLayout>
  );
}
