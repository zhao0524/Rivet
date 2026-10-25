import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import NotFound from '../src/app/not-found';

vi.mock('next/navigation', () => ({
  usePathname: () => '/missing',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));

afterEach(() => cleanup());

describe('404 page', () => {
  it('keeps the app frame and offers the home page and projects instead of a bare Next error', () => {
    render(<NotFound />);
    expect(screen.getByTestId('not-found')).toBeDefined();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/nothing at this address/i);
    expect(screen.getByTestId('nav-projects').getAttribute('href')).toBe('/projects');
    expect(screen.getByTestId('not-found-home').getAttribute('href')).toBe('/');
    expect(screen.getByTestId('not-found-projects').getAttribute('href')).toBe('/projects');
    expect(screen.getByTestId('theme-toggle')).toBeDefined();
  });
});
