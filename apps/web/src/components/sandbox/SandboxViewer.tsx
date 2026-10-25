'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CATEGORY_LABEL } from '../../lib/showcase/format';
import { sandboxProduct } from '../../lib/sandbox/catalog';
import { DEMO_HONESTY, DEMO_LABEL, SHOWCASE_LAYOUT_HONESTY, type SandboxPart, type SandboxProduct } from '../../lib/sandbox/types';
import { AppHeader } from '../flow/AppHeader';
import { Icon } from '../system/Icon';
import { useThemeMode } from '../system/ThemeToggle';
import { usePartSelection } from '../three/interactions';
import { SandboxScene } from './SandboxScene';
import '../../styles/phase1.css';
import '../../styles/sandbox.css';

const mm = (v: readonly number[]) => v.map((n) => Math.round(n * 10) / 10).join(' × ');

function groupParts(parts: readonly SandboxPart[]) {
  const groups = new Map<string, SandboxPart[]>();
  for (const p of parts) groups.set(p.group, [...(groups.get(p.group) ?? []), p]);
  return [...groups].map(([group, rows]) => ({ group, rows }));
}

function PartDetail({ part, onClear }: { part: SandboxPart; onClear: () => void }) {
  const s = part.sourcing;
  return (
    <section className="ui-card ui-card--pad sbx-detail" aria-label={`Selected part: ${part.name}`} data-testid="sandbox-detail">
      <div className="sbx-detail__head">
        <div>
          <p className="ui-eyebrow">{part.group}</p>
          <h2 className="ui-h2" data-testid="sandbox-detail-name">{part.name}</h2>
        </div>
        <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={onClear} data-testid="sandbox-clear">
          Whole product
        </button>
      </div>
      <p className="ui-muted sbx-detail__note">{part.note}</p>
      <dl className="p1-spec__meta">
        <div><dt>Quantity</dt><dd>{part.quantity}</dd></div>
        <div><dt>Shape</dt><dd>{part.shape}</dd></div>
        <div><dt>Size (mm)</dt><dd>{mm(part.size_mm)}</dd></div>
        <div><dt>Position (mm)</dt><dd>{mm(part.position_mm)}</dd></div>
      </dl>
      {s ? (
        <dl className="p1-spec__meta" data-testid="sandbox-sourcing">
          <div><dt>SKU</dt><dd>{s.sku}</dd></div>
          <div><dt>Part number</dt><dd>{s.mpn ?? 'Not stated'}</dd></div>
          <div><dt>Maker</dt><dd>{s.manufacturer ?? 'Not stated'}</dd></div>
          <div><dt>Vendor</dt><dd>{s.vendor}</dd></div>
          <div><dt>Price</dt><dd>{s.price}</dd></div>
          <div><dt>Stock</dt><dd>{s.availability}</dd></div>
          <div>
            <dt>Evidence</dt>
            <dd><span className={s.evidence_level === 'verified' ? 'ui-badge ui-badge--ok' : 'ui-badge ui-badge--warn'}>{s.evidence_level}</span></dd>
          </div>
          <div>
            <dt>Vendor page</dt>
            <dd><a href={s.url} target="_blank" rel="noreferrer noopener" className="ui-btn ui-btn--link">Open <Icon name="external" size={12} /></a></dd>
          </div>
        </dl>
      ) : null}
    </section>
  );
}

function ProductSummary({ product }: { product: SandboxProduct }) {
  const demo = product.kind === 'demo';
  return (
    <section className="ui-card ui-card--pad sbx-detail" aria-label="Whole product" data-testid="sandbox-summary">
      <p className="ui-eyebrow">{CATEGORY_LABEL[product.category]}</p>
      <p className="ui-muted sbx-detail__note">{product.summary}</p>
      <div className="ui-notice" role="note">
        <Icon name="info" />
        <span>{demo ? DEMO_HONESTY : SHOWCASE_LAYOUT_HONESTY}</span>
      </div>
      {product.source ? (
        <a href={product.source.url} target="_blank" rel="noreferrer noopener" className="ui-btn ui-btn--link">
          Parts list source: {product.source.title} <Icon name="external" size={12} />
        </a>
      ) : null}
    </section>
  );
}

/** Sandbox for one catalogue product: pick the product, then click any part (list or model) to inspect it. */
export function SandboxViewer({ productId }: { productId: string }) {
  const product = useMemo(() => sandboxProduct(productId), [productId]);
  if (!product) {
    return (
      <>
        <AppHeader />
        <main className="app-main app-main--narrow" data-testid="sandbox-missing">
          <h1 className="ui-h1">No such product</h1>
          <p className="ui-lede">"{productId}" is not in the sandbox catalogue.</p>
          <Link href="/sandbox" className="ui-btn ui-btn--primary">Back to the catalogue</Link>
        </main>
      </>
    );
  }
  return <Loaded product={product} />;
}

