import { describe, expect, it } from 'vitest';
import { roverPlan, seedCatalog } from '../__fixtures__';
import { availableSignals, connectedInstanceIds, filterWires, wiresForInstances } from '../filter';
import { buildWiringLayout } from '../layout';
import { INITIAL_WIRING_OVERLAY_STATE, wiringOverlayReducer } from '../state';

const { wires } = buildWiringLayout(roverPlan(), seedCatalog());
const ids = (ws: { connection_id: string }[]) => ws.map((w) => w.connection_id);

describe('filterWires', () => {
  it('returns everything without a filter', () => {
    expect(ids(filterWires(wires, null))).toHaveLength(2);
    expect(ids(filterWires(wires, {}))).toHaveLength(2);
  });

  it('filters by signal on either end, instance, connection and net', () => {
    expect(ids(filterWires(wires, { signals: ['pwm_input'] }))).toEqual(['wire-motor-pwm-synthetic']);
    expect(ids(filterWires(wires, { instance_ids: ['sensor-1'] }))).toEqual(['wire-sensor-i2c-synthetic']);
    expect(ids(filterWires(wires, { connection_ids: ['wire-motor-pwm-synthetic'] }))).toEqual(['wire-motor-pwm-synthetic']);
    expect(ids(filterWires(wires, { net_names: ['DEMO_SDA_NOT_VERIFIED'] }))).toEqual(['wire-sensor-i2c-synthetic']);
    expect(ids(filterWires(wires, { signals: ['i2c'], instance_ids: ['driver-1'] }))).toEqual([]);
  });

  it('supports instance selection helpers', () => {
    expect(ids(wiresForInstances(wires, ['controller-1']))).toHaveLength(2);
    expect(connectedInstanceIds(wires[0])).toEqual(['controller-1', 'driver-1']);
    expect(connectedInstanceIds(null)).toEqual([]);
    expect(availableSignals(wires)).toEqual(['digital_output', 'i2c', 'pwm_input']);
  });
});

describe('wiringOverlayReducer', () => {
  it('toggles visibility and signal filters', () => {
    let s = wiringOverlayReducer(INITIAL_WIRING_OVERLAY_STATE, { type: 'toggle' });
    expect(s.visible).toBe(false);
    s = wiringOverlayReducer(s, { type: 'toggle_signal', signal: 'i2c' });
    s = wiringOverlayReducer(s, { type: 'toggle_signal', signal: 'ground' });
    expect(s.filter.signals).toEqual(['ground', 'i2c']);
    s = wiringOverlayReducer(s, { type: 'toggle_signal', signal: 'i2c' });
    expect(s.filter.signals).toEqual(['ground']);
    s = wiringOverlayReducer(s, { type: 'set_active', connection_id: 'w' });
    s = wiringOverlayReducer(s, { type: 'clear_filter' });
    expect(s).toEqual({ visible: false, filter: {}, active_connection_id: 'w' });
  });
});
