import { describe, expect, it } from 'vitest';
import { roverPlan, seedCatalog } from '../__fixtures__';
import { APPROXIMATE_WIRING_TEXT, WIRING_IS_APPROXIMATE_BY_DEFAULT } from '../constants';
import { buildWiringLayout } from '../layout';
import type { WiringConnection, WiringPlanInput } from '../types';

const wire = (id: string, from: [string, string], to: [string, string], kind = 'electrical'): WiringConnection => ({
  connection_id: id,
  kind,
  from: { instance_id: from[0], port_id: from[1] },
  to: { instance_id: to[0], port_id: to[1] },
  net_name: null,
});

const withConnections = (connections: WiringConnection[], plan: WiringPlanInput = roverPlan()): WiringPlanInput => ({
  ...plan,
  connections,
});

describe('buildWiringLayout: good fixture', () => {
  const layout = buildWiringLayout(roverPlan(), seedCatalog());

  it('draws one wire per electrical connection with no warnings', () => {
    expect(layout.counts).toEqual({ electrical_connections: 2, drawn: 2, rejected: 0, non_electrical_skipped: 0 });
    expect(layout.wires.map((w) => w.connection_id)).toEqual(['wire-motor-pwm-synthetic', 'wire-sensor-i2c-synthetic']);
    expect(layout.warnings).toEqual([]);
    expect(layout.build_id).toBe('rivet-synthetic-rover-fixture');
  });

  it('labels the result approximate because v1 ports carry no positions', () => {
    expect(WIRING_IS_APPROXIMATE_BY_DEFAULT).toBe(true);
    expect(APPROXIMATE_WIRING_TEXT).toBe('Approximate wiring visualization');
    expect(layout.approximate).toBe(true);
    for (const w of layout.wires) {
      expect(w.approximate).toBe(true);
      expect(w.from.source).toBe('schematic_bounds');
      expect(w.to.source).toBe('schematic_bounds');
    }
  });

  it('carries instance ids, port ids and signal types for labels', () => {
    const pwm = layout.wires[0]!;
    expect(pwm.from).toMatchObject({ instance_id: 'controller-1', port_id: 'gpio18', signal: 'digital_output', catalog_id: 'demo.esp32' });
    expect(pwm.to).toMatchObject({ instance_id: 'driver-1', port_id: 'pwm_a', signal: 'pwm_input' });
    expect(pwm.signal_label).toBe('digital_output → pwm_input');
    expect(pwm.net_name).toBe('DEMO_PWM_NOT_VERIFIED');
    expect(layout.wires[1]!.signal_label).toBe('i2c');
  });

  it('anchors on the top face of the component bounds at a deterministic port slot', () => {
    // demo.esp32: 55 x 8 x 28 mm, gpio18 is port 0 of 3; controller-1 at [-25, 29, -15].
    expect(layout.wires[0]!.from.position_mm).toEqual([-25 - 27.5 + 55 / 4, 29 + 4 + 1, -15]);
    const [start, , , end] = layout.wires[0]!.control_points_mm;
    expect(start).toEqual(layout.wires[0]!.from.position_mm);
    expect(end).toEqual(layout.wires[0]!.to.position_mm);
  });
});

