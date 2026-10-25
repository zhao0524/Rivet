'use client';

import { useMemo, useState } from 'react';
import '../../../styles/phase2.css';
import { buyLines, formatCheckedAt, formatMoney, type BuyLine } from '../../../lib/flow/derive';
import { buildBomCsvClientSide } from '../../../lib/plan-store';
import { isConceptPlan } from '../../../lib/rivet/honesty';
import { useProjectContext } from '../../flow/ProjectShell';
import { StepLayout } from '../../flow/StepLayout';
import { Icon } from '../../system/Icon';
import type { OverflowItem } from '../../system/OverflowMenu';
import { CartModal } from './CartModal';
import { NO_VENDOR, buyTotals, groupByVendor, isOwned, regionForCurrency, stockLabel, unknownPriceNote, type VendorGroup } from './buy-model';
import { downloadTextFile } from './download';
import { printableLines, sizeLabel, stlFileName, type PrintLine } from './print-model';

const PURPOSE = 'Get every part in one go: check the currency, tick anything you already have, then open the store links.';

/** Step 4 Buy: total, vendor groups, out-of-stock parts, and the cart of verified links. */
export function BuyStep() {
  const { project, update, build, goTo, openIterate } = useProjectContext();
  const { plan, catalog } = build.store;
  const [cartOpen, setCartOpen] = useState(false);

  const concept = build.ready && isConceptPlan(plan);
  const allLines = useMemo(() => (build.ready ? buyLines(plan, catalog) : []), [build.ready, plan, catalog]);
  // A concept's body shapes and wires are part of the 3D model, not things to buy.
  const lines = useMemo(() => allLines.filter((l) => !l.included && (!concept || l.url)), [concept, allLines]);
  const included = allLines.filter((l) => l.included);
  const shapes = concept ? allLines.filter((l) => !l.url) : [];
  // Shapes with no store link and no price can be printed from the model instead.
  const printable = concept ? printableLines(shapes, catalog) : [];
  const owned = project.ownedCatalogIds;
  const currency = plan.bom.currency || 'USD';
  const totals = useMemo(() => buyTotals(lines, owned), [lines, owned]);
  const groups = useMemo(() => groupByVendor(lines, owned), [lines, owned]);
  const fabricated = lines.filter((l) => l.fabricated);
  const outOfStock = lines.filter((l) => l.inStock === 'out_of_stock' && !isOwned(l, owned));
  const everythingOwned = build.ready && totals.toBuy === 0 && lines.length > 0;
  const nothingToBuy = concept && lines.length === 0;

  function toggleOwned(catalogId: string, next: boolean) {
    const set = new Set(owned);
    if (next) set.add(catalogId);
    else set.delete(catalogId);
    update({ ownedCatalogIds: Array.from(set) });
  }

  const overflow: OverflowItem[] = [
    {
      id: 'csv',
      label: 'Download parts list (CSV)',
      disabled: !build.ready,
      testId: 'buy-export-csv',
      onSelect: () => downloadTextFile(`${plan.build_id}-bom.csv`, buildBomCsvClientSide(plan), 'text/csv'),
    },
    {
      id: 'vendor',
      label: (
        <span>
          Pick a different store for a part
          <br />
          <span className="ui-small ui-subtle">Each part has one known store listing right now</span>
        </span>
      ),
      disabled: true,
      onSelect: () => undefined,
    },
    { id: 'iterate', label: 'Change something', onSelect: openIterate, testId: 'buy-iterate' },
  ];

  if (!build.ready) {
    return (
      <StepLayout
        title="Buy"
        purpose={PURPOSE}
        primary={{ label: 'Open cart', onClick: () => undefined, disabled: true, waitingFor: build.error ? undefined : 'Loading your parts list…', testId: 'buy-primary' }}
        overflow={overflow}
        testId="buy-step"
      >
        {build.error ? (
          <p className="ui-notice ui-notice--danger" role="alert" data-testid="buy-error">
            <Icon name="alert" aria-hidden="true" /> {build.error}
          </p>
        ) : (
          <div className="p2-grid" aria-busy="true" aria-label="Loading your parts list">
            <div className="p2-skeleton-lines">
              <div className="ui-skeleton" style={{ height: 56 }} />
              <div className="ui-skeleton" style={{ height: 56 }} />
              <div className="ui-skeleton" style={{ height: 56 }} />
            </div>
            <div className="p2-skeleton-lines">
              <div className="ui-skeleton" style={{ height: 120 }} />
              <div className="ui-skeleton" style={{ height: 88 }} />
            </div>
          </div>
        )}
      </StepLayout>
    );
  }

  const region = regionForCurrency(currency);
  const unknownNote = unknownPriceNote(totals.unknownPriceCount);

  return (
    <StepLayout
      title="Buy"
      purpose={PURPOSE}
      primary={
        everythingOwned || nothingToBuy
          ? { label: 'Start building', onClick: () => goTo('build'), testId: 'buy-primary' }
          : { label: 'Open cart', onClick: () => setCartOpen(true), testId: 'buy-primary' }
      }
      overflow={overflow}
      testId="buy-step"
    >
      <div className="p2-grid">
        <div className="p2-stack">
          {nothingToBuy ? (
            <p className="ui-notice" style={{ margin: 0 }} data-testid="buy-concept-empty">
              <Icon name="info" style={{ flex: 'none', marginTop: 3 }} aria-hidden="true" />
              <span>
                None of this model&apos;s parts matches a role Rivet has a suggested product for (boards, motors, batteries,
                sensors…), so there is nothing to buy here. Its {shapes.length} {shapes.length === 1 ? 'item is a shape' : 'items are shapes'} in the 3D model
                {printable.length > 0 ? `; ${printable.length} of them can be 3D-printed below.` : '.'}
              </span>
            </p>
          ) : concept ? (
            <p className="ui-notice" style={{ margin: 0 }} data-testid="buy-suggested-notice">
              <Icon name="alert" style={{ flex: 'none', marginTop: 3 }} aria-hidden="true" />
              <span>
                These are suggested real parts, hand-picked for each role in the 3D model. They were not checked against its
                size, power or wiring, so confirm they fit before you order.
                {shapes.length > 0
                  ? ` ${shapes.length} more ${shapes.length === 1 ? 'item is a shape' : 'items are shapes'} in the model (body, covers, wires) with no store listing${
                      printable.length > 0 ? `; ${printable.length} of them can be 3D-printed below` : ''
                    }.`
                  : ''}
              </span>
            </p>
          ) : null}
          <ul className="list" data-testid="buy-vendors">
            {groups.map((group) => (
              <VendorRow key={group.vendor} group={group} currency={currency} owned={owned} onToggleOwned={toggleOwned} />
            ))}
          </ul>
          {included.length > 0 ? (
            <section className="ui-island" aria-label="Included in kits" data-testid="buy-included">
              <h2 className="ui-h3">Included in kits</h2>
              <p className="p2-note">These parts come with a kit already in the parts list. No separate purchase is needed.</p>
              <ul>{included.map((line) => <li key={line.catalogId}>{line.name} · Qty {line.quantity}</li>)}</ul>
            </section>
          ) : null}

          {outOfStock.length > 0 ? (
            <section className="buy-oos" aria-labelledby="buy-oos-title" data-testid="buy-out-of-stock">
              <h2 id="buy-oos-title" className="ui-h3">
                Out of stock when checked
              </h2>
              {outOfStock.map((line) => (
                <article key={line.catalogId} className="buy-oos__card">
                  <div className="buy-oos__head">
                    <Icon name="alert" aria-hidden="true" style={{ color: 'var(--ui-warn)', flex: 'none', marginTop: 2 }} />
                    <div className="list__main">
                      <span className="list__title">{line.name}</span>
                      <span className="list__meta">
                        {line.vendor} · {formatCheckedAt(line.checkedAt)}
                      </span>
                    </div>
                  </div>
                  <p className="p2-note">Check the vendor for current availability. You will need this part or a compatible replacement before assembling the build.</p>
                </article>
              ))}
            </section>
          ) : null}

          {printable.length > 0 ? <PrintSection buildId={plan.build_id} parts={printable} /> : null}

          {fabricated.length > 0 ? (
            <section className="ui-island" aria-labelledby="buy-fab-title" data-testid="buy-fabricated">
              <h2 id="buy-fab-title" className="ui-h3">
                Parts you 3D-print
              </h2>
              <p className="p2-note">You print these instead of buying them. The print files come with the design download.</p>
              <ul className="build__parts" style={{ marginTop: 10 }}>
                {fabricated.map((line) => (
                  <li key={line.catalogId} className="build__part">
                    <Icon name="cube" aria-hidden="true" />
                    <span className="build__part-name">{line.name}</span>
                    <span className="ui-small ui-muted">×{line.quantity} · you print it</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <aside className="p2-grid__side">
          <section className="ui-island" aria-labelledby="buy-total-title" data-testid="buy-total">
            <h2 id="buy-total-title" className="ui-eyebrow">
              Total to buy
            </h2>
            <p className="p2-amount" style={{ margin: '6px 0 0' }} aria-live="polite" data-testid="buy-total-amount">
              {everythingOwned ? formatMoney(0, currency) : formatMoney(totals.total, currency)}
            </p>
            <p className="p2-note" aria-live="polite">
              {nothingToBuy
                ? 'No suggested parts for this model.'
                : everythingOwned
                ? 'You own everything on the list. Nothing to buy.'
                : `${totals.toBuy} ${totals.toBuy === 1 ? 'part' : 'parts'} to buy${totals.owned > 0 ? `, ${totals.owned} owned` : ''}.`}
              {unknownNote ? (
                <>
                  {' '}
                  <span data-testid="buy-unknown-prices">{unknownNote}, so the real total is higher.</span>
                </>
              ) : null}
            </p>
          </section>

          <section className="ui-island" aria-labelledby="buy-region-title" data-testid="buy-region">
            <div className="p2-kv">
              <h2 id="buy-region-title" className="ui-eyebrow">
                Region and currency
              </h2>
              <span className="ui-badge ui-badge--ok">
                <Icon name="check" size={12} aria-hidden="true" /> Confirmed
              </span>
            </div>
            <p style={{ margin: '6px 0 0', fontWeight: 500 }}>{region ? `${region} · ${currency}` : currency}</p>
            <p className="p2-note">
              Prices are in {currency}, as the stores listed them. Shopping from another country needs fresh prices from
              Rivet&apos;s live engine, which isn&apos;t connected right now.
            </p>
          </section>
        </aside>
      </div>

      <CartModal open={cartOpen} onClose={() => setCartOpen(false)} lines={lines} ownedIds={owned} currency={currency} onContinue={() => goTo('build')} />
    </StepLayout>
  );
}

function VendorRow({
  group,
  currency,
  owned,
  onToggleOwned,
}: {
  group: VendorGroup;
  currency: string;
  owned: readonly string[];
  onToggleOwned: (catalogId: string, next: boolean) => void;
}) {
  const [open, setOpen] = useState(group.vendor === NO_VENDOR);
  const panelId = `buy-vendor-${group.vendor.replace(/\s+/g, '-').toLowerCase()}`;
  const noVendor = group.vendor === NO_VENDOR;
  return (
    <li data-testid={`buy-vendor-${group.vendor}`}>
      <button type="button" className="buy-vendor__row" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((o) => !o)}>
        <Icon name="arrowRight" className="buy-vendor__caret" aria-hidden="true" />
        <span className="list__main">
          <span className="list__title">{group.vendor}</span>
          <span className="list__meta">
            {group.lines.length} {group.lines.length === 1 ? 'item' : 'items'}
            {noVendor ? ' · no product page to link' : ''}
            {group.allOwned ? ' · all owned' : ''}
          </span>
        </span>
        <span className="buy-vendor__sub">
          {group.unknownPriceCount >= group.lines.length ? (
            <span className="ui-muted">Price unknown</span>
          ) : (
            <>
              {formatMoney(group.subtotal, currency)}
              {group.unknownPriceCount > 0 ? <span className="ui-small ui-muted"> + {group.unknownPriceCount} unknown</span> : null}
            </>
          )}
        </span>
      </button>
      {open ? (
        <ul id={panelId} className="buy-lines">
          {noVendor ? (
            <li className="buy-line" style={{ paddingLeft: 14 }}>
              <p className="p2-note" style={{ margin: 0 }}>
                Rivet couldn&apos;t find a store page it trusts for {group.lines.length === 1 ? 'this part' : 'these parts'}. Any price shown comes from Rivet&apos;s parts catalog, not a live store page.
              </p>
            </li>
          ) : null}
          {group.lines.map((line) => (
            <BuyLineRow key={line.catalogId} line={line} currency={currency} owned={isOwned(line, owned)} onToggleOwned={onToggleOwned} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function BuyLineRow({
  line,
  currency,
  owned,
  onToggleOwned,
}: {
  line: BuyLine;
  currency: string;
  owned: boolean;
  onToggleOwned: (catalogId: string, next: boolean) => void;
}) {
  const dot = line.inStock === 'in_stock' ? 'ui-dot ui-dot--ok' : line.inStock === 'out_of_stock' ? 'ui-dot ui-dot--warn' : 'ui-dot';
  return (
    <li className="buy-line" data-owned={owned} data-testid={`buy-line-${line.catalogId}`}>
      <div className="list__main">
        <span className="buy-line__name">
          {line.url ? (
            <a href={line.url} target="_blank" rel="noopener noreferrer" data-testid={`buy-line-link-${line.catalogId}`}>
              {line.name}
            </a>
          ) : (
            line.name
          )}
          {line.suggested ? (
            <span className="ui-badge" style={{ marginLeft: 8 }} data-testid={`buy-suggested-${line.catalogId}`}>
              Suggested part
            </span>
          ) : null}
        </span>
        <span className="buy-line__meta">
          <span>Qty {line.quantity}</span>
          <span className="buy-line__stock">
            <span className={dot} aria-hidden="true" /> {stockLabel(line.inStock)}
          </span>
          <span>{formatCheckedAt(line.checkedAt)}</span>
        </span>
      </div>
      <div className="buy-line__right">
        <span className="buy-line__price">
          {line.unitPrice === null ? 'Price unknown' : `${formatMoney(line.unitPrice, currency)}${line.quantity > 1 ? ' each' : ''}`}
        </span>
        <label className="p2-check-inline">
          <input type="checkbox" checked={owned} onChange={(e) => onToggleOwned(line.catalogId, e.target.checked)} data-testid={`buy-own-${line.catalogId}`} />
          I own this<span className="ui-sr-only"> ({line.name})</span>
        </label>
      </div>
    </li>
  );
}

/** Concept parts with no store link or price: download each as an STL, or all of them on one plate. */
function PrintSection({ buildId, parts }: { buildId: string; parts: readonly PrintLine[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const copies = parts.reduce((n, p) => n + p.line.quantity, 0);

  async function download(key: string, filename: string, selection: readonly PrintLine[], single: boolean) {
    setBusy(key);
    setError(null);
    try {
      // three is only loaded when someone asks for a print file.
      const [{ printPlateStl }, { downloadBlob }] = await Promise.all([
        import('../../../lib/print/stl'),
        import('../../three/enclosure/export'),
      ]);
      const stl = printPlateStl(selection.map((p) => ({ shape: p.shape, size: p.size, count: single ? 1 : p.line.quantity })));
      downloadBlob(filename, new Blob([stl], { type: 'model/stl' }));
    } catch {
      setError('The print file could not be made. Try again.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="ui-island" aria-labelledby="buy-print-title" data-testid="buy-print">
      <div className="p2-kv">
        <h2 id="buy-print-title" className="ui-h3">
          3D print instead
        </h2>
        <button
          type="button"
          className="ui-btn ui-btn--secondary"
          disabled={busy !== null}
          onClick={() => download('all', `${buildId}-print-plate.stl`, parts, false)}
          data-testid="buy-print-all"
        >
          <Icon name="download" aria-hidden="true" /> {busy === 'all' ? 'Preparing…' : `All parts (${copies})`}
        </button>
      </div>
      <p className="p2-note">
        These parts have no store listing or price. You can print them from the model: each file is the part&apos;s shape at
        its estimated size, in millimetres. Sizes were read from the photo, so check them against the real object first.
        &ldquo;All parts&rdquo; puts every copy on one plate.
      </p>
      {error ? (
        <p className="ui-notice ui-notice--danger" role="alert" data-testid="buy-print-error">
          <Icon name="alert" aria-hidden="true" /> {error}
        </p>
      ) : null}
      <ul className="build__parts" style={{ marginTop: 10 }}>
        {parts.map((part) => (
          <li key={part.line.catalogId} className="build__part" data-testid={`buy-print-${part.line.catalogId}`}>
            <Icon name="cube" aria-hidden="true" />
            <span className="build__part-name">{part.line.name}</span>
            <span className="ui-small ui-muted">
              ×{part.line.quantity} · {sizeLabel(part.size)}
            </span>
            <button
              type="button"
              className="ui-btn ui-btn--ghost ui-btn--sm"
              disabled={busy !== null}
              onClick={() => download(part.line.catalogId, stlFileName(buildId, part.line.name), [part], true)}
              data-testid={`buy-print-stl-${part.line.catalogId}`}
            >
              {busy === part.line.catalogId ? 'Preparing…' : 'STL'}
              <span className="ui-sr-only"> for {part.line.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
