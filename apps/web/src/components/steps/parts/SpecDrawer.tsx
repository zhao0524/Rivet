'use client';

import { formatCheckedAt, formatMoney, safeHttpUrl, specRows, type PartRow, type SpecSource } from '../../../lib/flow/derive';
import type { BuildPlan } from '../../../lib/rivet/types';
import { Icon } from '../../system/Icon';
import { Modal } from '../../system/Modal';

export interface SpecDrawerProps {
  row: PartRow | null;
  plan: BuildPlan;
  open: boolean;
  onClose: () => void;
}

const SRC_CLASS: Record<SpecSource, string> = {
  Datasheet: 'src src--datasheet',
  Checked: 'src src--checked',
  'AI estimate': 'src src--ai',
};

/** Where a value came from: Datasheet, Checked, or AI estimate. */
export function SourceTag({ source }: { source: SpecSource }) {
  return (
    <span className={SRC_CLASS[source]} data-testid="spec-source" data-source={source}>
      {source}
    </span>
  );
}

/**
 * One part's specs and where each value came from. Missing values read "Not in datasheet".
 * There is no Swap button: the current data never suggests a substitute, and a fake one would mislead.
 */
export function SpecDrawer({ row, plan, open, onClose }: SpecDrawerProps) {
  if (!row) return null;
  const cat = row.catalog;
  const rows = specRows(cat, plan.bom.currency);
  const bomItem = plan.bom.items.find((i) => i.catalog_id === row.catalogId);
  const quantity = bomItem?.quantity ?? plan.components.filter((c) => c.catalog_id === row.catalogId).length;
  const datasheet = safeHttpUrl(cat?.sourcing.datasheet_url ?? null);
  const price =
    cat?.sourcing.price_amount !== null && cat?.sourcing.price_amount !== undefined
      ? formatMoney(Number(cat.sourcing.price_amount), cat.sourcing.price_currency ?? plan.bom.currency)
      : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      variant="drawer"
      title={row.name}
      description={`${row.manufacturer} · ${row.role.replace(/_/g, ' ')}`}
      testId="spec-drawer"
      footer={
        <button type="button" className="ui-btn ui-btn--primary" onClick={onClose} data-testid="spec-close">
          Close
        </button>
      }
    >
      <div className="p1-spec">
        <dl className="p1-spec__meta">
          <div>
            <dt>Quantity in this build</dt>
            <dd>{quantity}</dd>
          </div>
          <div>
            <dt>Catalog id</dt>
            <dd className="ui-mono">{row.catalogId}</dd>
          </div>
          {cat?.identity.sku ? (
            <div>
              <dt>SKU</dt>
              <dd className="ui-mono">{cat.identity.sku}</dd>
            </div>
          ) : null}
          <div>
            <dt>Shape in the 3D view</dt>
            <dd>{row.standIn ? 'Stand-in shape, not the real part' : 'Modelled from the catalog asset'}</dd>
          </div>
        </dl>

        <table className="p1-spec__table" data-testid="spec-table">
          <caption className="ui-sr-only">Specifications with their source</caption>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} data-testid={`spec-row-${r.label.toLowerCase()}`}>
                <th scope="row">{r.label}</th>
                <td>
                  {r.value === null ? (
                    <span className="p1-spec__none">Not in datasheet</span>
                  ) : r.label === 'Price' ? (
                    <>
                      {price ?? r.value}
                      <span className="p1-spec__sub">{formatCheckedAt(cat?.sourcing.price_checked_at ?? null)}</span>
                    </>
                  ) : (
                    r.value
                  )}
                </td>
                <td>{r.source ? <SourceTag source={r.source} /> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {row.warnings.length > 0 ? (
          <section aria-labelledby="spec-warnings-title">
            <h3 id="spec-warnings-title" className="ui-h3" style={{ marginBottom: 8 }}>
              Warnings
            </h3>
            <ul className="p1-spec__warnings" data-testid="spec-warnings">
              {row.warnings.map((w, i) => (
                <li key={`${w.rule_id}-${i}`} className="ui-notice ui-notice--warn">
                  <span className="ui-dot ui-dot--warn" aria-hidden="true" style={{ marginTop: 6 }} />
                  <span>{w.message}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {cat?.evidence.notes.length ? (
          <details className="p1-details">
            <summary>Catalog notes</summary>
            <div className="p1-details__body">
              <ul className="ui-small ui-muted" style={{ margin: 0, paddingLeft: 18 }}>
                {cat.evidence.notes.map((note, i) => (
                  <li key={i}>{note}</li>
                ))}
              </ul>
            </div>
          </details>
        ) : null}

        {datasheet ? (
          <p style={{ margin: 0 }}>
            <a href={datasheet} target="_blank" rel="noopener noreferrer" className="ui-btn ui-btn--link" data-testid="spec-datasheet">
              Open the datasheet <Icon name="external" size={12} />
            </a>
          </p>
        ) : (
          <p className="ui-small ui-subtle" style={{ margin: 0 }}>
            No datasheet on file for this part.
          </p>
        )}
      </div>
    </Modal>
  );
}