describe('buildWiringLayout: missing and unknown references', () => {
  it('does not draw a wire to a missing instance and reports it', () => {
    const plan = roverPlan();
    const layout = buildWiringLayout({ ...plan, components: plan.components.filter((c) => c.instance_id !== 'driver-1') }, seedCatalog());
    expect(layout.counts).toMatchObject({ electrical_connections: 2, drawn: 1, rejected: 1 });
    expect(layout.wires.map((w) => w.connection_id)).toEqual(['wire-sensor-i2c-synthetic']);
    expect(layout.warnings).toEqual([
      expect.objectContaining({
        code: 'UNKNOWN_INSTANCE',
        severity: 'blocking',
        wire_drawn: false,
        connection_id: 'wire-motor-pwm-synthetic',
        endpoint: 'to',
        instance_id: 'driver-1',
        port_id: 'pwm_a',
      }),
    ]);
  });

  it('rejects a port that the catalog component does not list', () => {
    const layout = buildWiringLayout(withConnections([wire('w-bad-port', ['controller-1', 'gpio99'], ['driver-1', 'pwm_a'])]), seedCatalog());
    expect(layout.wires).toHaveLength(0);
    expect(layout.warnings).toEqual([
      expect.objectContaining({ code: 'UNKNOWN_PORT', endpoint: 'from', port_id: 'gpio99', catalog_id: 'demo.esp32' }),
    ]);
  });

  it('reports both bad endpoints of one connection', () => {
    const layout = buildWiringLayout(withConnections([wire('w-both', ['ghost-1', 'x'], ['driver-1', 'nope'])]), seedCatalog());
    expect(layout.warnings.map((w) => [w.code, w.endpoint])).toEqual([
      ['UNKNOWN_INSTANCE', 'from'],
      ['UNKNOWN_PORT', 'to'],
    ]);
    expect(layout.counts.rejected).toBe(1);
  });

  it('rejects an instance whose catalog item is missing', () => {
    const catalog = seedCatalog().filter((c) => c.catalog_id !== 'demo.range');
    const layout = buildWiringLayout(roverPlan(), catalog);
    expect(layout.wires.map((w) => w.connection_id)).toEqual(['wire-motor-pwm-synthetic']);
    expect(layout.warnings[0]).toMatchObject({ code: 'UNKNOWN_CATALOG_COMPONENT', instance_id: 'sensor-1', catalog_id: 'demo.range' });
  });

  it('rejects ambiguous duplicate instance ids', () => {
    const plan = roverPlan();
    const dup = { ...plan.components.find((c) => c.instance_id === 'driver-1')!, pose: { position_mm: [0, 0, 0], rotation_deg: [0, 0, 0] } };
    const layout = buildWiringLayout({ ...plan, components: [...plan.components, dup] }, seedCatalog());
    expect(layout.counts.drawn).toBe(1);
    expect(layout.warnings[0]).toMatchObject({ code: 'AMBIGUOUS_INSTANCE', instance_id: 'driver-1' });
  });

  it('rejects all copies of a duplicated connection_id', () => {
    const c = wire('w-dup', ['controller-1', 'sda'], ['sensor-1', 'sda']);
    const layout = buildWiringLayout(withConnections([c, { ...c, to: { instance_id: 'sensor-1', port_id: 'scl' } }]), seedCatalog());
    expect(layout.wires).toHaveLength(0);
    expect(layout.warnings).toEqual([expect.objectContaining({ code: 'DUPLICATE_CONNECTION_ID', connection_id: 'w-dup' })]);
  });

  it('rejects a port connected to itself and an instance with an invalid pose', () => {
    const plan = roverPlan();
    const components = plan.components.map((c) =>
      c.instance_id === 'sensor-1' ? { ...c, pose: { position_mm: [0, Number.NaN, 0], rotation_deg: [0, 0, 0] } } : c,
    );
    const layout = buildWiringLayout(
      { ...plan, components, connections: [wire('w-self', ['controller-1', 'sda'], ['controller-1', 'sda']), wire('w-pose', ['controller-1', 'sda'], ['sensor-1', 'sda'])] },
      seedCatalog(),
    );
    expect(layout.wires).toHaveLength(0);
    expect(layout.warnings.map((w) => w.code).sort()).toEqual(['INVALID_POSE', 'SELF_CONNECTION']);
  });

  it('draws at the pose origin with an advisory warning when bounds are unknown', () => {
    const catalog = seedCatalog().map((c) =>
      c.catalog_id === 'demo.range' ? { ...c, physical: { ...c.physical, dimensions_mm: { x: null, y: 8, z: 16 } } } : c,
    );
    const layout = buildWiringLayout(roverPlan(), catalog);
    expect(layout.counts.drawn).toBe(2);
    const i2c = layout.wires.find((w) => w.connection_id === 'wire-sensor-i2c-synthetic')!;
    expect(i2c.to).toMatchObject({ source: 'pose_origin', approximate: true, position_mm: [0, 35, 81] });
    expect(layout.warnings).toEqual([expect.objectContaining({ code: 'UNKNOWN_BOUNDS', severity: 'advisory', wire_drawn: true })]);
    expect(layout.counts.rejected).toBe(0);
  });

  it('ignores mechanical connections without warnings', () => {
    const plan = roverPlan();
    const layout = buildWiringLayout(
      withConnections([...plan.connections, wire('mech-1', ['chassis-1', 'deck'], ['controller-1', 'base'], 'mechanical')]),
      seedCatalog(),
    );
    expect(layout.counts).toMatchObject({ electrical_connections: 2, drawn: 2, non_electrical_skipped: 1 });
    expect(layout.warnings).toEqual([]);
  });

  it('handles an empty connection list', () => {
    const layout = buildWiringLayout(withConnections([]), seedCatalog());
    expect(layout.wires).toEqual([]);
    expect(layout.approximate).toBe(false);
  });
});

