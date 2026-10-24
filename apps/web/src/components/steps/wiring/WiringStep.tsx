'use client';

import { useMemo, useState } from 'react';
import { partRows } from '../../../lib/flow/derive';
import { useProjectContext } from '../../flow/ProjectShell';
import { StepLayout } from '../../flow/StepLayout';
import {
  APPROXIMATE_WIRING_DETAIL,
  APPROXIMATE_WIRING_TEXT,
  buildWiringLayout,
  type WiringCatalogComponent,
  type WiringPlanInput,
} from '../../three/wiring';
import { BuildError, SceneSkeleton, SceneViewport, SkeletonRows, useStepOverflow } from '../phase1/shared';
import { ConnectionList } from './ConnectionList';
import { FirmwarePanel } from './FirmwarePanel';
import { SimulationModal } from './SimulationModal';

type Tab = 'wiring' | 'firmware';

/** Step 3: how the parts connect, and code that matches the wiring. Flashing happens in Build. */
export function WiringStep() {
  const { build, goTo } = useProjectContext();
  const { store, ready, error } = build;
  const plan = store.plan;
  const catalog = store.catalog;
  const { items: overflow, toast } = useStepOverflow();

  const [tab, setTab] = useState<Tab>('wiring');
  const [hovered, setHovered] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [simOpen, setSimOpen] = useState(false);
  const activeConnectionId = hovered ?? pinned;

  const partNames = useMemo(() => {
    const names = new Map<string, string>();
    if (ready) for (const row of partRows(plan, catalog)) names.set(row.instanceId, row.name);
    return names;
  }, [ready, plan, catalog]);

  // Same input the 3D overlay builds, so the list and the drawn wires agree.
  const layout = useMemo(() => {
    if (!ready) return null;
    const input: WiringPlanInput = {
      build_id: plan.build_id,
      revision: plan.revision,
      components: plan.components
        .filter((c) => c.render_overrides?.visible !== false)
        .map((c) => ({ instance_id: c.instance_id, catalog_id: c.catalog_id, role: c.role, pose: c.pose })),
      connections: plan.connections.map((conn) => ({
        connection_id: conn.connection_id,
        kind: conn.kind,
        from: { instance_id: conn.from.instance_id, port_id: conn.from.port_id ?? '' },
        to: { instance_id: conn.to.instance_id, port_id: conn.to.port_id ?? '' },
        net_name: conn.net_name ?? null,
        notes: conn.notes ?? null,
      })),
    };
    return buildWiringLayout(input, catalog as unknown as readonly WiringCatalogComponent[]);
  }, [ready, plan, catalog]);

  const downloadUrl = ready ? store.dataSource.getExportUrl?.(plan.build_id, 'firmware.zip', plan.revision) ?? null : null;

  return (
    <StepLayout
      title="Wiring & firmware"
      purpose="How the parts connect, and code that matches the wiring. Nothing is flashed until Build."
      primary={{
        label: 'Continue to Buy',
        onClick: () => goTo('buy'),
        disabled: !ready,
        waitingFor: !ready
          ? 'Loading the build'
          : plan.firmware.compile_status === 'failed'
            ? 'The compile failed; Build will flag it again.'
            : undefined,
        testId: 'wiring-primary',
      }}
      overflow={overflow}
      testId="wiring-step"
    >
      {error ? <BuildError message={error} /> : null}
      <div className="p1-tabs-row">
        <div className="ui-tabs" role="tablist" aria-label="Wiring or firmware">
          <button
            type="button"
            role="tab"
            id="tab-wiring"
            aria-selected={tab === 'wiring'}
            aria-controls="panel-wiring"
            className="ui-tab"
            onClick={() => setTab('wiring')}
            data-testid="wiring-tab-wiring"
          >
            Wiring
          </button>
          <button
            type="button"
            role="tab"
            id="tab-firmware"
            aria-selected={tab === 'firmware'}
            aria-controls="panel-firmware"
            className="ui-tab"
            onClick={() => setTab('firmware')}
            data-testid="wiring-tab-firmware"
          >
            Firmware
          </button>
        </div>
        <button
          type="button"
          className="ui-btn ui-btn--link"
          onClick={() => setSimOpen(true)}
          disabled={!ready}
          data-testid="wiring-open-sim"
        >
          Try it in simulation
        </button>
      </div>

      {tab === 'wiring' ? (
        <div id="panel-wiring" role="tabpanel" aria-labelledby="tab-wiring" className="split" data-testid="wiring-panel">
          <div className="p1-stack">
            {!ready || !layout ? (
              <SkeletonRows count={8} testId="wiring-skeleton" />
            ) : (
              <>
                <p className="ui-small ui-muted" style={{ margin: 0 }}>
                  {layout.counts.drawn} of {layout.counts.electrical_connections} connections drawn.{' '}
                  {layout.approximate ? APPROXIMATE_WIRING_DETAIL : 'Pin positions come from the catalog.'}
                </p>
                <ConnectionList
                  layout={layout}
                  partNames={partNames}
                  activeConnectionId={activeConnectionId}
                  pinnedConnectionId={pinned}
                  onHover={setHovered}
                  onPin={setPinned}
                />
              </>
            )}
          </div>
          <div className="p1-sticky">
            {ready ? (
              <SceneViewport
                plan={plan}
                catalog={catalog}
                showWiring
                activeConnectionId={activeConnectionId}
                onWireHover={(w) => setHovered(w?.connection_id ?? null)}
                onWireSelect={(w) => setPinned(w.connection_id)}
                label={layout?.approximate ? APPROXIMATE_WIRING_TEXT : undefined}
                testId="wiring-viewport"
              />
            ) : (
              <SceneSkeleton />
            )}
          </div>
        </div>
      ) : (
        <div id="panel-firmware" role="tabpanel" aria-labelledby="tab-firmware" data-testid="firmware-panel">
          <FirmwarePanel plan={plan} downloadUrl={downloadUrl} loading={!ready} />
        </div>
      )}

      {ready ? <SimulationModal plan={plan} open={simOpen} onClose={() => setSimOpen(false)} /> : null}
      {toast}
    </StepLayout>
  );
}
