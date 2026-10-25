import { describe, expect, it } from 'vitest';
import { getSourcedCatalog, getSourcedRoverPlan, getSyntheticCatalog, getSyntheticRoverPlan } from '../src/lib/fixtures';
import { blockers, buyLines, groupParts, isBlocking, partGroup, partRows, ruleTitle, specRows } from '../src/lib/flow/derive';
import { advance, isUnlocked, nextStep, stepIndex } from '../src/lib/flow/steps';
import conceptPlan from '../src/lib/rivet/fixtures/concept-quadcopter-v1.json';
import type { BuildPlan } from '../src/lib/rivet/types';

describe('step rules', () => {
  it('keeps the five steps in order and ends at done', () => {
    expect(['review', 'parts', 'wiring', 'buy', 'build', 'done'].map((s) => stepIndex(s as never))).toEqual([0, 1, 2, 3, 4, 5]);
    expect(nextStep('wiring')).toBe('buy');
    expect(nextStep('done')).toBe('done');
  });

  it('unlocks later steps in order and never moves progress back', () => {
    expect(isUnlocked('parts', 'review')).toBe(false);
    expect(isUnlocked('review', 'buy')).toBe(true);
    expect(advance('buy', 'parts')).toBe('buy');
    expect(advance('parts', 'wiring')).toBe('wiring');
  });
});

describe('derivations on the saved rovers', () => {
  const plan = getSourcedRoverPlan();
  const catalog = getSourcedCatalog();

  it('groups every visible part, and no group is empty', () => {
    const rows = partRows(plan, catalog);
    expect(rows.length).toBeGreaterThan(5);
    const groups = groupParts(rows);
    expect(groups.flatMap((g) => g.rows)).toHaveLength(rows.length);
    expect(groups.every((g) => g.rows.length > 0)).toBe(true);
    expect(partGroup('chassis')).toBe('frame');
    expect(partGroup('sensor')).toBe('sensing');
  });

  it('shows only failing or safety checks as blockers', () => {
    for (const f of blockers(plan)) expect(f.result).not.toBe('PASS');
    expect(isBlocking({ rule_id: 'x.y', result: 'WARN', severity: 'advisory', affected_instance_ids: [], message: '', evidence_urls: [] })).toBe(false);
    expect(isBlocking({ rule_id: 'safety.lipo', result: 'WARN', severity: 'advisory', affected_instance_ids: [], message: '', evidence_urls: [] })).toBe(true);
    expect(ruleTitle('power.motor_current_budget')).toBe('Motor current budget');
  });

  it('never invents a spec value: missing values are null with no source tag', () => {
    const rows = specRows(null);
    expect(rows.every((r) => r.value === null && r.source === null)).toBe(true);
    for (const r of specRows(catalog[0]!)) if (r.value === null) expect(r.source).toBeNull();
  });

  it('only offers verified product listings as buy links', () => {
    const lines = buyLines(plan, catalog);
    expect(lines.length).toBe(plan.bom.items.length);
    for (const line of lines) {
      const item = plan.bom.items.find((i) => i.catalog_id === line.catalogId)!;
      if (item.link_status !== 'verified_product') expect(line.url).toBeNull();
    }
    const synthetic = buyLines(getSyntheticRoverPlan(), getSyntheticCatalog());
    expect(synthetic.every((l) => l.unitPrice === null || Number.isFinite(l.unitPrice))).toBe(true);
  });

  it('links the hand-picked parts of a concept as suggestions, never as verified listings', () => {
    const concept = conceptPlan as unknown as BuildPlan;
    const lines = buyLines(concept, concept.concept_catalog ?? []);
    const suggested = lines.filter((l) => l.suggested);
    expect(suggested.map((l) => l.catalogId)).toEqual(expect.arrayContaining(['concept.flight-controller', 'concept.esc', 'concept.motor']));
    expect(suggested.every((l) => l.url?.startsWith('https://') && l.unitPrice !== null)).toBe(true);
    expect(lines.find((l) => l.catalogId === 'concept.body')?.url).toBeNull();
    // An engineered plan's manufacturer references stay unlinked.
    expect(buyLines(plan, catalog).some((l) => l.suggested)).toBe(false);
  });
});
