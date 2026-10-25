'use client';

import { useMemo, useState } from 'react';
import '../../../styles/phase2.css';
import { blockers, catalogIndex, partNicknames, plainCheck, plainResult } from '../../../lib/flow/derive';
import { useProjectContext } from '../../flow/ProjectShell';
import { StepLayout } from '../../flow/StepLayout';
import { Icon } from '../../system/Icon';
import type { OverflowItem } from '../../system/OverflowMenu';
import { useThemeMode } from '../../system/ThemeToggle';
import { RoverScene } from '../../three/RoverScene';
import { usePrintFiles } from '../../three/enclosure/usePrintFiles';
import { downloadTextFile } from '../buy/download';

const PURPOSE = 'Your rover is assembled. Here is what you built, and anything still worth a look.';

function finishedLabel(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `Finished ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

/** Done: summary and a portable build export; projects themselves only exist in this browser. */
export function DoneStep() {
  const { project, build, openIterate } = useProjectContext();
  const { plan, catalog, dataSource } = build.store;
  const theme = useThemeMode();
  const [status, setStatus] = useState<string | null>(null);
  const printFiles = usePrintFiles(plan, catalog);

  const byId = useMemo(() => catalogIndex(catalog), [catalog]);
  // Every component counts as a part, including wiring and accessories that have no visible mesh.
  const partCount = plan.components.length;
  const stepCount = plan.assembly_steps.length;
  const open = useMemo(() => (build.ready ? blockers(plan) : []), [build.ready, plan]);
  const nicknames = useMemo(() => partNicknames(plan, catalog), [plan, catalog]);
  const missing = project.missingCatalogIds.map((id) => byId.get(id)?.identity.model ?? id);

  function exportBuild() {
    const url = dataSource.getExportUrl?.(plan.build_id, 'build.json', plan.revision) ?? null;
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
    downloadTextFile(`${plan.build_id}-r${plan.revision}.build.json`, JSON.stringify(plan, null, 2), 'application/json');
    setStatus('Downloaded build.json, the full design file.');
  }

  const overflow: OverflowItem[] = [
    { id: 'iterate', label: 'Change something', onSelect: openIterate, testId: 'done-iterate' },
    ...(printFiles.spec
      ? [
          {
            id: 'print-obj',
            label: 'Download the printed body (.obj)',
            disabled: !build.ready || printFiles.busy !== null,
            onSelect: () =>
              void printFiles.download('obj').then((ok) => setStatus(ok ? 'Downloaded the printed body as an OBJ file, in millimetres.' : "Couldn't make the print file in this browser. Try again, or try another browser.")),
            testId: 'done-print-obj',
          },
        ]
      : []),
  ];

  if (!build.ready) {
    return (
      <StepLayout title="Done" purpose={PURPOSE} primary={{ label: 'Export build', onClick: () => undefined, disabled: true, waitingFor: build.error ? undefined : 'Loading your robot…', testId: 'done-primary' }} overflow={overflow} testId="done-step">
        {build.error ? (
          <p className="ui-notice ui-notice--danger" role="alert" data-testid="done-error">
            <Icon name="alert" aria-hidden="true" /> {build.error}
          </p>
        ) : (
          <div className="p2-grid" aria-busy="true" aria-label="Loading your robot">
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
    <StepLayout title={dataSource.mode === 'fixture' ? 'Example complete' : 'Built'}
      purpose={dataSource.mode === 'fixture' ? 'You have walked through the saved assembly. Review the open checks before building hardware.' : PURPOSE}
      primary={{ label: 'Export build', onClick: exportBuild, testId: 'done-primary' }} overflow={overflow} testId="done-step">
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
                <span className="p2-stat__l">build steps</span>
              </div>
              <div className="p2-stat">
                <span className="p2-stat__n">{plan.revision}</span>
                <span className="p2-stat__l">version</span>
              </div>
            </div>
            {dataSource.mode === 'fixture' ? (
              // A saved example cannot take edits; the same button explains that and offers a new project.
              <p className="p2-note" style={{ marginTop: 14 }}>
                Want one that is cheaper, taller, or different?{' '}
                <button type="button" className="ui-btn ui-btn--link" onClick={openIterate} data-testid="done-change">
                  Start your own build
                </button>{' '}
                and Rivet designs and checks it for you.
              </p>
            ) : (
              <p className="p2-note" style={{ marginTop: 14 }}>
                Want it cheaper, taller, or different?{' '}
                <button type="button" className="ui-btn ui-btn--link" onClick={openIterate} data-testid="done-change">
                  Change something
                </button>{' '}
                and Rivet checks the whole design again.
              </p>
            )}
          </section>
        </div>

        <aside className="p2-grid__side">
          <section className="ui-island" aria-labelledby="done-missing-title" data-testid="done-missing">
            <h2 id="done-missing-title" className="ui-h3">
              Parts marked missing
            </h2>
            {missing.length === 0 ? (
              <p className="p2-note">No parts were marked missing.</p>
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
              Problems still open
            </h2>
            {open.length === 0 ? (
              <p className="p2-note">None. Every important check passed.</p>
            ) : (
              <>
                <p className="p2-note">
                  {open.length} {open.length === 1 ? 'problem' : 'problems'} couldn&apos;t be settled with the information Rivet has. Nothing here is hidden.
                </p>
                <ul className="done__list" style={{ marginTop: 10 }}>
                  {open.map((f, i) => (
                    <li key={`${f.rule_id}-${i}`} className="done__item">
                      <Icon name="alert" aria-hidden="true" style={{ color: 'var(--ui-danger)' }} />
                      <span>
                        <strong>{plainCheck(f, nicknames).title}</strong> <span className="ui-badge">{plainResult(f.result)}</span>
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
