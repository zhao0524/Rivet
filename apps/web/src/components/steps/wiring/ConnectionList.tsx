'use client';

import type { WireRoute, WiringLayout, WiringWarning } from '../../three/wiring';

export interface ConnectionListProps {
  layout: WiringLayout;
  /** instance_id → readable part name. */
  partNames: ReadonlyMap<string, string>;
  activeConnectionId: string | null;
  pinnedConnectionId: string | null;
  onHover: (connectionId: string | null) => void;
  onPin: (connectionId: string | null) => void;
}

interface Unresolved {
  connection_id: string;
  from: string;
  to: string;
  notes: string[];
}

function unresolvedRows(layout: WiringLayout): Unresolved[] {
  const byId = new Map<string, Unresolved>();
  for (const w of layout.warnings as readonly WiringWarning[]) {
    if (w.wire_drawn) continue;
    const row = byId.get(w.connection_id) ?? { connection_id: w.connection_id, from: '', to: '', notes: [] };
    if (w.endpoint === 'from' && w.instance_id) row.from = `${w.instance_id} · ${w.port_id ?? '?'}`;
    if (w.endpoint === 'to' && w.instance_id) row.to = `${w.instance_id} · ${w.port_id ?? '?'}`;
    row.notes.push(w.message);
    byId.set(w.connection_id, row);
  }
  return [...byId.values()];
}

/**
 * Compact list of every electrical connection: from part/pin → to part/pin, signal, colored dot.
 * Hovering or focusing a row highlights that wire in the 3D view; clicking pins it.
 * The dot color is the wire's own color from the layout, not a literal in this file.
 */
export function ConnectionList({ layout, partNames, activeConnectionId, pinnedConnectionId, onHover, onPin }: ConnectionListProps) {
  const unresolved = unresolvedRows(layout);
  const name = (id: string) => partNames.get(id) ?? id;

  return (
    <ul className="list p1-wires" aria-label="Connections" data-testid="wiring-list">
      {layout.wires.map((w: WireRoute) => {
        const active = activeConnectionId === w.connection_id;
        const pinned = pinnedConnectionId === w.connection_id;
        return (
          <li key={w.connection_id}>
            <button
              type="button"
              className={active ? 'list__row p1-wire p1-wire--active' : 'list__row p1-wire'}
              aria-pressed={pinned}
              onMouseEnter={() => onHover(w.connection_id)}
              onMouseLeave={() => onHover(null)}
              onFocus={() => onHover(w.connection_id)}
              onBlur={() => onHover(null)}
              onClick={() => onPin(pinned ? null : w.connection_id)}
              data-testid={`wiring-row-${w.connection_id}`}
            >
              <span className="p1-wire__dot" style={{ background: w.color }} aria-hidden="true" />
              <span className="list__main">
                <span className="p1-wire__ends">
                  {name(w.from.instance_id)} <span className="p1-wire__pin">{w.from.port_id}</span>
                  {' → '}
                  {name(w.to.instance_id)} <span className="p1-wire__pin">{w.to.port_id}</span>
                </span>
                {w.net_name ? <span className="list__meta ui-mono">{w.net_name}</span> : null}
              </span>
              <span className="p1-wire__signal">{w.signal_label}</span>
            </button>
          </li>
        );
      })}
      {unresolved.map((u) => (
        <li key={u.connection_id}>
          <div className="list__row p1-wire p1-wire--unresolved" data-testid={`wiring-unresolved-${u.connection_id}`}>
            <span className="p1-wire__dot" aria-hidden="true" />
            <span className="list__main">
              <span className="p1-wire__ends">
                {u.from || u.connection_id}
                {u.to ? ` → ${u.to}` : ''}
              </span>
              <span className="list__meta">Not drawn: {u.notes.join('; ')}</span>
            </span>
            <span className="p1-wire__signal">Unresolved pin</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
