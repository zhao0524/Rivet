'use client';

import { useMemo, useState } from 'react';
import { partNicknames, partRows } from '../../../lib/flow/derive';
import { isConceptPlan } from '../../../lib/rivet/honesty';
import { useProjectContext } from '../../flow/ProjectShell';
import { StepLayout } from '../../flow/StepLayout';
import {
  APPROXIMATE_WIRING_DETAIL,
  buildWiringLayout,
  type WiringCatalogComponent,
  type WiringPlanInput,
} from '../../three/wiring';
import { BuildError, MoreDetails, SceneSkeleton, SceneViewport, SkeletonRows, useStepOverflow } from '../phase1/shared';
import { ConnectionList } from './ConnectionList';
import { FirmwarePanel } from './FirmwarePanel';
import { SimulationModal } from './SimulationModal';

type Tab = 'wiring' | 'firmware';

/** Plain label on the 3D view when wire ends are placed roughly rather than on measured pins. */
export const APPROXIMATE_WIRING_PLAIN = 'Wire positions are approximate';

/** Step 3: how the parts connect, and starter code that matches the wiring. Loading it onto the board happens in Build. */
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
  const concept = ready && isConceptPlan(plan);

  const partNames = useMemo(() => {
    const names = new Map<string, string>();
    if (ready) for (const row of partRows(plan, catalog)) names.set(row.instanceId, row.name);
    return names;
  }, [ready, plan, catalog]);
  const nicknames = useMemo(() => (ready ? partNicknames(plan, catalog) : new Map<string, string>()), [ready, plan, catalog]);
  const roles = useMemo(() => new Map(plan.components.map((c) => [c.instance_id, c.role])), [plan.components]);

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

  // A concept has no engineered connections: its wires are drawn parts that say what they join.
  const conceptWires = useMemo(() => {
    if (!concept) return [];
    const labels = new Map(plan.components.map((c) => [c.instance_id, String(c.render_overrides?.label ?? c.instance_id)]));
    return plan.components
      .filter((c) => c.role === 'wire')
      .map((c) => {
        const ends = (c.render_overrides?.connects ?? []) as string[];
        return {
          id: c.instance_id,
          label: String(c.render_overrides?.label ?? c.instance_id),
          kind: (c.render_overrides?.wire_kind as string | undefined) ?? 'wire',
          from: labels.get(ends[0] ?? '') ?? '?',
          to: labels.get(ends[1] ?? '') ?? '?',
        };
      });
  }, [concept, plan]);

  const downloadUrl = ready ? store.dataSource.getExportUrl?.(plan.build_id, 'firmware.zip', plan.revision) ?? null : null;

  return (
    <StepLayout
      title="Wiring & code"
      purpose="How the parts connect, and the starter code that runs on the controller board. Nothing goes onto the board until Build."
      primary={{
        label: 'Continue to Buy',
        onClick: () => goTo('buy'),
        disabled: !ready,
        waitingFor: !ready
          ? 'Loading the wiring…'
          : plan.firmware.compile_status === 'failed'
            ? "The starter code has an error. You can keep going; Build will remind you."
            : undefined,
        testId: 'wiring-primary',
      }}
      overflow={overflow}
      testId="wiring-step"
    >
      {error ? <BuildError message={error} /> : null}
      <div className="p1-tabs-row">
        <div className="ui-tabs" role="tablist" aria-label="Wiring or starter code">
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
            Starter code
          </button>
        </div>
        {concept ? null : (
          <button
            type="button"
            className="ui-btn ui-btn--link"
            onClick={() => setSimOpen(true)}
            disabled={!ready}
            data-testid="wiring-open-sim"
          >
            Take a test drive (simulation)
          </button>
        )}
      </div>

      {concept && tab === 'wiring' ? (
        <div id="panel-wiring" role="tabpanel" aria-labelledby="tab-wiring" className="split" data-testid="wiring-concept">
          <div className="p1-stack">
            <p className="ui-small ui-muted" style={{ margin: 0 }}>
              Typical wiring for this kind of device, inferred from the 3D model. Routes are approximate and nothing was
              checked electrically: use the suggested parts&apos; own wiring guides when you build it.
            </p>
            {conceptWires.length === 0 ? (
              <p className="ui-small" style={{ margin: 0 }} data-testid="wiring-concept-empty">
                The model has no wires to show.
              </p>
            ) : (
              <ul className="list" data-testid="wiring-concept-list">
                {conceptWires.map((w) => (
                  <li key={w.id} className="list__row" data-testid={`wiring-concept-${w.id}`}>
                    <span className="list__main">
                      <span className="list__title">
                        {w.from} → {w.to}
                      </span>
                      <span className="list__meta">
                        {w.kind} · {w.label}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="p1-sticky">
            <SceneViewport plan={plan} catalog={catalog} xray label="Concept model · inferred wiring" testId="wiring-viewport" />
          </div>
        </div>
      ) : concept ? (
        <div id="panel-firmware" role="tabpanel" aria-labelledby="tab-firmware" data-testid="firmware-panel">
          <p className="ui-notice" style={{ margin: 0 }} data-testid="firmware-concept">
            No firmware for a concept model: Rivet only writes and compiles code for builds it engineered. A suggested
            flight controller or board ships with its vendor&apos;s firmware tools.
          </p>
        </div>
      ) : tab === 'wiring' ? (
        <div id="panel-wiring" role="tabpanel" aria-labelledby="tab-wiring" className="split" data-testid="wiring-panel">
          <div className="p1-stack">
            {!ready || !layout ? (
              <SkeletonRows count={8} testId="wiring-skeleton" />
            ) : (
              <>
                <p className="ui-small ui-muted" style={{ margin: 0 }}>
                  {layout.counts.drawn} of {layout.counts.electrical_connections} connections drawn.{' '}
                  {layout.approximate
                    ? 'Each wire starts and ends roughly on the right part, not on the exact pin. Hover or tap a wire to light it up.'
                    : 'Pin positions come from the parts catalog. Hover or tap a wire to light it up.'}
                </p>
                {layout.approximate ? (
                  <MoreDetails summary="Why approximate?">{APPROXIMATE_WIRING_DETAIL}</MoreDetails>
                ) : null}
                <ConnectionList
                  layout={layout}
                  partNames={partNames}
                  nicknames={nicknames}
                  roles={roles}
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
                label={layout?.approximate ? APPROXIMATE_WIRING_PLAIN : undefined}
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

      {ready && !concept ? <SimulationModal plan={plan} open={simOpen} onClose={() => setSimOpen(false)} /> : null}
      {toast}
    </StepLayout>
  );
}