function Loaded({ product }: { product: SandboxProduct }) {
  const themeMode = useThemeMode();
  const [exploded, setExploded] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  const plan = useMemo(
    () => ({
      build_id: product.product_id,
      revision: 1,
      components: product.parts.map((p) => ({ instance_id: p.part_id, catalog_id: p.part_id, role: p.group })),
    }),
    [product],
  );
  const byId = useMemo(() => new Map(product.parts.map((p) => [p.part_id, p])), [product]);
  const groups = useMemo(() => groupParts(product.parts), [product.parts]);

  const rowRefs = useRef(new Map<string, HTMLElement>());
  const selection = usePartSelection(plan, {
    getLabel: (c) => byId.get(c.instance_id)?.name ?? c.instance_id,
    onSelectionChange: (e) => {
      if (e.reason === 'pointer' && e.instance_id) rowRefs.current.get(e.instance_id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    },
  });
  const selectedId = selection.selectedInstanceId;
  const selected = selectedId ? byId.get(selectedId) ?? null : null;
  const isolated = selection.state.isolated_instance_id;

  // `?part=<id>` preselects a part, so a link can point at one.
  const preselect = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('part');
  useEffect(() => {
    if (preselect && byId.has(preselect)) selection.select(preselect, { reason: 'api' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselect, byId]);

  const clear = useCallback(() => {
    selection.exitIsolation();
    selection.clearSelection();
  }, [selection]);

  const demo = product.kind === 'demo';
  return (
    <>
      <AppHeader
        center={<span className="sbx-crumb"><Link href="/sandbox">Sandbox</Link> <span aria-hidden="true">/</span> {product.name}</span>}
      />
      <main className="app-main" data-testid="sandbox-viewer" data-product-id={product.product_id}>
        <div className="start-head">
          <div className="start-head__text">
            <div className="sbx-title">
              <h1 className="ui-h1">{product.name}</h1>
              <span className={demo ? 'ui-badge' : 'ui-badge ui-badge--ok'}>{demo ? DEMO_LABEL : 'Real parts list'}</span>
            </div>
            <p className="ui-lede">
              {product.parts.length} parts. Click the model or a row to highlight one part.
            </p>
          </div>
        </div>

        <div className="split">
          <div className="p1-stack">
            <div className="p1-parts-tools">
              <button
                type="button"
                role="switch"
                aria-checked={exploded}
                className="ui-switch"
                onClick={() => setExploded((v) => !v)}
                data-testid="sandbox-explode"
              >
                <span className="ui-switch__track" aria-hidden="true" />
                Explode view
              </button>
              <div className="sbx-tools">
                <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={!selectedId || !!isolated} onClick={() => selection.isolate()} data-testid="sandbox-isolate">
                  Isolate
                </button>
                <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" disabled={!selectedId && !isolated} onClick={clear} data-testid="sandbox-reset">
                  Reset
                </button>
              </div>
            </div>
            <div className="p1-groups" data-testid="sandbox-parts">
              {groups.map(({ group, rows }) => (
                <details key={group} className="p1-details p1-group" open>
                  <summary>
                    <span>{group} <span className="p1-count">({rows.length})</span></span>
                  </summary>
                  <ul className="list">
                    {rows.map((p) => (
                      <li key={p.part_id}>
                        <button
                          type="button"
                          className="list__row"
                          ref={(el) => {
                            if (el) rowRefs.current.set(p.part_id, el);
                            else rowRefs.current.delete(p.part_id);
                          }}
                          aria-current={selectedId === p.part_id || undefined}
                          onClick={() => selection.select(p.part_id, { reason: 'api', reveal: true })}
                          onPointerEnter={() => selection.controller.hover(p.part_id)}
                          onPointerLeave={() => selection.controller.clearHover()}
                          data-testid={`sandbox-row-${p.part_id}`}
                        >
                          <span className="sbx-swatch" style={{ background: p.color }} aria-hidden="true" />
                          <span className="list__main">
                            <span className="list__title">{p.name}</span>
                            <span className="list__meta">
                              {p.sourcing ? `SKU ${p.sourcing.sku} · ${p.sourcing.vendor}` : `${p.shape} · ${mm(p.size_mm)} mm`}
                              {p.quantity > 1 ? ` · ×${p.quantity}` : ''}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
            </div>
          </div>

          <div className="p1-sticky sbx-stack">
            <div className="viewport" data-testid="sandbox-viewport">
              <SandboxScene product={product} selection={selection} exploded={exploded} themeMode={themeMode} resetSignal={resetKey} />
              <span className="viewport__label">{selected ? selected.name : 'Click a part to select it'}</span>
              <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm sbx-recenter" onClick={() => setResetKey((k) => k + 1)} data-testid="sandbox-recenter">
                Re-center
              </button>
              {selection.hoverLabel && selection.hoverLabel !== selected?.name ? (
                <span role="status" className="sbx-hover" data-testid="sandbox-hover">{selection.hoverLabel}</span>
              ) : null}
            </div>
            {selected ? <PartDetail part={selected} onClear={clear} /> : <ProductSummary product={product} />}
          </div>
        </div>
      </main>
    </>
  );
}
