'use client';

import { formatMoney, isIncludedKitPart, makerLabel, PART_GROUP_HINT, PART_GROUP_LABEL, roleLabel, type PartGroup, type PartRow } from '../../../lib/flow/derive';

export interface PartListProps {
  groups: ReadonlyArray<{ group: PartGroup; rows: PartRow[] }>;
  selectedId: string | null;
  collapsed: ReadonlySet<PartGroup>;
  currency: string;
  onToggleGroup: (group: PartGroup) => void;
  onSelect: (row: PartRow) => void;
}

/** Grouped, collapsible part rows. Prices are read-only here; buying happens in Buy. */
export function PartList({ groups, selectedId, collapsed, currency, onToggleGroup, onSelect }: PartListProps) {
  return (
    <div className="p1-groups" data-testid="parts-groups">
      {groups.map(({ group, rows }) => {
        const open = !collapsed.has(group);
        return (
          <details
            key={group}
            className="p1-details p1-group"
            open={open}
            data-testid={`parts-group-${group}`}
          >
            <summary
              onClick={(e) => {
                e.preventDefault();
                onToggleGroup(group);
              }}
            >
              <span>
                {PART_GROUP_LABEL[group]} <span className="p1-count">({rows.length})</span>
                <span className="ui-small ui-muted" style={{ display: 'block', fontWeight: 400 }}>
                  {PART_GROUP_HINT[group]}
                </span>
              </span>
            </summary>
            <ul className="list">
              {rows.map((row) => {
                const price = row.catalog?.sourcing.price_amount;
                const selected = selectedId === row.instanceId;
                return (
                  <li key={row.instanceId}>
                    <button
                      type="button"
                      className="list__row"
                      aria-current={selected || undefined}
                      onClick={() => onSelect(row)}
                      data-testid={`parts-row-${row.instanceId}`}
                      id={`part-row-${row.instanceId}`}
                    >
                      <span className="list__main">
                        <span className="list__title">{row.name}</span>
                        <span className="list__meta">
                          {roleLabel(row.role)} · {makerLabel(row.manufacturer)}
                          {row.standIn ? <span className="p1-standin"> · Simple 3D shape</span> : null}
                        </span>
                      </span>
                      <span className="p1-part__flags">
                        {row.warnings.length > 0 ? (
                          <span title={`${row.warnings.length} thing${row.warnings.length === 1 ? '' : 's'} to double-check`}>
                            <span className="ui-dot ui-dot--warn" aria-hidden="true" />
                            <span className="ui-sr-only">
                              {row.warnings.length} thing{row.warnings.length === 1 ? '' : 's'} to double-check
                            </span>
                          </span>
                        ) : null}
                        {price !== null && price !== undefined ? (
                          <span className="p1-part__price">
                            {isIncludedKitPart(row.catalog) ? 'Included in kit' : formatMoney(Number(price), row.catalog?.sourcing.price_currency ?? currency)}
                          </span>
                        ) : (
                          <span className="p1-part__price p1-part__price--none">No price</span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </details>
        );
      })}
    </div>
  );
}
