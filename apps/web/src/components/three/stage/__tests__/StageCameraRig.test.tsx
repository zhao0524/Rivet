import ReactThreeTestRenderer from '@react-three/test-renderer';
import { useThree, type RootState } from '@react-three/fiber';
import { EventDispatcher, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { RESET_TRANSITION_MS, StageCameraRig, useStageFit } from '../StageCameraRig';
import { fitCameraToBounds, STAGE_FOV_DEG, type CameraFit } from '../cameraFit';
import { boundsMmToScene, type Bounds3 } from '../units';

class FakeControls extends EventDispatcher<{ start: object }> {
  target = new Vector3();
  enableDamping = true;
  constructor(private camera: PerspectiveCamera) {
    super();
  }
  update() {
    this.camera.lookAt(this.target);
    return true;
  }
  grab() {
    this.dispatchEvent({ type: 'start' });
  }
}

const ROVER = boundsMmToScene({ min: [-117, 0, -95], max: [117, 90, 98] });
const WIDE = boundsMmToScene({ min: [-900, 0, -30], max: [900, 60, 30] });

let store: RootState | null = null;
let lastFit: CameraFit | null = null;

function Scene({ bounds, resetSignal }: { bounds: Bounds3; resetSignal?: number }) {
  store = useThree();
  const fit = useStageFit(bounds);
  lastFit = fit;
  return <StageCameraRig fit={fit} resetSignal={resetSignal} />;
}

async function setup(width: number, height: number) {
  const camera = new PerspectiveCamera(STAGE_FOV_DEG, width / height, 0.001, 100);
  const renderer = await ReactThreeTestRenderer.create(<Scene bounds={ROVER} resetSignal={0} />, { width, height, camera });
  const cam = store!.camera as PerspectiveCamera;
  const controls = new FakeControls(cam);
  await ReactThreeTestRenderer.act(async () => store!.set({ controls: controls as never }));
  return { renderer, camera: cam, controls };
}

const pos = (v: Vector3) => v.toArray();

describe('StageCameraRig', () => {
  it('opens on the fitted view and applies clipping planes', async () => {
    const { camera, controls } = await setup(1280, 720);
    const expected = fitCameraToBounds(ROVER, { aspect: 1280 / 720 });
    pos(camera.position).forEach((v, i) => expect(v).toBeCloseTo(expected.position[i], 9));
    pos(controls.target).forEach((v, i) => expect(v).toBeCloseTo(expected.target[i], 9));
    expect(camera.near).toBeCloseTo(expected.near);
    expect(camera.far).toBeCloseTo(expected.far);
  });

  it('refits on resize until the user takes over, without remounting the scene', async () => {
    const { renderer, camera, controls } = await setup(1280, 720);
    const sceneBefore = renderer.scene.instance;
    const sizes: Array<[number, number]> = [
      [600, 900],
      [1920, 600],
      [800, 800],
    ];
    for (const [w, h] of sizes) {
      await ReactThreeTestRenderer.act(async () => store!.setSize(w, h));
      const expected = fitCameraToBounds(ROVER, { aspect: w / h });
      expect(camera.aspect).toBeCloseTo(w / h);
      expect(lastFit!.distance).toBeCloseTo(expected.distance);
      pos(camera.position).forEach((v, i) => expect(v).toBeCloseTo(expected.position[i], 9));
    }
    expect(renderer.scene.instance).toBe(sceneBefore);

    controls.grab();
    camera.position.set(0.5, 0.2, -0.4);
    await ReactThreeTestRenderer.act(async () => store!.setSize(1024, 512));
    expect(pos(camera.position)).toEqual([0.5, 0.2, -0.4]);
    expect(camera.aspect).toBeCloseTo(2);
  });

  it('animates back to the fitted view on reset and restores damping', async () => {
    const { renderer, camera, controls } = await setup(1280, 720);
    controls.grab();
    camera.position.set(0.6, 0.05, -0.6);
    controls.target.set(0.05, 0.01, 0.02);

    await renderer.update(<Scene bounds={ROVER} resetSignal={1} />);
    expect(controls.enableDamping).toBe(false);
    const expected = fitCameraToBounds(ROVER, { aspect: 1280 / 720 });
    const start = camera.position.clone();

    await renderer.advanceFrames(3, 1 / 60);
    const mid = camera.position.clone();
    expect(mid.equals(start)).toBe(false);
    expect(mid.distanceTo(new Vector3(...expected.position))).toBeGreaterThan(1e-4);

    const frames = Math.ceil(RESET_TRANSITION_MS / (1000 / 60)) + 2;
    await renderer.advanceFrames(frames, 1 / 60);
    pos(camera.position).forEach((v, i) => expect(v).toBeCloseTo(expected.position[i], 6));
    pos(controls.target).forEach((v, i) => expect(v).toBeCloseTo(expected.target[i], 6));
    expect(controls.enableDamping).toBe(true);
  });

  it('frames new bounds when the user has not moved the camera', async () => {
    const { renderer, camera } = await setup(1280, 720);
    await renderer.update(<Scene bounds={WIDE} resetSignal={0} />);
    await renderer.advanceFrames(40, 1 / 60);
    const expected = fitCameraToBounds(WIDE, { aspect: 1280 / 720 });
    pos(camera.position).forEach((v, i) => expect(v).toBeCloseTo(expected.position[i], 6));
  });

  it('keeps a panned target within reach of the framed volume', async () => {
    const { renderer, controls } = await setup(1280, 720);
    controls.grab();
    controls.target.set(5, -3, 5);
    await renderer.advanceFrames(1, 1 / 60);
    const fit = lastFit!;
    expect(controls.target.y).toBeCloseTo(fit.bounds.min[1]);
    expect(controls.target.x).toBeLessThanOrEqual(fit.bounds.max[0] + fit.radius);
    expect(controls.target.z).toBeLessThanOrEqual(fit.bounds.max[2] + fit.radius);
  });
});
