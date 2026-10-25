import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { sandboxProducts } from '../../../lib/sandbox/catalog';
import { SandboxCatalog } from '../SandboxCatalog';

afterEach(cleanup);

describe('SandboxCatalog', () => {
  it('shows every product as a link to its viewer', () => {
    render(<SandboxCatalog />);
    const products = sandboxProducts();
    expect(screen.getByTestId('sandbox-count').textContent).toBe(`${products.length} of ${products.length} products`);
    const first = screen.getByTestId(`sandbox-card-${products[0].product_id}`).querySelector('a');
    expect(first?.getAttribute('href')).toBe(`/sandbox/${products[0].product_id}`);
  });

  it('narrows by search text and by category, and says so when nothing matches', async () => {
    render(<SandboxCatalog />);
    fireEvent.change(screen.getByTestId('sandbox-search'), { target: { value: '2939' } });
    expect(await screen.findByTestId('sandbox-card-sample-simple-raspberry-pi-robot')).toBeTruthy();
    expect(screen.queryByTestId('sandbox-card-demo-pocket-rover-2wd')).toBeNull();

    fireEvent.change(screen.getByTestId('sandbox-search'), { target: { value: 'zzzznothing' } });
    expect(await screen.findByTestId('sandbox-empty')).toBeTruthy();

    fireEvent.change(screen.getByTestId('sandbox-search'), { target: { value: '' } });
    fireEvent.click(screen.getByTestId('sandbox-cat-drone'));
    expect(await screen.findByTestId('sandbox-card-demo-camera-drone')).toBeTruthy();
    expect(screen.queryByTestId('sandbox-card-demo-pocket-rover-2wd')).toBeNull();
  });
});
