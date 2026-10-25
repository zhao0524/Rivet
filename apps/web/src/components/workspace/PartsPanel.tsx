'use client';

import { useEffect, useMemo, useState } from 'react';
import { buyLines, catalogIndex, formatCheckedAt, formatMoney, makerLabel, safeHttpUrl, type BuyLine } from '../../lib/flow/derive';
import { buildBomCsvClientSide } from '../../lib/plan-store';
import type { BuildPlan, CatalogComponent } from '../../lib/rivet/types';
import { Icon } from '../system/Icon';
import { downloadBlob } from '../three/enclosure/export';
import { usePrintFiles } from '../three/enclosure/usePrintFiles';
import type { PartSelectionApi } from '../three/interactions';
import { rolePlain } from '../start/shared';
import { PrintButton, PrintMenu, printLabel, usePrintable } from './PrintPart';

/** The printed body is not a catalog part: it is made from the plan, so it gets its own row. */
const BODY_ID = 'printed-body';

/**
 * The Parts tab: every component in the build, bought or made. Picking one shows where to buy it,
 * or, for parts you make yourself (the printed body), the files to 3D print it. Picking one that is
 * in the model also highlights it there, and a part picked in the model is picked here.
 */
export function PartsPanel({
  plan,
  catalog,
  selection,
}: {
  plan: BuildPlan;
  catalog: readonly CatalogComponent[];
  selection: PartSelectionApi;
}) {
  const byId = useMemo(() => catalogIndex([...catalog, ...(plan.concept_catalog ?? [])]), [catalog, plan.concept_catalog]);
  const lines = useMemo(() => buyLines(plan, [...byId.values()]), [plan, byId]);
  const printable = usePrintable(plan, catalog);
  const print = usePrintFiles(plan, catalog);
  const [picked, setPicked] = useState<string | null>(null);
  const [printing, setPrinting] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // Custom plastic pieces (shells, covers, hatches, decals) are made on a 3D printer, not bought.
  const custom = lines.filter((l) => !l.fabricated && printable.has(l.catalogId));
  const bought = lines.filter((l) => !l.fabricated && !printable.has(l.catalogId));
  const made = lines.filter((l) => l.fabricated);
  const instancesOf = (catalogId: string) => plan.bom.items.find((i) => i.catalog_id === catalogId)?.instance_ids ?? [];
  const total = bought.reduce((sum, l) => sum + (l.unitPrice ?? 0) * l.quantity, 0);

  // A part picked in the model picks its row here and brings it into view.
  useEffect(() => {
    const id = selection.selectedInstanceId;
    if (!id) return;
    const comp = plan.components.find((c) => c.instance_id === id);
    if (!comp) return;
    setPicked(comp.catalog_id);
    const raf = requestAnimationFrame(() => {
      document
        .querySelector(`[data-testid="workspace-component-${comp.catalog_id.replace(/["\\]/g, '')}"]`)
        ?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(raf);
  }, [selection.selectedInstanceId, plan.components]);

  function pick(catalogId: string) {
    setNote(null);
    setPicked((p) => (p === catalogId ? null : catalogId));
    const target = instancesOf(catalogId)[0];
    if (target && catalogId !== BODY_ID) selection.select(target, { reason: 'api', reveal: true });
    else selection.clearSelection();
  }

  async function exportBody(format: 'obj' | 'stl') {
    const ok = await print.download(format);
    setNote(ok ? `Saved the printed body as .${format}` : print.error);
  }

  return (
    <div className="ws-proj" data-testid="workspace-parts">
      <p className="ws-proj__summary">
        {lines.length + (print.spec ? 1 : 0)} components · {formatMoney(total, plan.bom.currency)} to buy
      </p>

      <p className="ws-guide__label">To buy</p>
      <ul className="ws-guide__list">
        {bought.map((l) => (
          <Row key={l.catalogId} line={l} open={picked === l.catalogId} onPick={() => pick(l.catalogId)} currency={plan.bom.currency}>
            <BuyDetail line={l} cat={byId.get(l.catalogId) ?? null} role={roleOf(plan, l.catalogId)} currency={plan.bom.currency} />
          </Row>
        ))}
      </ul>

      {print.spec || made.length > 0 || custom.length > 0 ? (
        <>
          <p className="ws-guide__label">To make</p>
          <ul className="ws-guide__list">
            {print.spec ? (
              <li>
                <button
                  type="button"
                  className="ws-guide__row"
                  aria-expanded={picked === BODY_ID}
                  onClick={() => pick(BODY_ID)}
                  data-testid="workspace-component-printed-body"
                >
                  <Icon name="cube" size={13} />
                  <span>
                    <strong>Printed body</strong>
                    <span className="ws-guide__sub">Custom · 3D print it</span>
                  </span>
                </button>
                {picked === BODY_ID ? (
                  <div className="ws-proj__detail" data-testid="workspace-component-detail">
                    <p className="ws-guide__sub">
                      The shell the parts fit into, made from this design.
                      {print.size ? ` ${print.size[0]} × ${print.size[1]} × ${print.size[2]} mm.` : ''} In millimetres, laid out for one build plate.
                    </p>
                    <div className="ws-guide__btns">
                      <button
                        type="button"
                        className="ws-btn ws-btn--primary ws-btn--sm"
                        onClick={() => void exportBody('obj')}
                        disabled={print.busy !== null}
                        data-testid="workspace-export-obj"
                      >
                        <Icon name="download" size={13} /> Export .obj
                      </button>
                      <button type="button" className="ws-btn ws-btn--sm" onClick={() => void exportBody('stl')} disabled={print.busy !== null}>
                        .stl
                      </button>
                    </div>
                  </div>
                ) : null}
              </li>
            ) : null}
            {custom.map((l) => {
              const part = printable.get(l.catalogId)!;
              return (
                <li key={l.catalogId}>
                  <div className="ws-proj__custom">
                  <button
                    type="button"
                    className="ws-guide__row"
                    aria-expanded={picked === l.catalogId}
                    onClick={() => pick(l.catalogId)}
                    data-testid={`workspace-component-${l.catalogId}`}
                  >
                    <Icon name="cube" size={13} />
                    <span>
                      <strong>
                        {l.quantity > 1 ? `${l.quantity} × ` : ''}
                        {l.name}
                      </strong>
                      <span className="ws-guide__sub">{printLabel(part)}</span>
                    </span>
                  </button>
                  <PrintButton
                    part={part}
                    open={printing === l.catalogId}
                    onToggle={() => setPrinting((p) => (p === l.catalogId ? null : l.catalogId))}
                  />
                  </div>
                  {printing === l.catalogId ? <PrintMenu part={part} buildId={plan.build_id} onSaved={(file) => setNote(`Saved ${file}`)} /> : null}
                  {picked === l.catalogId ? (
                    <div className="ws-proj__detail" data-testid="workspace-component-detail">
                      <p className="ws-guide__sub">
                        {roleOf(plan, l.catalogId) ? `${rolePlain(roleOf(plan, l.catalogId)!)}. ` : ''}{part.standIn
                          ? 'No store sells this yet. Print a same-size stand-in from the model to hold its place; it won\'t work like the real part.'
                          : 'A custom plastic piece, printed from the model.'}{' '}
                        Use the print icon for its .stl or .obj file.
                      </p>
                    </div>
                  ) : null}
                </li>
              );
            })}
            {made.map((l) => (
              <Row key={l.catalogId} line={l} open={picked === l.catalogId} onPick={() => pick(l.catalogId)} currency={plan.bom.currency} made>
                <p className="ws-guide__sub">
                  {makerLabel(byId.get(l.catalogId)?.identity.manufacturer ?? 'Unknown')}. A part you make rather than buy.
                </p>
              </Row>
            ))}
          </ul>
        </>
      ) : null}

      <button
        type="button"
        className="ws-guide__link ws-proj__csv"
        onClick={() => {
          downloadBlob(`${plan.build_id}-parts.csv`, new Blob([buildBomCsvClientSide(plan)], { type: 'text/csv' }));
          setNote('Saved the parts list');
        }}
        data-testid="workspace-export-csv"
      >
        <Icon name="download" size={12} /> Export the parts list (.csv)
      </button>
      <p className="ws-explorer__note" aria-live="polite">
        {print.busy ? 'Making the print file…' : note}
      </p>
    </div>
  );
}

function roleOf(plan: BuildPlan, catalogId: string): string | null {
  return plan.components.find((c) => c.catalog_id === catalogId)?.role ?? null;
}

function Row({
  line,
  open,
  onPick,
  currency,
  made,
  children,
}: {
  line: BuyLine;
  open: boolean;
  onPick: () => void;
  currency: string;
  made?: boolean;
  children: React.ReactNode;
}) {
  return (
    <li>
      <button type="button" className="ws-guide__row" aria-expanded={open} onClick={onPick} data-testid={`workspace-component-${line.catalogId}`}>
        <Icon name={made ? 'cube' : 'cart'} size={13} />
        <span>
          <strong>
            {line.quantity > 1 ? `${line.quantity} × ` : ''}
            {line.name}
          </strong>
          <span className="ws-guide__sub">
            {line.unitPrice !== null ? formatMoney(line.unitPrice * line.quantity, currency) : made ? 'Make it' : 'No price yet'}
            {line.url ? ` · ${line.vendor}` : ''}
          </span>
        </span>
      </button>
      {open ? (
        <div className="ws-proj__detail" data-testid="workspace-component-detail">
          {children}
        </div>
      ) : null}
    </li>
  );
}

function BuyDetail({
  line,
  cat,
  role,
  currency,
}: {
  line: BuyLine;
  cat: CatalogComponent | null;
  role: string | null;
  currency: string;
}) {
  const datasheet = safeHttpUrl(cat?.sourcing.datasheet_url ?? null);
  return (
    <>
      <p className="ws-guide__sub">
        {role ? `${rolePlain(role)}. ` : ''}
        {cat ? `Made by ${makerLabel(cat.identity.manufacturer)}${cat.identity.sku ? `, part ${cat.identity.sku}` : ''}.` : ''}
      </p>
      <dl className="ws-proj__facts">
        <div>
          <dt>Price</dt>
          <dd>
            {line.unitPrice !== null ? `${formatMoney(line.unitPrice, currency)} each` : 'Not checked'}
            {line.quantity > 1 ? ` · ${line.quantity} needed` : ''}
          </dd>
        </div>
        <div>
          <dt>Stock</dt>
          <dd>{line.inStock === 'in_stock' ? 'In stock' : line.inStock === 'out_of_stock' ? 'Out of stock' : 'Unknown'}</dd>
        </div>
        {line.checkedAt ? (
          <div>
            <dt>Checked</dt>
            <dd>{formatCheckedAt(line.checkedAt)}</dd>
          </div>
        ) : null}
      </dl>
      <div className="ws-guide__btns">
        {line.url ? (
          <a className="ws-btn ws-btn--primary ws-btn--sm" href={line.url} target="_blank" rel="noreferrer" data-testid="workspace-component-buy">
            {line.suggested ? 'See a suggested product' : `Buy at ${line.vendor}`}
            <Icon name="external" size={12} />
          </a>
        ) : (
          <span className="ws-guide__sub">No store checked for this part yet.</span>
        )}
        {datasheet ? (
          <a className="ws-btn ws-btn--sm" href={datasheet} target="_blank" rel="noreferrer">
            Datasheet
          </a>
        ) : null}
      </div>
    </>
  );
}
