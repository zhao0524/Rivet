'use client';

import { useState } from 'react';
import {
  OFFER_FIXTURE_LABEL,
  OFFER_FIXTURE_NAMES,
  isOfferFixtureName,
  offerFixture,
  type OfferFixtureName,
} from '../../../lib/offers/fixtures';
import { REFUSED_MESSAGE } from '../../../lib/offers/format';
import { OffersPanel, type OffersState } from '../panels/OffersPanel';

/** The fixed clock the offer fixtures were generated against, so "checked N days ago" stays stable. */
export const OFFER_FIXTURE_NOW = new Date('2026-10-25T00:00:00Z');

export function offersStateForFixture(name: OfferFixtureName): OffersState {
  const offerSet = offerFixture(name);
  if (offerSet.outcome === 'refused') return { status: 'refused', offerSet, message: REFUSED_MESSAGE };
  return { status: 'ready', offerSet };
}

/**
 * Fixture-mode only: renders one checked-in `fixtures/offers/*` example so every panel
 * state can be seen without a vendor lookup. Opened from `/studio?offers=<name>`.
 */
export function OffersDialogBody({ initialFixture }: { initialFixture: OfferFixtureName }) {
  const [name, setName] = useState<OfferFixtureName>(initialFixture);
  return (
    <div style={{ display: 'grid', gap: 12 }} data-testid="offers-dialog-body" data-fixture={name}>
      <p role="status" data-testid="offers-saved-banner" className="rv-muted" style={{ margin: 0 }}>
        Saved example, not a live lookup. These offers come from checked-in fixtures; no vendor page was fetched now.
      </p>
      <label style={{ display: 'grid', gap: 4 }}>
        <span>Example offer set</span>
        <select
          className="rv-select"
          data-testid="offers-fixture-select"
          value={name}
          onChange={(e) => isOfferFixtureName(e.target.value) && setName(e.target.value)}
        >
          {OFFER_FIXTURE_NAMES.map((n) => (
            <option key={n} value={n}>
              {OFFER_FIXTURE_LABEL[n]}
            </option>
          ))}
        </select>
      </label>
      <OffersPanel key={name} state={offersStateForFixture(name)} savedExample now={OFFER_FIXTURE_NOW} />
    </div>
  );
}
