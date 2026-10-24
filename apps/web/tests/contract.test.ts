import { describe, expect, it } from 'vitest';
import {
  FixtureSource,
  HttpSource,
  SYNTHETIC_ROVER_BUILD_ID,
  assertPlanIntegrity,
  checkPlanIntegrity,
  describeBuildTrust,
  summarizeBom,
} from '../src/lib/contracts';
import {
  DEFAULT_SAVED_EXAMPLES,
  getSyntheticCatalog,
  getSyntheticRoverIntent,
  getSyntheticRoverPlan,
} from '../src/lib/fixtures';
import { buildDimensionsByCatalogId, computePlanBoundsMm } from '../src/lib/geometry';
import { buildBomCsvClientSide } from '../src/lib/plan-store';

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
    expect(DEFAULT_SAVED_EXAMPLES[0].example_id).toBe(SYNTHETIC_ROVER_BUILD_ID);

    const revisions = await fixture.listRevisions(SYNTHETIC_ROVER_BUILD_ID);
    expect(revisions).toHaveLength(1);
    expect(revisions[0].revision).toBe(1);

    const estelle = await fixture.getEstelleStatus();
    expect(estelle.status).toBe('unavailable');
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
});
