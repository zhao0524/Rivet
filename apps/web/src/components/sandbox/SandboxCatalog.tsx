'use client';

import Link from 'next/link';
import { useDeferredValue, useMemo, useState } from 'react';
import { CATEGORY_LABEL } from '../../lib/showcase/format';
import { SHOWCASE_CATEGORIES } from '../../lib/showcase/types';
import { sandboxProducts } from '../../lib/sandbox/catalog';
import { searchProducts, type CategoryFilter } from '../../lib/sandbox/search';
import { DEMO_LABEL } from '../../lib/sandbox/types';
import { AppHeader } from '../flow/AppHeader';
import '../../styles/start.css';
import '../../styles/sandbox.css';

/** Sandbox home: search the hard-coded catalogue, filter by category, open one product in 3D. */
export function SandboxCatalog() {
  const products = sandboxProducts();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<CategoryFilter>('all');
  const deferred = useDeferredValue(query);
  const results = useMemo(() => searchProducts(products, deferred, category), [products, deferred, category]);
  const present = useMemo(() => new Set(products.map((p) => p.category)), [products]);

  return (
    <>
      <AppHeader />
      <main className="app-main" data-testid="sandbox-catalog">
        <div className="start-head">
          <div className="start-head__text">
            <h1 className="ui-h1">Sandbox</h1>
            <p className="ui-lede">
              Pick a product, then click each part to inspect it. {products.length} products; search by name, part, SKU or maker.
            </p>
          </div>
        </div>

        <div className="sbx-filters">
          <div className="ui-field sbx-search">
            <label className="ui-label ui-sr-only" htmlFor="sandbox-search">Search products</label>
            <input
              id="sandbox-search"
              type="search"
              className="ui-input"
              placeholder="Search products, parts or SKUs"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              data-testid="sandbox-search"
            />
          </div>
          <div className="ui-tabs" role="group" aria-label="Category">
            {(['all', ...SHOWCASE_CATEGORIES.filter((c) => present.has(c))] as CategoryFilter[]).map((c) => (
              <button
                key={c}
                type="button"
                className="ui-tab"
                aria-pressed={category === c}
                onClick={() => setCategory(c)}
                data-testid={`sandbox-cat-${c}`}
              >
                {c === 'all' ? 'All' : CATEGORY_LABEL[c]}
              </button>
            ))}
          </div>
        </div>

        <p className="ui-small ui-muted" aria-live="polite" data-testid="sandbox-count">
          {results.length} of {products.length} products
        </p>

        {results.length === 0 ? (
          <div className="ui-card ui-card--pad" data-testid="sandbox-empty">
            <p className="ui-muted" style={{ margin: 0 }}>No product matches. Try a part name or a SKU like 2939.</p>
          </div>
        ) : (
          <ul className="start-grid" data-testid="sandbox-grid">
            {results.map((p) => (
              <li key={p.product_id} className="ui-card pc" data-testid={`sandbox-card-${p.product_id}`}>
                <Link href={`/sandbox/${p.product_id}`} className="pc__link" aria-label={`Open ${p.name}`}>
                  <h2 className="pc__title">{p.name}</h2>
                  <p className="pc__prompt">{p.summary}</p>
                  <div className="pc__foot">
                    <span className={p.kind === 'demo' ? 'ui-badge' : 'ui-badge ui-badge--ok'}>{p.kind === 'demo' ? DEMO_LABEL : 'Real parts list'}</span>
                    <span>{CATEGORY_LABEL[p.category]} · {p.parts.length} parts</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
