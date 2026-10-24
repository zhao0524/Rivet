'use client';

import type { BuyLine } from '../../../lib/flow/derive';
import { formatMoney } from '../../../lib/flow/derive';
import { Icon } from '../../system/Icon';
import { Modal } from '../../system/Modal';
import { NO_VENDOR, groupByVendor, isOwned } from './buy-model';

export interface CartModalProps {
  open: boolean;
  onClose: () => void;
  lines: readonly BuyLine[];
  ownedIds: readonly string[];
  currency: string;
  onContinue: () => void;
}

/**
 * "Open cart": Rivet has no checkout integration, so this lists each vendor's verified product
 * pages as links that open in a new tab. Parts without a verified vendor are named, not linked.
 * Bulk "open all" is omitted on purpose: browsers block more than one window per click.
 */
export function CartModal({ open, onClose, lines, ownedIds, currency, onContinue }: CartModalProps) {
  const toBuy = lines.filter((l) => !isOwned(l, ownedIds));
  const groups = groupByVendor(toBuy, ownedIds);
  const vendors = groups.filter((g) => g.vendor !== NO_VENDOR);
  const unverified = groups.find((g) => g.vendor === NO_VENDOR)?.lines ?? [];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Your cart, by vendor"
      description="Each link opens the vendor's product page in a new tab. Rivet has no checkout of its own, so open the buy links one by one."
      testId="buy-cart"
      footer={
        <button type="button" className="ui-btn ui-btn--primary" onClick={onContinue} data-testid="buy-cart-continue">
          Continue to Build
        </button>
      }
    >
      {vendors.length === 0 ? (
        <p className="ui-muted" data-testid="buy-cart-empty">
          Nothing left to buy from a verified vendor.
        </p>
      ) : null}
      {vendors.map((group) => (
        <section key={group.vendor} className="buy-cart__vendor" aria-labelledby={`cart-${group.vendor}`} data-testid={`buy-cart-vendor-${group.vendor}`}>
          <div className="p2-kv">
            <h3 id={`cart-${group.vendor}`} className="ui-h3">
              {group.vendor}
            </h3>
            <span className="ui-small ui-muted">
              {group.lines.length} {group.lines.length === 1 ? 'item' : 'items'} · {formatMoney(group.subtotal, currency)}
              {group.unknownPriceCount > 0 ? ' + unknown' : ''}
            </span>
          </div>
          <ul className="buy-cart__list">
            {group.lines.map((line) => (
              <li key={line.catalogId}>
                <a className="buy-cart__link" href={line.url ?? undefined} target="_blank" rel="noopener noreferrer" data-testid={`buy-cart-link-${line.catalogId}`}>
                  <Icon name="external" aria-hidden="true" />
                  <span className="list__main">
                    <span className="list__title">{line.name}</span>
                    <span className="list__meta">Qty {line.quantity}</span>
                  </span>
                  <span className="buy-line__price">
                    {line.unitPrice === null ? 'Price unknown' : formatMoney(line.unitPrice * line.quantity, currency)}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {unverified.length > 0 ? (
        <section className="buy-cart__vendor" aria-labelledby="cart-no-vendor" data-testid="buy-cart-no-vendor">
          <h3 id="cart-no-vendor" className="ui-h3">
            {NO_VENDOR}
          </h3>
          <p className="p2-note">
            Rivet has no verified product page for {unverified.length === 1 ? 'this part' : 'these parts'}, so there is no link to open:{' '}
            {unverified.map((l) => l.name).join(', ')}.
          </p>
        </section>
      ) : null}
    </Modal>
  );
}
