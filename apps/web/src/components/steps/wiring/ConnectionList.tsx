'use client';

import { signalPlain, wirePurpose } from '../../../lib/flow/derive';
import type { WireRoute, WiringLayout, WiringWarning } from '../../three/wiring';

export interface ConnectionListProps {
  layout: WiringLayout;
  /** instance_id → readable part name. */
  partNames: ReadonlyMap<string, string>;
  /** instance_id → everyday nickname ("motor driver"), used for the plain wording. */
  nicknames?: ReadonlyMap<string, string>;
  /** instance_id → role, so a wire to a distance sensor can say it reads distance. */
  roles?: ReadonlyMap<string, string>;
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

function unresolvedRows(layout: WiringLayout, nick: (id: string) => string): Unresolved[] {
  const byId = new Map<string, Unresolved>();
  for (const w of layout.warnings as readonly WiringWarning[]) {
    if (w.wire_drawn) continue;
    const row = byId.get(w.connection_id) ?? { connection_id: w.connection_id, from: '', to: '', notes: [] };
    if (w.endpoint === 'from' && w.instance_id) row.from = `${nick(w.instance_id)} ${w.port_id ?? '?'}`;
    if (w.endpoint === 'to' && w.instance_id) row.to = `${nick(w.instance_id)} ${w.port_id ?? '?'}`;
    row.notes.push(w.message);
    byId.set(w.connection_id, row);
  }
  return [...byId.values()];
}

/**
 * Compact list of every electrical connection. Each row leads with what the wire does in plain
 * words; the pins, wire name and signal type sit in the muted line under it.
 * Hovering or focusing a row highlights that wire in the 3D view; clicking pins it.
 * The dot color is the wire's own color from the layout, not a literal in this file.
 */
export function ConnectionList({ layout, partNames, nicknames, roles, activeConnectionId, pinnedConnectionId, onHover, onPin }: ConnectionListProps) {
  const nick = (id: string) => nicknames?.get(id) ?? partNames.get(id) ?? id;
  const unresolved = unresolvedRows(layout, nick);

  return (
    <ul className="list p1-wires" aria-label="Wires" data-testid="wiring-list">
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
                  {wirePurpose(
                    { name: nick(w.from.instance_id), port: w.from.port_id, signal: w.from.signal, role: roles?.get(w.from.instance_id) },
                    { name: nick(w.to.instance_id), port: w.to.port_id, signal: w.to.signal, role: roles?.get(w.to.instance_id) },
                    w.net_name,
                  )}
                </span>
                <span
                  className="list__meta"
                  title={`${partNames.get(w.from.instance_id) ?? w.from.instance_id} → ${partNames.get(w.to.instance_id) ?? w.to.instance_id}${w.net_name ? ` (wire name ${w.net_name})` : ''}`}
                >
                  {nick(w.from.instance_id)} <span className="p1-wire__pin">{w.from.port_id}</span>
                  {' → '}
                  {nick(w.to.instance_id)} <span className="p1-wire__pin">{w.to.port_id}</span>
                  {w.notes ? <span style={{ display: 'block' }}>Note: {w.notes}</span> : null}
                  <span className="ui-sr-only">
                    . Signal type: {w.signal_label}
                    {w.net_name ? `. Wire name: ${w.net_name}` : ''}
                  </span>
                </span>
              </span>
              <span className="p1-wire__signal" title={w.signal_label}>
                {signalPlain(/digital_io/.test(w.to.signal) ? w.from.signal : w.to.signal)}
              </span>
            </button>
          </li>
        );
      })}
      {unresolved.map((u) => (
        <li key={u.connection_id}>
          <div className="list__row p1-wire p1-wire--unresolved" data-testid={`wiring-unresolved-${u.connection_id}`}>
            <span className="p1-wire__dot" aria-hidden="true" />
            <span className="list__main">
              <span className="p1-wire__ends">Couldn&apos;t draw this wire</span>
              <span className="list__meta">
                {u.from || u.connection_id}
                {u.to ? ` → ${u.to}` : ''}. {u.notes.join('; ')}
              </span>
            </span>
            <span className="p1-wire__signal">Pin not found</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
