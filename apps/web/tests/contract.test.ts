import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FixtureSource,
  HttpSource,
  SAVED_BUILD_LABEL,
  SAVED_SYNTHETIC_EXAMPLE_LABEL,
  SYNTHETIC_ROVER_BUILD_ID,
  assertPlanIntegrity,
  checkPlanIntegrity,
  describeBuildTrust,
  isSyntheticPlan,
  summarizeBom,
  type BuildPlan,
  type RivetDataSource,
} from '../src/lib/contracts';
import {
  DEFAULT_SAVED_EXAMPLES,
  SOURCED_ROVER_BUILD_ID,
  createCombinedFixtureSource,
  getSourcedCatalog,
  getSourcedRoverPlan,
  getSyntheticCatalog,
  getSyntheticRoverIntent,
  getSyntheticRoverPlan,
} from '../src/lib/fixtures';
import { buildDimensionsByCatalogId, computePlanBoundsMm } from '../src/lib/geometry';
import { buildBomCsvClientSide, useStudioPlanStore } from '../src/lib/plan-store';
import { computeAssemblyView } from '../src/components/three/assembly';
import { normalizeVisibility } from '../src/components/three/parts';
import { buildWiringLayout, type WiringCatalogComponent } from '../src/components/three/wiring';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Canonical contract & cross-module integration checks (C7)', () => {
  it('validates synthetic rover plan, catalog, and intent and maps every instance to a BOM row', () => {
    const catalog = getSyntheticCatalog();
    const plan = getSyntheticRoverPlan();
    const intent = getSyntheticRoverIntent();

    expect(intent.schema_version).toBe('1.0');
    expect(plan.schema_version).toBe('1.0');
    expect(checkPlanIntegrity(plan, catalog)).toEqual([]);
    expect(() => assertPlanIntegrity(plan, catalog)).not.toThrow();

    // Every placed component instance maps to a BOM row with matching catalog_id
    for (const comp of plan.components) {
      const bomRow = plan.bom.items.find((row) => row.instance_ids.includes(comp.instance_id));
      expect(bomRow, `Missing BOM row for ${comp.instance_id}`).toBeDefined();
      expect(bomRow!.catalog_id).toBe(comp.catalog_id);
      expect(bomRow!.quantity).toBe(bomRow!.instance_ids.length);
    }

    const trust = describeBuildTrust(plan, 'fixture', catalog);
    expect(trust.isSynthetic).toBe(true);
    expect(trust.canDisplayAsVerified).toBe(false);

    const bomSummary = summarizeBom(plan);
    expect(bomSummary.totalLabel).toBe('Total unavailable');
    expect(bomSummary.knownSubtotal).toBeNull();
  });

  it('computes millimeter framing bounds for full assembly and isolated instances', () => {
    const catalog = getSyntheticCatalog();
    const plan = getSyntheticRoverPlan();
    const dims = buildDimensionsByCatalogId(catalog);
    expect(dims['demo.chassis_2wd']).toEqual({ x: 140, y: 12, z: 180 });

    const fullBounds = computePlanBoundsMm(plan, catalog);
    expect(fullBounds).toBeDefined();
    expect(fullBounds!.min[0]).toBeLessThan(-70);
    expect(fullBounds!.max[0]).toBeGreaterThan(70);
    expect(fullBounds!.max[2]).toBeGreaterThan(80);

    const isolatedSensorBounds = computePlanBoundsMm(plan, catalog, {
      instanceIds: ['sensor-1'],
    });
    expect(isolatedSensorBounds).toBeDefined();
    expect(isolatedSensorBounds!.max[0] - isolatedSensorBounds!.min[0]).toBeCloseTo(22, 4);
  });

  it('exports BOM CSV preserving null prices and total_status without inventing zeros', () => {
    const plan = getSyntheticRoverPlan();
    const csv = buildBomCsvClientSide(plan);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe(
      'catalog_id,quantity,instance_ids,unit_price_amount,currency,purchase_url,link_status',
    );
    expect(lines.find((l) => l.startsWith('demo.tt_motor,'))).toBe(
      'demo.tt_motor,2,motor-left-1;motor-right-1,,,,not_available',
    );
    expect(lines[lines.length - 1]).toBe('TOTAL,,,,,,total_status:not_available');
  });

  it('supports uploadImage, listExamples, listRevisions, and Estelle fallback on FixtureSource and HttpSource', async () => {
    const fixture = new FixtureSource();
    const examples = await fixture.listExamples();
    expect(examples).toHaveLength(1);
    expect(examples[0].example_id).toBe(SYNTHETIC_ROVER_BUILD_ID);
    expect(DEFAULT_SAVED_EXAMPLES).toHaveLength(2);
    expect(DEFAULT_SAVED_EXAMPLES[0].example_id).toBe(SYNTHETIC_ROVER_BUILD_ID);
    expect(DEFAULT_SAVED_EXAMPLES[1].example_id).toBe(SOURCED_ROVER_BUILD_ID);

    const revisions = await fixture.listRevisions(SYNTHETIC_ROVER_BUILD_ID);
    expect(revisions).toHaveLength(1);
    expect(revisions[0].revision).toBe(1);

    const estelle = await fixture.getEstelleStatus();
    expect(estelle.available).toBe(false);
    const grounded = await fixture.groundSymbol({ kind: 'locate', name: 'read_front_distance' });
    expect(grounded.status).toBe('unavailable');
    expect(grounded.citations).toEqual([]);

    // Image-only generate request with user_text: null is accepted
    const genRes = await fixture.generate({
      input: {
        kind: 'image',
        image_asset_id: 'asset-00000000000000000000000000000001',
        user_text: null,
      },
    });
    expect(genRes.status).toBe('complete');

    const http = new HttpSource({
      baseUrl: 'http://localhost:8000',
      fetch: (async () => new Response('{}')) as typeof fetch,
      eventSource: null,
    });
    expect(http.getExportUrl('rivet-1', 'bom.csv', 2)).toBe(
      'http://localhost:8000/api/projects/rivet-1/exports/bom.csv?revision=2',
    );
  });

  it('validates the saved engine-sourced snapshot (catalog v1.2: 19 catalog items, 17 components, 20 wires) and skips rendering visible:false accessories', () => {
    const catalog = getSourcedCatalog();
    const plan = getSourcedRoverPlan();

    expect(catalog).toHaveLength(19);
    expect(plan.build_id).toBe(SOURCED_ROVER_BUILD_ID);
    expect(plan.revision).toBe(1);
    expect(plan.provenance.catalog_version).toBe('catalog-v1.2-2026-10-24');
    expect(plan.components).toHaveLength(17);
    expect(plan.connections).toHaveLength(20);
    expect(plan.assembly_steps).toHaveLength(11);
    expect(checkPlanIntegrity(plan, catalog)).toEqual([]);

    // Issue #32 default rover: needs_review with no FAIL; the blocking findings are the
    // undocumented TT motor fit in the Shadow Chassis, and the BOM is fully priced.
    expect(plan.status).toBe('needs_review');
    expect(plan.verification.findings.filter((f) => f.result === 'FAIL')).toEqual([]);
    const blocking = plan.verification.findings.filter((f) => f.severity === 'blocking' && f.result !== 'PASS');
    expect(blocking.map((f) => `${f.rule_id}:${f.result}`)).toEqual([
      'mechanical.fit_evidence:UNKNOWN',
      'mechanical.fit_evidence:UNKNOWN',
    ]);
    expect(plan.bom).toMatchObject({ currency: 'USD', known_subtotal_amount: '110.80', total_status: 'complete' });
    expect(summarizeBom(plan).totalLabel).toBe('Total');

    // Accessories (accessory-1..6) carry render_overrides.visible = false
    const accessories = plan.components.filter((c) => c.render_overrides?.visible === false);
    expect(accessories).toHaveLength(6);
    for (const acc of accessories) {
      expect(normalizeVisibility(undefined, acc.render_overrides)).toBe('hidden');
    }

    // computeAssemblyView marks visible:false accessories as hidden in all modes
    const dims = buildDimensionsByCatalogId(catalog);
    for (const mode of ['assembled', 'exploded', 'step'] as const) {
      const view = computeAssemblyView(plan, { mode, step: 6, progress: 1, dimensionsByCatalogId: dims });
      for (const acc of accessories) {
        expect(view.byInstanceId[acc.instance_id].visibility).toBe('hidden');
        expect(view.byInstanceId[acc.instance_id].opacity).toBe(0);
      }
    }

    // computePlanBoundsMm skips visible:false accessories (so the 914mm USB cable does not inflate bounds)
    const bounds = computePlanBoundsMm(plan, catalog);
    expect(bounds).toBeDefined();
    expect(bounds!.max[2] - bounds!.min[2]).toBeLessThan(260);

    // buildWiringLayout routes all 20 electrical connections from B's real netlist with 0 rejected
    const wiringLayout = buildWiringLayout(
      {
        build_id: plan.build_id,
        revision: plan.revision,
        components: plan.components,
        connections: plan.connections.map((c) => ({
          connection_id: c.connection_id,
          kind: c.kind,
          from: { instance_id: c.from.instance_id, port_id: c.from.port_id ?? '' },
          to: { instance_id: c.to.instance_id, port_id: c.to.port_id ?? '' },
          net_name: c.net_name ?? null,
          notes: c.notes ?? null,
        })),
      },
      catalog as unknown as readonly WiringCatalogComponent[],
    );
    expect(wiringLayout.counts.electrical_connections).toBe(20);
    expect(wiringLayout.counts.drawn).toBe(20);
    expect(wiringLayout.counts.rejected).toBe(0);
  });

  it('labels the engine-sourced snapshot a Saved demo build with its capture time, and keeps the synthetic example synthetic', async () => {
    const catalog = getSourcedCatalog();
    const plan = getSourcedRoverPlan();

    // Captured by scripts/capture_saved_example.py: stamped fixture, capture note names the engine run time.
    expect(plan.provenance.generation_mode).toBe('fixture');
    expect(plan.created_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    expect(plan.provenance.notes[0]).toMatch(
      new RegExp(`^Saved demo build captured ${plan.created_at} by scripts/capture_saved_example\\.py .*not a live generation$`),
    );
    expect(isSyntheticPlan(plan, catalog)).toBe(false);
    // The launcher's fallback summary must not drift from the snapshot.
    expect(DEFAULT_SAVED_EXAMPLES.find((e) => e.example_id === SOURCED_ROVER_BUILD_ID)?.status).toBe(plan.status);
    expect(DEFAULT_SAVED_EXAMPLES.find((e) => e.example_id === SYNTHETIC_ROVER_BUILD_ID)?.status).toBe(
      getSyntheticRoverPlan().status,
    );

    const captured = `${plan.created_at.slice(0, 10)} ${plan.created_at.slice(11, 16)} UTC`;
    const trust = describeBuildTrust(plan, 'fixture', catalog);
    expect(trust).toMatchObject({
      label: SAVED_BUILD_LABEL,
      isSynthetic: false,
      isSaved: true,
      capturedAt: plan.created_at,
      canDisplayAsVerified: false,
    });
    expect(trust.reasons[0]).toBe(`Captured ${captured}`);
    expect(trust.reasons).toContain('Sourced catalog parts, loaded from a saved build, not a live generation');
    expect(trust.reasons.join(' ')).not.toMatch(/synthetic/i);

    // The synthetic example keeps its synthetic label and has no capture time.
    const synthetic = describeBuildTrust(getSyntheticRoverPlan(), 'fixture', getSyntheticCatalog());
    expect(synthetic).toMatchObject({ label: SAVED_SYNTHETIC_EXAMPLE_LABEL, isSynthetic: true, capturedAt: null });
    expect(synthetic.reasons).toContain('Components are synthetic placeholders, not sourced parts');

    // The same sourced plan arriving over HTTP as live or fallback output is never called saved.
    const asMode = (mode: BuildPlan['provenance']['generation_mode']): BuildPlan => ({
      ...plan,
      provenance: { ...plan.provenance, generation_mode: mode },
    });
    expect(describeBuildTrust(asMode('live'), 'http', catalog)).toMatchObject({ label: 'Live generation', isSaved: false, capturedAt: null });
    expect(describeBuildTrust(asMode('fallback'), 'http', catalog)).toMatchObject({ label: 'Fallback output', isSaved: false, capturedAt: null });

    // Revision labels and fixture edit findings name the build that is open.
    const sourcedSource = createCombinedFixtureSource(SOURCED_ROVER_BUILD_ID);
    expect(sourcedSource.label).toBe(SAVED_BUILD_LABEL);
    expect((await sourcedSource.listRevisions(SOURCED_ROVER_BUILD_ID)).map((r) => r.label)).toEqual([SAVED_BUILD_LABEL]);
    const edit = await sourcedSource.edit(SOURCED_ROVER_BUILD_ID, { base_revision: 1, instruction: 'Raise the sensor' });
    expect(edit.accepted).toBe(false);
    expect(edit.finding?.message).toMatch(/^Saved demo build: edits cannot be validated in fixture mode/);
    const syntheticSource = createCombinedFixtureSource();
    expect(syntheticSource.label).toBe(SAVED_SYNTHETIC_EXAMPLE_LABEL);
    expect((await syntheticSource.listRevisions(SYNTHETIC_ROVER_BUILD_ID)).map((r) => r.label)).toEqual([
      SAVED_SYNTHETIC_EXAMPLE_LABEL,
    ]);
  });

  it('routes browser HttpSource calls through the same-origin /api proxy (baseUrl: "") when NEXT_PUBLIC_RIVET_USE_FIXTURES=false', () => {
    vi.stubEnv('NEXT_PUBLIC_RIVET_USE_FIXTURES', 'false');
    vi.stubEnv('NEXT_PUBLIC_RIVET_API_URL', '');
    const { result } = renderHook(() => useStudioPlanStore());
    expect(result.current.sourceMode).toBe('http');
    expect(result.current.dataSource).toBeInstanceOf(HttpSource);
    expect((result.current.dataSource as HttpSource).baseUrl).toBe('');
    expect(result.current.dataSource.getExportUrl?.('rivet-1', 'bom.csv', 1)).toBe(
      '/api/projects/rivet-1/exports/bom.csv?revision=1',
    );
  });

  it('discards deferred in-flight loadBuild and startGeneration responses after switching sourceMode', async () => {
    let resolveDeferredBuild!: (value: BuildPlan) => void;
    const deferredBuildPromise = new Promise<BuildPlan>((resolve) => {
      resolveDeferredBuild = resolve;
    });

    const staleHttpPlan = getSyntheticRoverPlan();
    staleHttpPlan.build_id = 'rivet-stale-http-build';
    staleHttpPlan.revision = 9;

    const fakeHttpSource: RivetDataSource = {
      mode: 'http',
      getCatalog: async () => getSyntheticCatalog(),
      getBuild: () => deferredBuildPromise,
      generate: async () => ({ job_id: 'job-http-1', status: 'running', build_id: null }),
      edit: async () => ({ accepted: false, build_id: 'rivet-stale-http-build' }),
      getJob: async () => ({
        job_id: 'job-http-1',
        status: 'running',
        stage: 'assembly',
        progress: null,
      }),
      subscribeToJob: () => ({ transport: 'sse', close: () => {} }),
    };

    const { result } = renderHook(() =>
      useStudioPlanStore({ initialDataSource: fakeHttpSource }),
    );

    // Start an in-flight HTTP loadBuild that hasn't resolved yet
    let pendingLoad!: Promise<void>;
    act(() => {
      pendingLoad = result.current.loadBuild('rivet-stale-http-build', 9);
    });

    // Switch to Fixture Mode while the HTTP request is still in flight
    await act(async () => {
      await result.current.setSourceMode('fixture');
    });
    expect(result.current.sourceMode).toBe('fixture');
    expect(result.current.plan.build_id).toBe(SYNTHETIC_ROVER_BUILD_ID);

    // Now resolve the old HTTP getBuild — it must be discarded and never overwrite the fixture plan
    await act(async () => {
      resolveDeferredBuild(staleHttpPlan);
      await pendingLoad;
    });
    expect(result.current.sourceMode).toBe('fixture');
    expect(result.current.plan.build_id).toBe(SYNTHETIC_ROVER_BUILD_ID);
    expect(result.current.plan.revision).toBe(1);
  });

  it('pairs loaded saved snapshots with an owning FixtureSource, labels trust as Saved demo build, and handles edits without BUILD_NOT_FOUND', async () => {
    const { result } = renderHook(() => useStudioPlanStore());

    // Load the sourced engine saved snapshot in default Fixture Mode
    await act(async () => {
      await result.current.loadSavedExample(SOURCED_ROVER_BUILD_ID);
    });
    expect(result.current.plan.build_id).toBe(SOURCED_ROVER_BUILD_ID);
    expect(result.current.sourceMode).toBe('fixture');
    expect(result.current.trust.label).toBe(SAVED_BUILD_LABEL);
    expect(result.current.trust.isSaved).toBe(true);
    expect(result.current.trust.capturedAt).toBe(result.current.plan.created_at);
    expect(result.current.trust.canDisplayAsVerified).toBe(false);
    expect(result.current.revisions.map((r) => r.label)).toEqual([SAVED_BUILD_LABEL]);
    expect(result.current.dataSource.getExportUrl?.(SOURCED_ROVER_BUILD_ID, 'bom.csv', 1)).toBeNull();

    // Submitting an edit against the loaded sourced snapshot uses the owning FixtureSource (no BUILD_NOT_FOUND)
    let editRes: Awaited<ReturnType<typeof result.current.submitEdit>> = null;
    await act(async () => {
      editRes = await result.current.submitEdit('Increase obstacle stop distance to 0.40 m', {
        op: 'set_behavior_parameter',
        name: 'obstacle_stop_distance_m',
        value: 0.4,
      });
    });
    expect(result.current.editError).toBeNull();
    expect(editRes).not.toBeNull();
    expect(editRes!.accepted).toBe(false);
    expect(editRes!.finding?.rule_id).toBe('fixture.edits_require_live_engine');

    // Also verify when starting from Live API Mode: loading a saved example switches to the owning FixtureSource
    await act(async () => {
      await result.current.setSourceMode('http');
    });
    expect(result.current.sourceMode).toBe('http');

    await act(async () => {
      await result.current.loadSavedExample(SOURCED_ROVER_BUILD_ID);
    });
    expect(result.current.sourceMode).toBe('fixture');
    expect(result.current.dataSource.mode).toBe('fixture');
    expect(result.current.trust.label).toBe(SAVED_BUILD_LABEL);
    expect(result.current.dataSource.getExportUrl?.(SOURCED_ROVER_BUILD_ID, 'bom.csv', 1)).toBeNull();
  });

  it("clears editPending after an accepted edit's revision reload and supports consecutive edits", async () => {
    const rev1 = getSyntheticRoverPlan();
    const rev2: BuildPlan = structuredClone(rev1);
    rev2.revision = 2;
    const rev3: BuildPlan = structuredClone(rev1);
    rev3.revision = 3;

    let currentRevision = 1;
    const plansByRevision: Record<number, BuildPlan> = { 1: rev1, 2: rev2, 3: rev3 };

    const fakeHttpSource: RivetDataSource = {
      mode: 'http',
      getCatalog: async () => getSyntheticCatalog(),
      getBuild: async (_buildId: string, revision?: number) =>
        revision !== undefined ? plansByRevision[revision] : plansByRevision[currentRevision],
      generate: async () => ({ job_id: 'job-1', status: 'complete', build_id: rev1.build_id }),
      edit: async (buildId: string, request: { base_revision: number }) => {
        currentRevision = request.base_revision + 1;
        return {
          accepted: true,
          build_id: buildId,
          revision: currentRevision,
        };
      },
      getJob: async () => ({
        job_id: 'job-1',
        status: 'complete',
        stage: 'complete',
        progress: null,
        build_id: rev1.build_id,
        revision: currentRevision,
      }),
      listRevisions: async () =>
        Array.from({ length: currentRevision }, (_, i) => {
          const rev = plansByRevision[i + 1];
          return {
            revision: rev.revision,
            created_at: rev.created_at,
            status: rev.status,
            title: rev.title,
          };
        }),
      subscribeToJob: () => ({ transport: 'sse', close: () => {} }),
    };

    const { result } = renderHook(() =>
      useStudioPlanStore({ initialDataSource: fakeHttpSource }),
    );

    await act(async () => {
      await result.current.loadBuild(rev1.build_id, 1);
    });
    expect(result.current.plan.revision).toBe(1);

    // First accepted edit: editPending must be cleared after revision reload completes
    await act(async () => {
      await result.current.submitEdit('Change chassis color to blue', {
        op: 'change_appearance_color',
        instance_id: 'chassis-1',
        color: '#2563EB',
      });
    });
    expect(result.current.editPending).toBe(false);
    expect(result.current.editError).toBeNull();
    expect(result.current.lastEditResponse?.accepted).toBe(true);
    expect(result.current.plan.revision).toBe(2);

    // A second consecutive accepted edit must also complete and clear editPending
    await act(async () => {
      await result.current.submitEdit('Increase obstacle stop distance to 0.40 m', {
        op: 'set_behavior_parameter',
        name: 'obstacle_stop_distance_m',
        value: 0.4,
      });
    });
    expect(result.current.editPending).toBe(false);
    expect(result.current.editError).toBeNull();
    expect(result.current.lastEditResponse?.accepted).toBe(true);
    expect(result.current.plan.revision).toBe(3);
  });

  it('clears editPending when setSourceMode cancels an in-flight edit', async () => {
    let resolveDeferredEdit!: (value: { accepted: boolean; build_id: string; revision: number }) => void;
    const deferredEditPromise = new Promise<{ accepted: boolean; build_id: string; revision: number }>(
      (resolve) => {
        resolveDeferredEdit = resolve;
      },
    );

    const rev1 = getSyntheticRoverPlan();
    const rev2: BuildPlan = structuredClone(rev1);
    rev2.revision = 2;

    const fakeHttpSource: RivetDataSource = {
      mode: 'http',
      getCatalog: async () => getSyntheticCatalog(),
      getBuild: async (buildId: string, revision?: number) => (revision === 2 ? rev2 : rev1),
      generate: async () => ({ job_id: 'job-1', status: 'complete', build_id: rev1.build_id }),
      edit: () => deferredEditPromise,
      getJob: async () => ({
        job_id: 'job-1',
        status: 'complete',
        stage: 'complete',
        progress: null,
        build_id: rev1.build_id,
        revision: 1,
      }),
      subscribeToJob: () => ({ transport: 'sse', close: () => {} }),
    };

    const { result } = renderHook(() =>
      useStudioPlanStore({ initialDataSource: fakeHttpSource }),
    );

    await act(async () => {
      await result.current.loadBuild(rev1.build_id, 1);
    });

    // Start an edit, but never resolve it immediately
    let pendingEdit!: ReturnType<typeof result.current.submitEdit>;
    act(() => {
      pendingEdit = result.current.submitEdit('Change chassis color', {
        op: 'change_appearance_color',
        instance_id: 'chassis-1',
        color: '#DC2626',
      });
    });
    expect(result.current.editPending).toBe(true);

    // Switching source mode cancels the in-flight edit and clears editPending
    await act(async () => {
      await result.current.setSourceMode('fixture');
    });
    expect(result.current.editPending).toBe(false);

    // Resolve the abandoned HTTP edit promise; it must be silently discarded
    await act(async () => {
      resolveDeferredEdit({ accepted: true, build_id: rev1.build_id, revision: 2 });
      await pendingEdit;
    });
    expect(result.current.editPending).toBe(false);
    expect(result.current.plan.revision).toBe(1);
    expect(result.current.sourceMode).toBe('fixture');
  });
});
