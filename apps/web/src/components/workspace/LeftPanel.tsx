'use client';

import type { ProjectRecord } from '../../lib/flow/projects';
import type { BuildPlan, CatalogComponent } from '../../lib/rivet/types';
import type { PartSelectionApi } from '../three/interactions';
import { BuildGuide } from './BuildGuide';
import { PartsPanel } from './PartsPanel';
import type { SessionStatus } from './session';

export type LeftTab = 'build' | 'parts';

/**
 * Left side of the workspace, with two tabs: Build walks through the steps from design to a finished
 * robot; Parts lists every component, where to buy it or how to print it. Both wait for the build.
 */
export function LeftPanel({
  tab,
  onTab,
  project,
  update,
  plan,
  catalog,
  status,
  selection,
  onStep,
}: {
  tab: LeftTab;
  onTab: (tab: LeftTab) => void;
  project: ProjectRecord;
  update: (patch: Partial<ProjectRecord>) => void;
  plan: BuildPlan | null;
  catalog: readonly CatalogComponent[];
  status: SessionStatus;
  selection: PartSelectionApi;
  onStep: (step: number) => void;
}) {
  return (
    <div className="ws-left" data-testid="workspace-left">
      <div className="ws-left__tabs" role="tablist" aria-label="Build guide or parts">
        {(
          [
            ['build', 'Build'],
            ['parts', 'Parts'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`ws-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`ws-panel-${id}`}
            className="ws-left__tab"
            onClick={() => onTab(id)}
            data-testid={`workspace-tab-left-${id}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="ws-left__scroll" role="tabpanel" id={`ws-panel-${tab}`} aria-labelledby={`ws-tab-${tab}`}>
        {!plan ? (
          <PanelSkeleton failed={status === 'failed'} />
        ) : tab === 'build' ? (
          <BuildGuide project={project} update={update} plan={plan} catalog={catalog} onStep={onStep} />
        ) : (
          <PartsPanel plan={plan} catalog={catalog} selection={selection} />
        )}
      </div>
    </div>
  );
}

function PanelSkeleton({ failed }: { failed: boolean }) {
  return (
    <div className="ws-tree-skel" aria-busy={!failed} data-testid="workspace-left-skeleton">
      {['Buy', 'Build'].map((label, i) => (
        <div key={label} className="ws-tree-skel__row">
          <span className="ws-guide__num" aria-hidden="true">
            {i + 1}
          </span>
          <span>{label}</span>
          {!failed ? <span className="ws-skel" style={{ width: `${30 + ((i * 17) % 30)}%` }} /> : null}
        </div>
      ))}
      <p className="ws-tree-skel__note">{failed ? 'Nothing was built.' : 'Your build guide appears once Rivet has built it.'}</p>
    </div>
  );
}
