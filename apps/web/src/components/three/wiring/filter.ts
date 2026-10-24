import type { WireRoute, WiringFilter } from './types';

const matches = (allowed: readonly string[] | undefined, ...values: (string | null)[]) =>
  !allowed || allowed.length === 0 || values.some((v) => v !== null && allowed.includes(v));

/** All criteria are ANDed; an empty or missing list does not filter. */
export function filterWires(wires: readonly WireRoute[], filter: WiringFilter | null | undefined): WireRoute[] {
  if (!filter) return wires.slice();
  return wires.filter(
    (w) =>
      matches(filter.connection_ids, w.connection_id) &&
      matches(filter.instance_ids, w.from.instance_id, w.to.instance_id) &&
      matches(filter.signals, w.from.signal, w.to.signal) &&
      matches(filter.net_names, w.net_name),
  );
}

export function wiresForInstances(wires: readonly WireRoute[], instanceIds: readonly string[]): WireRoute[] {
  return filterWires(wires, { instance_ids: instanceIds });
}

export function connectedInstanceIds(wire: WireRoute | null | undefined): string[] {
  if (!wire) return [];
  return wire.from.instance_id === wire.to.instance_id
    ? [wire.from.instance_id]
    : [wire.from.instance_id, wire.to.instance_id];
}

export function availableSignals(wires: readonly WireRoute[]): string[] {
  return [...new Set(wires.flatMap((w) => [w.from.signal, w.to.signal]))].sort();
}
