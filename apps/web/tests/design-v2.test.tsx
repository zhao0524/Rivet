import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CATALOG_RECIPES, resolveRecipe } from '../src/components/three/parts/recipes';
import { growBounds } from '../src/components/three/generation/GeneratedAssembly';
import { CandidateCompare } from '../src/components/three/generation/CandidateCompare';
import { DesignStart } from '../src/components/studio/generation/DesignStart';
import { latestPreview, mergeDesignEvents, parseDesignBundle, parseDesignEvent } from '../src/lib/rivet/design-v2-source';
import type { DesignCandidate, DesignEvent } from '../src/lib/rivet/design-v2-types';

const occurrence = { instance_id: 'sensor-1', catalog_id: 'sensor.adafruit_vl53l0x_3317', role: 'distance_sensor', pose: { position_mm: [0, 0, 0], rotation_deg: [0, 0, 0] } } as never;

describe('purchased part recipes', () => {
  it('binds the VL53L0X by exact catalog id to the ToF breakout, never the ultrasonic drums', () => {
    expect(CATALOG_RECIPES['sensor.adafruit_vl53l0x_3317']).toBe('tof_sensor');
    const item = { catalog_id: 'sensor.adafruit_vl53l0x_3317', identity: { category: 'distance_sensor', model: 'VL53L0X ToF' }, physical: { dimensions_mm: { x: 21, y: 2.8, z: 18 } } } as never;
    expect(resolveRecipe(occurrence, item)).toBe('tof_sensor');
  });
  it('keeps the twin-transducer visual for parts that are actually ultrasonic', () => {
    const item = { catalog_id: 'sensor.other_hcsr04', identity: { category: 'distance_sensor', model: 'HC-SR04 ultrasonic ranger' }, physical: {} } as never;
    expect(resolveRecipe(occurrence, item)).toBe('ultrasonic_sensor');
    const generic = { catalog_id: 'sensor.unknown_range', identity: { category: 'distance_sensor', model: 'range sensor' }, physical: {} } as never;
    expect(resolveRecipe(occurrence, generic)).toBe('tof_sensor');
  });
});

const event = (id: number, extra: Partial<DesignEvent> = {}): DesignEvent => ({
  schema_version: '2.0', event_id: id, job_id: 'gen-1', timestamp: '2026-10-24T00:00:00Z', stage: 'geometry_preview', actor: 'engineer', status: 'ok', message: 'm',
  candidate_id: 'cand-1', build_id: 'design-1', revision: null, references: [], preview_revision: id, is_partial: true, ...extra,
});

describe('v2 events', () => {
  it('validates snapshots, de-duplicates and orders events, and picks the newest preview', () => {
    const snap = (n: number) => ({ scene_asset_url: `/api/v2/assets/asset-${n}`, part_manifest: [{ body_id: 'deck' }], geometry_digest: 'x', preview_revision: n, is_partial: n < 3 });
    const a = parseDesignEvent(event(2, { snapshot: snap(2) }));
    const b = parseDesignEvent(event(3, { snapshot: snap(3), is_partial: false }));
    let list = mergeDesignEvents([], b, 'gen-1');
    list = mergeDesignEvents(list, a, 'gen-1');
    list = mergeDesignEvents(list, a, 'gen-1');
    list = mergeDesignEvents(list, event(9, { job_id: 'gen-other' }), 'gen-1');
    expect(list.map((e) => e.event_id)).toEqual([2, 3]);
    expect(latestPreview(list, 'cand-1')?.snapshot?.scene_asset_url).toBe('/api/v2/assets/asset-3');
  });
  it('rejects non-asset URLs in events', () => {
    expect(() => parseDesignEvent(event(1, { references: [{ type: 'geometry', id: 'x', url: 'file:///etc/passwd' }] }))).toThrow();
  });
});

