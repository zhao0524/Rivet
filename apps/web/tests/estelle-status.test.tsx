import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FixtureSource, HttpSource, type RivetDataSource } from '../src/lib/contracts';
import { useStudioPlanStore } from '../src/lib/plan-store';
import {
  ESTELLE_STATUS,
  FIXTURE_STATUS_REASON,
  GROUNDED_RESULT,
  LEGACY_WEB_STATUS_SHAPE,
} from '../src/lib/rivet/__tests__/estelle-payloads';

afterEach(() => {
  cleanup();
});

type Route = (init: RequestInit) => Response | Promise<Response>;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** HttpSource whose fetch answers `"<METHOD> <path>"` routes; anything else is a 404. */
function httpSource(routes: Record<string, Route>) {
  const fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const route = routes[`${init.method ?? 'GET'} ${new URL(String(input)).pathname}`];
    return route ? route(init) : new Response('Not Found', { status: 404 });
  }) as typeof globalThis.fetch;
  return new HttpSource({ baseUrl: 'http://api.test:8065', fetch, eventSource: null });
}

const statusRoute = (route: Route) => httpSource({ 'GET /api/estelle/status': route });

function renderStore(source: RivetDataSource) {
  return renderHook(({ src }) => useStudioPlanStore({ initialDataSource: src }), {
    initialProps: { src: source },
  });
}

describe('useStudioPlanStore Estelle status (#65)', () => {
  it('is checking until the API answers', () => {
    const hanging: Route = ({ signal }) =>
      new Promise((_, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    const { result, unmount } = renderStore(statusRoute(hanging));
    expect(result.current.estelleStatus).toEqual({ kind: 'checking' });
    unmount();
  });

  it.each([
    ['disabled', ESTELLE_STATUS.disabled, 'disabled'],
    ['CLI-not-installed', ESTELLE_STATUS.cliMissing, 'unavailable'],
    ['not-authenticated', ESTELLE_STATUS.notAuthenticated, 'unavailable'],
    ['ready', ESTELLE_STATUS.ready, 'ready'],
  ] as const)('maps the API %s answer to %s and keeps its reason', async (_label, payload, kind) => {
    const { result } = renderStore(statusRoute(() => json(200, payload)));
    await waitFor(() => expect(result.current.estelleStatus.kind).toBe(kind));
    expect(result.current.estelleStatus).toEqual({ kind, status: payload });
  });

  it.each([
    [
      'a failed fetch',
      () => {
        throw new TypeError('fetch failed');
      },
      'NETWORK_ERROR',
    ],
    ['HTTP 500', () => new Response('Internal Server Error', { status: 500 }), 'HTTP_500'],
    ['a non-JSON body', () => new Response('<html>proxy error</html>', { status: 200 }), 'not valid JSON'],
    ['an invalid payload', () => json(200, LEGACY_WEB_STATUS_SHAPE), 'CONTRACT_VIOLATION'],
  ] as const)('reports %s as a network error, never as disabled or unavailable', async (_label, route, detail) => {
    const { result } = renderStore(statusRoute(route));
    await waitFor(() => expect(result.current.estelleStatus.kind).toBe('network_error'));
    const state = result.current.estelleStatus;
    expect(state.kind === 'network_error' ? state.message : '').toContain(detail);
  });

  it('keeps fixture mode unavailable with the fixture reason', async () => {
    const { result } = renderStore(new FixtureSource());
    await waitFor(() => expect(result.current.estelleStatus.kind).toBe('unavailable'));
    const state = result.current.estelleStatus;
    expect(state.kind === 'unavailable' ? state.status.reason : '').toBe(FIXTURE_STATUS_REASON);
  });

  it('waits longer than the API\'s 30 s doctor timeout before calling it a network error', async () => {
    const source = statusRoute(() => json(200, ESTELLE_STATUS.ready));
    const spy = vi.spyOn(source, 'getEstelleStatus');
    const { result } = renderStore(source);
    await waitFor(() => expect(result.current.estelleStatus.kind).toBe('ready'));
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 35_000 }));
  });

  it('grounds when ready and clears the result when the data source changes', async () => {
    const ready = httpSource({
      'GET /api/estelle/status': () => json(200, ESTELLE_STATUS.ready),
      'POST /api/estelle/ground': () => json(200, GROUNDED_RESULT),
    });
    const { result, rerender } = renderStore(ready);
    await waitFor(() => expect(result.current.estelleStatus.kind).toBe('ready'));

    await act(async () => {
      await result.current.runEstelleGround({ kind: 'locate', name: 'read_front_distance' });
    });
    expect(result.current.estelleGroundResult).toEqual(GROUNDED_RESULT);

    rerender({ src: statusRoute(() => json(200, ESTELLE_STATUS.disabled)) });
    await waitFor(() => expect(result.current.estelleStatus.kind).toBe('disabled'));
    expect(result.current.estelleGroundResult).toBeNull();
  });

  it('drops a grounding result that arrives after the data source changed', async () => {
    let releaseGround!: () => void;
    const ready = httpSource({
      'GET /api/estelle/status': () => json(200, ESTELLE_STATUS.ready),
      'POST /api/estelle/ground': () =>
        new Promise<Response>((resolve) => {
          releaseGround = () => resolve(json(200, GROUNDED_RESULT));
        }),
    });
    const { result, rerender } = renderStore(ready);
    await waitFor(() => expect(result.current.estelleStatus.kind).toBe('ready'));

    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.runEstelleGround({ kind: 'locate', name: 'read_front_distance' });
    });
    expect(result.current.estelleLoading).toBe(true);

    rerender({ src: statusRoute(() => json(200, ESTELLE_STATUS.disabled)) });
    await waitFor(() => expect(result.current.estelleStatus.kind).toBe('disabled'));
    expect(result.current.estelleLoading).toBe(false);

    await act(async () => {
      releaseGround();
      await pending;
    });
    expect(result.current.estelleGroundResult).toBeNull();
    expect(result.current.estelleLoading).toBe(false);
  });
});
