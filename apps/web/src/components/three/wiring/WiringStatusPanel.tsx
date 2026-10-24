import type { CSSProperties } from 'react';
import { APPROXIMATE_WIRING_DETAIL, APPROXIMATE_WIRING_TEXT } from './constants';
import type { WireRoute, WiringLayout } from './types';

const panelStyle: CSSProperties = {
  font: '12px/1.4 ui-sans-serif, system-ui, sans-serif',
  color: '#F4F4F5',
  background: 'rgba(17, 20, 26, 0.88)',
  border: '1px solid rgba(255, 255, 255, 0.12)',
  borderRadius: 6,
  padding: '8px 10px',
  width: 300,
  pointerEvents: 'auto',
};

const mono: CSSProperties = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' };

export interface WiringStatusPanelProps {
  layout: WiringLayout;
  /** Number of wires currently shown after filtering, if different from `layout.counts.drawn`. */
  shownCount?: number;
  className?: string;
}

/** Plain DOM panel; mount inside the canvas via drei `Html` or anywhere in the studio UI. */
export function WiringStatusPanel({ layout, shownCount, className }: WiringStatusPanelProps) {
  const { counts, warnings } = layout;
  const blocking = warnings.filter((w) => !w.wire_drawn);
  return (
    <div className={className ?? 'rivet-wiring-status'} style={panelStyle} role="status" data-testid="wiring-status">
      {layout.approximate && (
        <div data-testid="wiring-approximate">
          <strong>{APPROXIMATE_WIRING_TEXT}</strong>
          <div style={{ opacity: 0.8 }}>{APPROXIMATE_WIRING_DETAIL}</div>
        </div>
      )}
      <div style={{ marginTop: layout.approximate ? 6 : 0 }} data-testid="wiring-counts">
        {counts.drawn} of {counts.electrical_connections} electrical connections drawn
        {shownCount !== undefined && shownCount !== counts.drawn ? ` (${shownCount} shown by filter)` : ''}
      </div>
      {warnings.length > 0 && (
        <ul style={{ margin: '6px 0 0', paddingLeft: 16 }} data-testid="wiring-warnings">
          {warnings.map((w, i) => (
            <li key={`${w.connection_id}-${w.endpoint ?? 'x'}-${w.code}-${i}`} data-code={w.code} data-severity={w.severity}>
              <span style={mono}>{w.code}</span> <span style={mono}>{w.connection_id}</span>: {w.message}
            </li>
          ))}
        </ul>
      )}
      {blocking.length > 0 && (
        <div style={{ marginTop: 6, color: '#FCA5A5' }}>
          {new Set(blocking.map((w) => w.connection_id)).size} connection(s) not drawn: unresolved references.
        </div>
      )}
    </div>
  );
}

export function describeWire(wire: WireRoute): string[] {
  const lines = [
    `${wire.from.instance_id} · ${wire.from.port_id} → ${wire.to.instance_id} · ${wire.to.port_id}`,
    `Signal: ${wire.signal_label}`,
  ];
  if (wire.net_name) lines.push(`Net: ${wire.net_name}`);
  if (wire.approximate) lines.push(`${APPROXIMATE_WIRING_TEXT}: schematic anchors`);
  return lines;
}

const labelStyle: CSSProperties = {
  ...panelStyle,
  ...mono,
  fontSize: 12,
  whiteSpace: 'nowrap',
  width: 'max-content',
  pointerEvents: 'none',
};

export function WireLabel({ wire, className }: { wire: WireRoute; className?: string }) {
  const [endpoints, ...rest] = describeWire(wire);
  return (
    <div className={className ?? 'rivet-wiring-label'} style={labelStyle} data-testid="wire-label">
      <div style={{ borderLeft: `3px solid ${wire.color}`, paddingLeft: 6 }}>
        <div style={{ fontWeight: 600 }}>{endpoints}</div>
        {rest.map((line) => (
          <div key={line} style={{ opacity: 0.85 }}>
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}
