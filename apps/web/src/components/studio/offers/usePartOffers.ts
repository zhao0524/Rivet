'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { isRivetError, type RivetDataSource } from '../../../lib/rivet';
import { safeParseOfferSet } from '../../../lib/offers/validate';
import { REFUSED_MESSAGE } from '../../../lib/offers/format';
import type { OffersState } from '../panels/OffersPanel';

export type OffersSource = Pick<RivetDataSource, 'getPartOffers' | 'mode'>;

export const REFUSED_SYNTHETIC_CODE = 'EXPORT_REFUSED_SYNTHETIC';

/** Maps a data-source rejection to a panel state; a 422 synthetic refusal is a state, not an error. */
export function offersStateFromError(err: unknown): OffersState {
  if (isRivetError(err)) {
    if (err.code === REFUSED_SYNTHETIC_CODE) {
      const parsed = safeParseOfferSet(err.details?.offer_set);
      return { status: 'refused', offerSet: parsed.ok ? parsed.value : null, message: err.message || REFUSED_MESSAGE };
    }
    return { status: 'error', error: { code: err.code, message: err.message, hint: err.hint, retryable: err.retryable } };
  }
  return { status: 'error', error: { code: 'UNKNOWN', message: err instanceof Error ? err.message : String(err) } };
}

/**
 * Loads `GET /api/parts/{catalog_id}/offers` for each catalog id through the active data
 * source, one request per part, aborting stale requests when the selection or source
 * changes. A source without `getPartOffers` yields `idle` for every id.
 */
export function usePartOffers(source: OffersSource | null, catalogIds: readonly string[]) {
  const key = useMemo(() => [...new Set(catalogIds)].sort().join('\u0000'), [catalogIds]);
  const ids = useMemo(() => (key === '' ? [] : key.split('\u0000')), [key]);
  const [states, setStates] = useState<Record<string, OffersState>>({});
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!source || typeof source.getPartOffers !== 'function') {
      setStates(Object.fromEntries(ids.map((id) => [id, { status: 'idle' } as OffersState])));
      return;
    }
    const getPartOffers = source.getPartOffers.bind(source);
    const controller = new AbortController();
    setStates(Object.fromEntries(ids.map((id) => [id, { status: 'loading' } as OffersState])));
    for (const id of ids) {
      getPartOffers(id, undefined, { signal: controller.signal })
        .then((offerSet) => {
          if (controller.signal.aborted) return;
          setStates((prev) => ({ ...prev, [id]: { status: 'ready', offerSet } }));
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          setStates((prev) => ({ ...prev, [id]: offersStateFromError(err) }));
        });
    }
    return () => controller.abort();
  }, [source, ids, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { states, retry };
}
