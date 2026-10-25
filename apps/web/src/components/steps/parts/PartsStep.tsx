'use client';

import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { groupParts, isAiEstimated, partRows, type PartGroup, type PartRow } from '../../../lib/flow/derive';
import { useProjectContext } from '../../flow/ProjectShell';
import { StepLayout } from '../../flow/StepLayout';
import { usePartSelection } from '../../three/interactions';
import type { OverflowItem } from '../../system/OverflowMenu';
import { BuildError, SceneSkeleton, SceneViewport, SkeletonRows, useStepOverflow } from '../phase1/shared';
import { PartList } from './PartList';
import { SourceLegend, SpecDrawer } from './SpecDrawer';

/** Step 2: understand each component and what it does. List and 3D view select together. */
export function PartsStep() {
  const { build, goTo } = useProjectContext();
  const { store, ready, error } = build;
  const plan = store.plan;
  const catalog = store.catalog;
  const params = useSearchParams();
  const preselect = params?.get('part') ?? null;

  const [aiOnly, setAiOnly] = useState(false);
  const [exploded, setExploded] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<PartGroup>>(() => new Set());
  const [drawerId, setDrawerId] = useState<string | null>(null);

  const rows = useMemo(() => (ready ? partRows(plan, catalog) : []), [ready, plan, catalog]);
  const shown = useMemo(() => (aiOnly ? rows.filter((r) => isAiEstimated(r.catalog)) : rows), [rows, aiOnly]);
  const groups = useMemo(() => groupParts(shown), [shown]);
  const byId = useMemo(() => new Map(rows.map((r) => [r.instanceId, r])), [rows]);

  const revealRow = useCallback(
    (instanceId: string) => {
      const row = byId.get(instanceId);
      if (row) setCollapsed((c) => (c.has(row.group) ? new Set([...c].filter((g) => g !== row.group)) : c));
      // Wait for the group to open before scrolling.
      window.requestAnimationFrame(() => {
        document.getElementById(`part-row-${instanceId}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      });
    },
    [byId],
  );

  const selection = usePartSelection(ready ? plan : null, {
    onSelectionChange: (e) => {
      if (e.reason === 'pointer' && e.instance_id) revealRow(e.instance_id);
    },
  });
  const selectedId = selection.selectedInstanceId;

  const selectRow = useCallback(
    (row: PartRow) => {
      selection.select(row.instanceId, { reason: 'api', reveal: true });
      setDrawerId(row.instanceId);
    },
    [selection],
  );

  // `?part=<instanceId>` preselects a part and opens its drawer once the build is ready.
  const applied = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || !preselect || applied.current === preselect) return;
    applied.current = preselect;
    const row = byId.get(preselect);
    if (!row) return;
    selectRow(row);
    revealRow(row.instanceId);
  }, [ready, preselect, byId, selectRow, revealRow]);

  const extra = useMemo<OverflowItem[]>(
    () => [
      {
        id: 'ai-only',
        label: aiOnly ? 'Show all parts' : 'Show only parts with AI estimates',
        onSelect: () => setAiOnly((v) => !v),
        testId: 'overflow-ai-only',
      },
    ],
    [aiOnly],
  );
  const { items: overflow, toast } = useStepOverflow(extra);

  const drawerRow = drawerId ? byId.get(drawerId) ?? null : null;

  return (
    <StepLayout
      title="Parts"
      purpose="Every part in your robot, what it's for, and where each number came from. Pick one in the list or click it in the 3D model."
      primary={{
        label: 'Continue to Wiring & code',
        onClick: () => goTo('wiring'),
        disabled: !ready,
        waitingFor: ready ? undefined : 'Loading your parts list…',
        testId: 'parts-primary',
      }}
      overflow={overflow}
      testId="parts-step"
    >
      {error ? <BuildError message={error} /> : null}
      <div className="split">
        <div className="p1-stack">
          <div className="p1-parts-tools">
            <p className="ui-small ui-muted" style={{ margin: 0 }} aria-live="polite">
              {ready
                ? aiOnly
                  ? `${shown.length} of ${rows.length} parts have AI-estimated values`
                  : `${rows.length} parts in ${groups.length} groups`
                : 'Loading your parts list…'}
            </p>
            <button
              type="button"
              role="switch"
              aria-checked={exploded}
              className="ui-switch"
              onClick={() => setExploded((v) => !v)}
              disabled={!ready}
              data-testid="parts-explode"
            >
              <span className="ui-switch__track" aria-hidden="true" />
              Spread parts out
            </button>
          </div>
          <SourceLegend />
          {!ready ? (
            <SkeletonRows count={8} testId="parts-skeleton" />
          ) : groups.length === 0 ? (
            <div className="ui-card p1-empty">
              <p className="ui-muted" style={{ margin: 0 }}>
                No part in this build relies on an AI estimate.
              </p>
            </div>
          ) : (
            <PartList
              groups={groups}
              selectedId={selectedId}
              collapsed={collapsed}
              currency={plan.bom.currency}
              onToggleGroup={(g) =>
                setCollapsed((c) => {
                  const next = new Set(c);
                  if (next.has(g)) next.delete(g);
                  else next.add(g);
                  return next;
                })
              }
              onSelect={selectRow}
            />
          )}
        </div>
        <div className="p1-sticky">
          {ready ? (
            <SceneViewport
              plan={plan}
              catalog={catalog}
              selection={selection}
              assemblyMode={exploded ? 'exploded' : 'assembled'}
              assemblyProgress={1}
              label={selectedId ? byId.get(selectedId)?.name ?? selectedId : 'Click a part to see what it is'}
              testId="parts-viewport"
            />
          ) : (
            <SceneSkeleton />
          )}
        </div>
      </div>
      <SpecDrawer row={drawerRow} plan={plan} open={drawerRow !== null} onClose={() => setDrawerId(null)} />
      {toast}
    </StepLayout>
  );
}
