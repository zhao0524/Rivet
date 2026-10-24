// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { forwardRef, useEffect, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const canvasLifecycle = vi.hoisted(() => ({ mounts: 0, unmounts: 0, lastProps: {} as Record<string, unknown> }));
const webgl = vi.hoisted(() => ({ supported: true }));

vi.mock('@react-three/fiber', () => ({
  Canvas: forwardRef<HTMLCanvasElement, Record<string, unknown> & { children?: ReactNode }>(function MockCanvas(props, ref) {
    canvasLifecycle.lastProps = props;
    useEffect(() => {
      canvasLifecycle.mounts += 1;
      return () => {
        canvasLifecycle.unmounts += 1;
      };
    }, []);
    if (props['data-throw']) throw new Error('context creation failed');
    return <canvas ref={ref} data-testid="stage-canvas" data-frameloop={String(props.frameloop)} />;
  }),
  useThree: vi.fn(),
  useFrame: vi.fn(),
}));
vi.mock('@react-three/drei', () => ({ OrbitControls: () => null, Environment: () => null, Lightformer: () => null, ContactShadows: () => null, Grid: () => null }));
vi.mock('../webgl', () => ({ detectWebGLSupport: () => webgl.supported, prefersReducedMotion: () => false }));

import { RivetStage, STAGE_DPR } from '../RivetStage';

beforeEach(() => {
  canvasLifecycle.mounts = 0;
  canvasLifecycle.unmounts = 0;
  webgl.supported = true;
});
afterEach(cleanup);

const Child = ({ name }: { name: string }) => <mesh name={name} />;

describe('RivetStage', () => {
  it('renders one canvas for any number of children', () => {
    const { getAllByTestId } = render(
      <RivetStage>
        {Array.from({ length: 12 }, (_, i) => (
          <Child key={i} name={`part-${i}`} />
        ))}
      </RivetStage>,
    );
    expect(getAllByTestId('stage-canvas')).toHaveLength(1);
    expect(canvasLifecycle.mounts).toBe(1);
  });

  it('keeps the same canvas across prop changes and resizes', () => {
    const { getByTestId, getAllByTestId, rerender, container } = render(<RivetStage resetSignal={0} />);
    const first = getByTestId('stage-canvas');
    for (let i = 1; i <= 20; i++) {
      act(() => {
        window.innerWidth = 400 + i * 37;
        window.innerHeight = 300 + i * 11;
        window.dispatchEvent(new Event('resize'));
      });
      rerender(
        <RivetStage
          resetSignal={i}
          showGrid={i % 2 === 0}
          boundsMm={{ min: [-i, 0, -i], max: [i, i, i] }}
          style={{ width: 400 + i * 37, height: 300 + i * 11 }}
        >
          <Child name={`p${i}`} />
        </RivetStage>,
      );
    }
    expect(getAllByTestId('stage-canvas')).toHaveLength(1);
    expect(getByTestId('stage-canvas')).toBe(first);
    expect(container.querySelectorAll('canvas')).toHaveLength(1);
    expect(canvasLifecycle.mounts).toBe(1);
    expect(canvasLifecycle.unmounts).toBe(0);
  });

  it('renders on demand, stops when inactive and caps the pixel ratio', () => {
    const { getByTestId, rerender } = render(<RivetStage />);
    expect(getByTestId('stage-canvas').dataset.frameloop).toBe('demand');
    expect(canvasLifecycle.lastProps.dpr).toEqual(STAGE_DPR);
    expect(Math.max(...STAGE_DPR)).toBeLessThanOrEqual(1.5);
    rerender(<RivetStage active={false} />);
    expect(getByTestId('stage-canvas').dataset.frameloop).toBe('never');
    expect(canvasLifecycle.mounts).toBe(1);
  });

  it('wires background clicks to pointer-missed events', () => {
    const onBackgroundClick = vi.fn();
    render(<RivetStage onBackgroundClick={onBackgroundClick} />);
    (canvasLifecycle.lastProps.onPointerMissed as (e: MouseEvent) => void)(new MouseEvent('click'));
    expect(onBackgroundClick).toHaveBeenCalledTimes(1);
  });

  it('releases the canvas on unmount', () => {
    const { unmount } = render(<RivetStage />);
    unmount();
    expect(canvasLifecycle.unmounts).toBe(1);
  });

  it('shows a fallback instead of a canvas when WebGL is unavailable', () => {
    webgl.supported = false;
    const { queryByTestId, getByRole, container } = render(<RivetStage />);
    expect(queryByTestId('stage-canvas')).toBeNull();
    expect(getByRole('status').textContent).toMatch(/3D view unavailable/);
    expect(container.querySelector('[data-rivet-stage]')?.getAttribute('data-stage-state')).toBe('unavailable');
  });

  it('accepts a custom fallback', () => {
    webgl.supported = false;
    const { getByText } = render(<RivetStage fallback={<p>static preview</p>} />);
    expect(getByText('static preview')).toBeTruthy();
  });
});
