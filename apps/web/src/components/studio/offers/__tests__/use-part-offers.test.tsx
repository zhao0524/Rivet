import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { FixtureSource, RivetError } from '../../../../lib/rivet';
import { offerFixture } from '../../../../lib/offers/fixtures';
import { offersStateFromError, usePartOffers, type OffersSource } from '../usePartOffers';

afterEach(cleanup);

function Probe({ source, ids }: { source: OffersSource | null; ids: string[] }) {
  const { states } = usePartOffers(source, ids);
  return (
    <ul>
      {Object.entries(states).map(([id, s]) => (
        <li key={id} data-testid={`state-${id}`} data-status={s.status}>
          {s.status === 'ready' ? s.offerSet.outcome : s.status === 'error' ? s.error.code : ''}
        </li>
      ))}
    </ul>
  );
}

describe('usePartOffers', () => {
  it('loads each part through the fixture source without the network and maps the demo refusal to a state', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    render(<Probe source={new FixtureSource()} ids={['demo.tt_motor', 'motor.adafruit_tt_bimetal_1to90_3801', 'board.unknown']} />);
    await waitFor(() => expect(screen.getByTestId('state-demo.tt_motor').dataset.status).toBe('refused'));
    await waitFor(() => expect(screen.getByTestId('state-motor.adafruit_tt_bimetal_1to90_3801').textContent).toBe('found'));
    await waitFor(() => expect(screen.getByTestId('state-board.unknown').textContent).toBe('not_found'));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('yields idle for a source without getPartOffers', () => {
    render(<Probe source={{ mode: 'http' }} ids={['x']} />);
    expect(screen.getByTestId('state-x').dataset.status).toBe('idle');
  });

  it('reports other rejections as errors and ignores results from aborted requests', async () => {
    const source: OffersSource = {
      mode: 'http',
      getPartOffers: vi.fn(async (id: string, _p, options) => {
        if (id === 'slow') {
          await new Promise((r) => setTimeout(r, 20));
          if (options?.signal?.aborted) throw new RivetError({ kind: 'aborted', code: 'ABORTED', message: 'aborted' });
          return offerFixture('adafruit-3801');
        }
        throw new RivetError({ kind: 'upstream_unavailable', code: 'PROVIDER_UNAVAILABLE', message: 'down' });
      }),
    };
    const { rerender } = render(<Probe source={source} ids={['slow', 'bad']} />);
    await waitFor(() => expect(screen.getByTestId('state-bad').textContent).toBe('PROVIDER_UNAVAILABLE'));
    rerender(<Probe source={source} ids={['bad']} />);
    await waitFor(() => expect(screen.getByTestId('state-bad').textContent).toBe('PROVIDER_UNAVAILABLE'));
    await act(() => new Promise((r) => setTimeout(r, 40)));
    expect(screen.queryByTestId('state-slow')).toBeNull();
    expect(source.getPartOffers).toHaveBeenCalledTimes(3);
  });

  it('offersStateFromError keeps the refused set when it validates', () => {
    const refused = offerFixture('refused-synthetic-demo-part');
    const state = offersStateFromError(
      new RivetError({ kind: 'unsupported', code: 'EXPORT_REFUSED_SYNTHETIC', message: 'no', details: { offer_set: refused } }),
    );
    expect(state.status).toBe('refused');
    if (state.status === 'refused') expect(state.offerSet?.outcome).toBe('refused');
    const plain = offersStateFromError(new Error('boom'));
    expect(plain).toEqual({ status: 'error', error: { code: 'UNKNOWN', message: 'boom' } });
  });
});