describe('buildWiringLayout: repeated parts, determinism and evidence', () => {
  const motorWires = [
    wire('w-motor-left-pos', ['driver-1', 'motor_a'], ['motor-left-1', 'motor_pos']),
    wire('w-motor-left-neg', ['driver-1', 'motor_a'], ['motor-left-1', 'motor_neg']),
    wire('w-motor-right-pos', ['driver-1', 'motor_a'], ['motor-right-1', 'motor_pos']),
  ];

  it('anchors repeated catalog parts by their own poses', () => {
    const layout = buildWiringLayout(withConnections(motorWires), seedCatalog());
    const left = layout.wires.find((w) => w.connection_id === 'w-motor-left-pos')!.to.position_mm;
    const right = layout.wires.find((w) => w.connection_id === 'w-motor-right-pos')!.to.position_mm;
    // Same local slot (port 0 of 2 on a 65 mm wide motor), different instance poses.
    expect(left).toEqual([-56 - 32.5 + 65 / 3, 20 + 12 + 1, 25]);
    expect(right).toEqual([56 - 32.5 + 65 / 3, 20 + 12 + 1, 25]);
  });

  it('assigns separate lanes to wires between the same pair of parts', () => {
    const layout = buildWiringLayout(withConnections(motorWires), seedCatalog());
    const lanes = Object.fromEntries(layout.wires.map((w) => [w.connection_id, w.lane]));
    expect(lanes).toEqual({ 'w-motor-left-neg': 0, 'w-motor-left-pos': 1, 'w-motor-right-pos': 0 });
    const [a, b] = layout.wires.filter((w) => w.to.instance_id === 'motor-left-1');
    expect(a!.control_points_mm[1]).not.toEqual(b!.control_points_mm[1]);
  });

  it('is independent of input order', () => {
    const plan = withConnections([...roverPlan().connections, ...motorWires]);
    const shuffled = { ...plan, components: plan.components.slice().reverse(), connections: plan.connections.slice().reverse() };
    expect(buildWiringLayout(shuffled, seedCatalog().reverse())).toEqual(buildWiringLayout(plan, seedCatalog()));
  });

  it('applies pose rotation to anchors', () => {
    const plan = roverPlan();
    const components = plan.components.map((c) =>
      c.instance_id === 'controller-1' ? { ...c, pose: { position_mm: [0, 0, 0], rotation_deg: [0, 90, 0] } } : c,
    );
    const [x, y, z] = buildWiringLayout({ ...plan, components }, seedCatalog()).wires[0]!.from.position_mm;
    // Local x = -13.75 rotated +90° about y maps onto +z.
    expect(x).toBeCloseTo(0, 9);
    expect(y).toBeCloseTo(5, 9);
    expect(z).toBeCloseTo(13.75, 9);
  });

  it('uses a catalog port position only as precise when bounds are verified', () => {
    const catalog = seedCatalog().map((c) =>
      c.catalog_id === 'demo.esp32'
        ? { ...c, ports: c.ports.map((p) => (p.port_id === 'gpio18' ? { ...p, position_mm: [10, 4, -3] } : p)) }
        : c,
    );
    const unverified = buildWiringLayout(roverPlan(), catalog).wires[0]!.from;
    expect(unverified).toMatchObject({ source: 'catalog_port_position_unverified', approximate: true, position_mm: [-15, 33, -18] });

    const verified = catalog.map((c) =>
      c.catalog_id === 'demo.esp32' ? { ...c, physical: { ...c.physical, bounds_verified: true } } : c,
    );
    const plan = withConnections([wire('w-precise', ['controller-1', 'gpio18'], ['controller-1', 'sda'])]);
    const both = buildWiringLayout(plan, verified.map((c) =>
      c.catalog_id === 'demo.esp32'
        ? { ...c, ports: c.ports.map((p) => ({ ...p, position_mm: p.port_id === 'sda' ? [0, 4, 0] : p.position_mm })) }
        : c,
    ));
    expect(both.wires[0]!.from.source).toBe('catalog_port_position');
    expect(both.wires[0]!.approximate).toBe(false);
    expect(both.approximate).toBe(false);
  });

  it('scales to many wires with exact counts', () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      wire(`w-${String(i).padStart(2, '0')}`, ['controller-1', i % 2 ? 'sda' : 'scl'], ['sensor-1', i % 2 ? 'sda' : 'scl']),
    );
    const layout = buildWiringLayout(withConnections(many), seedCatalog());
    expect(layout.counts).toMatchObject({ electrical_connections: 40, drawn: 40, rejected: 0 });
    expect(new Set(layout.wires.map((w) => w.lane)).size).toBe(40);
  });
});