describe('frame bounds', () => {
  it('only grow, in 10 mm steps, so new previews do not refit the camera', () => {
    const first = growBounds(null, { min: [-41, 0, -52], max: [40, 33, 51] });
    expect(first).toEqual({ min: [-50, 0, -60], max: [40, 40, 60] });
    expect(growBounds(first, { min: [-20, 0, -10], max: [20, 20, 10] })).toBe(first);
    expect(growBounds(first, { min: [-80, 0, -60], max: [80, 60, 60] }).max).toEqual([80, 60, 60]);
  });
});

const candidate = (id: string, extra: Partial<DesignCandidate> = {}): DesignCandidate => ({
  id, strategy: 'closest_to_reference', status: 'complete', spec: {}, scene_asset_url: '/api/v2/assets/asset-s', part_manifest: [], geometry_digest: id, mechanical: {}, functional: {},
  shots: ['front', 'left', 'back', 'right', 'top', 'perspective'].map((v) => ({ view: v, image_url: `/api/v2/assets/asset-${id}-${v}` })),
  visual: { scores: {}, overall: 7.5, summary: 's', subjective: true, issues: [] }, feasible: true, error: null,
  claims: { visual_similarity: { score: 7.5, subjective: true }, geometric_validity: 'valid', manufacturability: 'pass', electrical: 'not_applicable', firmware: 'not_supported', buildability: 'concept_only' },
  ...extra,
});

describe('candidate comparison', () => {
  it('shows matching renders, subjective scores, separate claims and a working choose action', () => {
    const onChoose = vi.fn();
    render(<CandidateCompare candidates={[candidate('cand-1'), candidate('cand-2'), candidate('cand-3', { status: 'failed', error: { message: 'duplicate' } })]} selectedId="cand-1" recommendedId="cand-1" onChoose={onChoose} />);
    expect(screen.getByAltText('cand-2 perspective render of the generated geometry')).toBeTruthy();
    expect(screen.getByTestId('recommended-badge')).toBeTruthy();
    expect(screen.getByTestId('buildability-cand-2').textContent).toBe('concept only');
    expect(screen.getByRole('alert').textContent).toContain('duplicate');
    fireEvent.click(screen.getByTestId('choose-cand-2'));
    expect(onChoose).toHaveBeenCalledWith(expect.objectContaining({ id: 'cand-2' }));
  });
});

describe('bundle parsing', () => {
  it('accepts critic issues without a body and refuses a missing selected candidate', () => {
    const bundle = {
      schema_version: '2.0', build_id: 'design-1', revision: 1, job_id: 'gen-1', title: 't', created_at: 'now', mode: 'concept_only', status: 'complete',
      candidates: [{ ...candidate('cand-1'), visual: { scores: {}, overall: 5, summary: 's', subjective: true, issues: [{ body_id: null, view: 'front', severity: 'minor', observed: 'o', target: 't', proposed_change: 'p' }] } }],
      references: [], selected_candidate_id: 'cand-1', scene_asset_url: null, assembly: [], distilled: { subject: 's', summary: 's', signature_features: ['a', 'b', 'c'], mechanical_constraints: [], uncertainties: [] },
      provenance: { generation_mode: 'fixture', cached: false, replay_of: null }, budget: { limit_usd: 10, spent_usd: 0, reserved_usd: 0 },
    };
    expect(parseDesignBundle(bundle).selected_candidate_id).toBe('cand-1');
    expect(() => parseDesignBundle({ ...bundle, selected_candidate_id: 'cand-9' })).toThrow();
  });
});

describe('design start', () => {
  it('offers both modes and an explicit cache opt-in, and needs a prompt or image', () => {
    render(<DesignStart />);
    const button = screen.getByTestId('generate-design-v2') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Describe the design'), { target: { value: 'a hummingbird' } });
    expect(button.disabled).toBe(false);
    expect((screen.getByTestId('design-allow-cached') as HTMLInputElement).checked).toBe(false);
    expect(screen.getByTestId('design-mode-select').querySelectorAll('option')).toHaveLength(2);
  });
});
