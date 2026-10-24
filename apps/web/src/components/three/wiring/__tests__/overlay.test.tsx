import ReactThreeTestRenderer from '@react-three/test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { roverPlan, seedCatalog } from '../__fixtures__';
import { APPROXIMATE_WIRING_TEXT, HIGHLIGHT_OBJECT_PREFIX, WIRE_OBJECT_PREFIX } from '../constants';
import { buildWiringLayout } from '../layout';
import type { Mesh, MeshStandardMaterial } from 'three';
import type { WiringPlanInput } from '../types';
import { WiringOverlay, type WiringOverlayProps } from '../WiringOverlay';
import { WireLabel, WiringStatusPanel, describeWire } from '../WiringStatusPanel';

async function mount(props: Partial<WiringOverlayProps> = {}) {
  return ReactThreeTestRenderer.create(
    <WiringOverlay plan={roverPlan()} catalog={seedCatalog()} showLabels={false} showStatus={false} {...props} />,
  );
}

const namesWith = (r: Awaited<ReturnType<typeof mount>>, prefix: string) =>
  r.scene.findAll((n) => typeof n.props.name === 'string' && n.props.name.startsWith(prefix)).map((n) => n.props.name as string);

describe('WiringOverlay (R3F)', () => {
  it('renders one tube mesh per drawable electrical connection', async () => {
    const r = await mount();
    expect(namesWith(r, WIRE_OBJECT_PREFIX).sort()).toEqual(['wire:wire-motor-pwm-synthetic', 'wire:wire-sensor-i2c-synthetic']);
    const group = r.scene.find((n) => n.props.name === 'wiring-overlay');
    expect(group.instance.userData.approximate).toBe(true);
    await r.unmount();
  });

  it('renders nothing when hidden', async () => {
    const r = await mount({ visible: false });
    expect(namesWith(r, WIRE_OBJECT_PREFIX)).toEqual([]);
    await r.unmount();
  });

  it('applies the filter', async () => {
    const r = await mount({ filter: { signals: ['i2c'] } });
    expect(namesWith(r, WIRE_OBJECT_PREFIX)).toEqual(['wire:wire-sensor-i2c-synthetic']);
    await r.unmount();
  });

  it('skips unresolved connections and reports structured warnings', async () => {
    const plan = roverPlan();
    const broken: WiringPlanInput = { ...plan, components: plan.components.filter((c) => c.instance_id !== 'driver-1') };
    const onWarnings = vi.fn();
    const r = await mount({ plan: broken, onWarnings });
    expect(namesWith(r, WIRE_OBJECT_PREFIX)).toEqual(['wire:wire-sensor-i2c-synthetic']);
    expect(onWarnings).toHaveBeenCalledWith([expect.objectContaining({ code: 'UNKNOWN_INSTANCE', instance_id: 'driver-1' })], expect.anything());
    await r.unmount();
  });

  it('hover reports the wire and outlines both connected components', async () => {
    const onWireHover = vi.fn();
    const onHighlightInstances = vi.fn();
    const r = await mount({ onWireHover, onHighlightInstances });
    const mesh = r.scene.find((n) => n.props.name === 'wire:wire-motor-pwm-synthetic');
    await r.fireEvent(mesh, 'onPointerOver');
    expect(onWireHover).toHaveBeenLastCalledWith(expect.objectContaining({ connection_id: 'wire-motor-pwm-synthetic' }));
    expect(onHighlightInstances).toHaveBeenLastCalledWith(['controller-1', 'driver-1']);
    expect(namesWith(r, HIGHLIGHT_OBJECT_PREFIX).sort()).toEqual(['wire-highlight:controller-1', 'wire-highlight:driver-1']);
    await r.fireEvent(mesh, 'onPointerOut');
    expect(onWireHover).toHaveBeenLastCalledWith(null);
    expect(namesWith(r, HIGHLIGHT_OBJECT_PREFIX)).toEqual([]);
    await r.unmount();
  });

  it('supports a controlled active wire without highlight', async () => {
    const r = await mount({ activeConnectionId: 'wire-sensor-i2c-synthetic', highlightConnected: false });
    expect(namesWith(r, HIGHLIGHT_OBJECT_PREFIX)).toEqual([]);
    const active = r.scene.find((n) => n.props.name === 'wire:wire-sensor-i2c-synthetic');
    const other = r.scene.find((n) => n.props.name === 'wire:wire-motor-pwm-synthetic');
    const materialOf = (n: typeof active) => (n.instance as Mesh).material as MeshStandardMaterial;
    expect(materialOf(active).emissiveIntensity).toBeGreaterThan(0);
    expect(materialOf(other).opacity).toBeLessThan(1);
    await r.unmount();
  });
});

describe('WiringOverlay text layers', () => {
  it('mounts labels and the status panel without errors', async () => {
    const r = await mount({ showLabels: true, showStatus: true, activeConnectionId: 'wire-motor-pwm-synthetic' });
    expect(namesWith(r, WIRE_OBJECT_PREFIX)).toHaveLength(2);
    await r.unmount();
  });
});

describe('wiring text', () => {
  const layout = buildWiringLayout(roverPlan(), seedCatalog());

  it('status panel shows the approximate flag, counts and warnings', () => {
    const plan = roverPlan();
    const broken = buildWiringLayout({ ...plan, components: plan.components.filter((c) => c.instance_id !== 'sensor-1') }, seedCatalog());
    const html = renderToStaticMarkup(<WiringStatusPanel layout={broken} />);
    expect(html).toContain(APPROXIMATE_WIRING_TEXT);
    expect(html).toContain('1 of 2 electrical connections drawn');
    expect(html).toContain('UNKNOWN_INSTANCE');
    expect(html).toContain('wire-sensor-i2c-synthetic');
  });

  it('wire label names instances, ports, signal and approximation', () => {
    expect(describeWire(layout.wires[0]!)).toEqual([
      'controller-1 · gpio18 → driver-1 · pwm_a',
      'Signal: digital_output → pwm_input',
      'Net: DEMO_PWM_NOT_VERIFIED',
      `${APPROXIMATE_WIRING_TEXT}: schematic anchors`,
    ]);
    expect(renderToStaticMarkup(<WireLabel wire={layout.wires[1]!} />)).toContain('controller-1 · sda → sensor-1 · sda');
  });
});
