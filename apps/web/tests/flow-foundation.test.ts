import { describe, expect, it } from 'vitest';
import { getSourcedCatalog, getSourcedRoverPlan, getSyntheticCatalog, getSyntheticRoverPlan } from '../src/lib/fixtures';
import {
  blockers,
  buyLines,
  checkFamily,
  groupParts,
  isBlocking,
  PART_GROUP_LABEL,
  partGroup,
  partNicknames,
  partRows,
  pinPurpose,
  plainCheck,
  plainInstructions,
  ruleTitle,
  signalPlain,
  specRows,
  wirePurpose,
} from '../src/lib/flow/derive';
import { STEPS, advance, isUnlocked, nextStep, stepIndex } from '../src/lib/flow/steps';
import conceptPlan from '../src/lib/rivet/fixtures/concept-quadcopter-v1.json';
import type { BuildPlan } from '../src/lib/rivet/types';

describe('step rules', () => {
  it('keeps the five steps in order and ends at done', () => {
    expect(['review', 'parts', 'wiring', 'buy', 'build', 'done'].map((s) => stepIndex(s as never))).toEqual([0, 1, 2, 3, 4, 5]);
    expect(nextStep('wiring')).toBe('buy');
    expect(nextStep('done')).toBe('done');
  });

  it('uses plain step names', () => {
    expect(STEPS.map((s) => s.label)).toEqual(['Review', 'Parts', 'Wiring & code', 'Buy', 'Build']);
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
    expect(partGroup('motor_driver', 'motor_driver')).toBe('control');
    expect(partGroup('battery_holder', 'motor_power')).toBe('power');
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

  it('recognizes explicitly documented kit contents without treating arbitrary zero prices as included', () => {
    const lines = buyLines(plan, catalog);
    expect(lines.find((l) => l.catalogId === 'caster.sparkfun_shadow_nub')?.included).toBe(true);
    const withoutKit = structuredClone(plan);
    // A kit component without its parent in the order must remain visible as a procurement gap.
    const kitId = catalog.find((c) => c.identity.sku === 'ROB-13301')!.catalog_id;
    withoutKit.bom.items = withoutKit.bom.items.filter((item) => item.catalog_id !== kitId);
    expect(buyLines(withoutKit, catalog).find((l) => l.catalogId === 'caster.sparkfun_shadow_nub')?.included).toBe(false);
    const changed = structuredClone(catalog);
    const board = changed.find((c) => c.catalog_id === 'board.esp32_devkitc_v4_wroom32e')!;
    board.sourcing.price_amount = '0.00';
    board.evidence.notes = ['No price evidence available'];
    expect(buyLines(plan, changed).find((l) => l.catalogId === board.catalog_id)?.included).not.toBe(true);
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

  it('puts batteries in Power and the motor driver with the boards, not with the motors', () => {
    const rows = partRows(plan, catalog);
    const group = (id: string) => rows.find((r) => r.instanceId === id)!.group;
    expect(group('power-motor-1')).toBe('power');
    expect(group('driver-1')).toBe('control');
    expect(group('motor-left-1')).toBe('drive');
    expect(PART_GROUP_LABEL.drive).toBe('Wheels & motors');
    expect(PART_GROUP_LABEL.control).toBe('Brains');
    expect(PART_GROUP_LABEL.hardware).toBe('Wires & small parts');
  });
});

describe('plain language', () => {
  const plan = getSourcedRoverPlan();
  const catalog = getSourcedCatalog();
  const names = partNicknames(plan, catalog);

  it('gives every blocker a plain headline that names the part, never the rule id', () => {
    const titles = blockers(plan).map((f) => plainCheck(f, names).title);
    expect(titles).toEqual(['The left motor may not fit the frame', 'The right motor may not fit the frame']);
    for (const f of blockers(getSyntheticRoverPlan())) {
      const t = plainCheck(f, names).title;
      expect(t).not.toMatch(/synthetic|netlist|fixture|_/i);
    }
    expect(checkFamily('electrical.supply_voltage')).toBe('power');
    expect(checkFamily('mechanical.fit_evidence')).toBe('fit');
    expect(checkFamily('fixture.synthetic_not_sourced')).toBe('example');
    expect(plainCheck({ rule_id: 'x.something_new', result: 'FAIL', severity: 'blocking', affected_instance_ids: [], message: 'm', evidence_urls: [] }).title).toBe(
      'A check needs a closer look',
    );
  });

  it('says what a wire does from its signal kinds, keeping pins out of the headline', () => {
    const pwm = wirePurpose({ name: 'controller board', port: 'gpio25', signal: 'digital_io' }, { name: 'motor driver', port: 'pwma', signal: 'pwm_input' }, 'MOTOR_LEFT_PWM');
    expect(pwm).toBe('Tells the motor driver how fast to spin the left motor');
    expect(wirePurpose({ name: 'controller board', port: 'gpio21', signal: 'digital_io' }, { name: 'distance sensor', port: 'sda', signal: 'i2c_sda', role: 'distance_sensor' })).toBe(
      'Reads distance from the distance sensor',
    );
    expect(wirePurpose({ name: 'controller board', port: 'gnd', signal: 'ground' }, { name: 'motor driver', port: 'gnd', signal: 'ground' })).toMatch(/ground/);
    expect(wirePurpose({ name: 'controller board', port: 'v3v3', signal: 'power_output' }, { name: 'distance sensor', port: 'vin', signal: 'power_in' })).toBe('Powers the distance sensor');
    expect(signalPlain('pwm_input')).toBe('speed signal');
    expect(signalPlain('i2c')).toContain('I2C');
    expect(pinPurpose('motor_right_in2')).toBe('Right motor direction');
  });

  it('swaps part ids in build instructions for everyday names without adding anything', () => {
    const step = plan.assembly_steps.find((s) => s.step === 6)!;
    const plain = plainInstructions(step.instructions, names);
    expect(plain).not.toMatch(/controller-1|driver-1|sensor-1|accessory-\d|MOTOR_LEFT_PWM/);
    expect(plain).toContain("the controller board's gpio25 pin to the motor driver's pwma pin");
    // Every pin named by the engine is still there.
    for (const c of plan.connections.filter((c) => step.instructions.includes(`${c.from.instance_id}.${c.from.port_id}`))) {
      expect(plain).toContain(`${c.from.port_id} pin`);
      expect(plain).toContain(`${c.to.port_id} pin`);
    }
    expect(plainInstructions('No ids here.', names)).toBe('No ids here.');
  });
});

describe('picture handoff from the landing page', () => {
  it('hands the picture to the same draft once, and to no other draft', async () => {
    const { setPendingImage, takePendingImage } = await import('../src/lib/flow/pending-image');
    const file = new File(['x'], 'robot.png', { type: 'image/png' });
    setPendingImage('p_a', file);
    expect(takePendingImage('p_b')).toBeNull();
    expect(takePendingImage('p_a')).toBe(file);
    expect(takePendingImage('p_a')).toBeNull();
  });
});
