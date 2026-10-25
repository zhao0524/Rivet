import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({ pathname: '/', push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: nav.push, replace: nav.replace, back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}));

import { clearNavigating, markNavigating, NavigationWatch, projectStepOf, useAppRouter, usePendingNavigation } from '../src/components/system/Navigation';

function Probe() {
  const p = usePendingNavigation();
  return <span data-testid="probe">{p?.path ?? 'none'}</span>;
}

afterEach(() => {
  clearNavigating();
  vi.useRealTimers();
});

describe('navigation feedback', () => {
  it('ignores navigations when no watcher is mounted, so nothing can get stuck', () => {
    render(<Probe />);
    act(() => markNavigating('/projects'));
    expect(screen.getByTestId('probe').textContent).toBe('none');
  });

  it('shows a slow navigation after a beat, with the destination skeleton', () => {
    vi.useFakeTimers();
    render(
      <>
        <NavigationWatch />
        <Probe />
      </>,
    );
    act(() => markNavigating('/projects'));
    expect(screen.getByTestId('probe').textContent).toBe('none');
    act(() => vi.advanceTimersByTime(150));
    expect(screen.getByTestId('probe').textContent).toBe('/projects');
    expect(screen.getByTestId('navigation-skeleton')).toBeDefined();
    expect(screen.getByTestId('projects-skeleton')).toBeDefined();
  });

  it('router.push through useAppRouter keeps Next\'s arguments and reports the destination', () => {
    function Push() {
      const router = useAppRouter();
      return <button onClick={() => router.push('/new')}>go</button>;
    }
    render(<Push />);
    act(() => screen.getByText('go').click());
    expect(nav.push).toHaveBeenCalledWith('/new');
  });

  it('reads project step paths', () => {
    expect(projectStepOf('/p/p_1/parts')).toEqual({ id: 'p_1', step: 'parts' });
    expect(projectStepOf('/p/p_1')).toEqual({ id: 'p_1', step: '' });
    expect(projectStepOf('/new')).toBeNull();
  });
});
