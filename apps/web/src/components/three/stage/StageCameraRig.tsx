'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { MathUtils, Vector3, type PerspectiveCamera } from 'three';
import {
  boundsEqual,
  fitCameraToBounds,
  STAGE_FOV_DEG,
  type CameraFit,
  type CameraView,
} from './cameraFit';
import type { Bounds3 } from './units';
import { prefersReducedMotion } from './webgl';

export const RESET_TRANSITION_MS = 380;
const MAX_FRAME_DELTA_S = 1 / 30;

/** The subset of `OrbitControls` the rig relies on (also satisfied by test doubles). */
export interface StageControls {
  target: Vector3;
  enableDamping: boolean;
  update(): unknown;
  addEventListener(type: 'start', listener: () => void): void;
  removeEventListener(type: 'start', listener: () => void): void;
}

interface Transition {
  fromPosition: Vector3;
  fromTarget: Vector3;
  toPosition: Vector3;
  toTarget: Vector3;
  elapsedMs: number;
  started: boolean;
  dampingWasEnabled: boolean;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/** Fit for the current canvas aspect; recomputed only when bounds, view, padding or aspect change. */
export function useStageFit(bounds: Bounds3 | null, view?: CameraView, padding?: number): CameraFit {
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const fovDeg = 'fov' in camera ? camera.fov : STAGE_FOV_DEG;
  const aspect = width > 0 && height > 0 ? width / height : 1;
  const azimuth = view?.azimuthDeg;
  const elevation = view?.elevationDeg;
  return useMemo(
    () =>
      fitCameraToBounds(bounds, {
        fovDeg,
        aspect,
        padding,
        view: azimuth === undefined || elevation === undefined ? undefined : { azimuthDeg: azimuth, elevationDeg: elevation },
      }),
    [bounds, fovDeg, aspect, padding, azimuth, elevation],
  );
}

export interface StageCameraRigProps {
  fit: CameraFit;
  resetSignal?: unknown;
}

/**
 * Applies a `CameraFit` to the default camera and controls.
 * - First fit and resizes snap, until the user orbits/zooms/pans.
 * - `resetSignal` changes animate back to the fitted view and re-enable auto-fit.
 * - New bounds animate when the user has not taken over the camera.
 * - The orbit target is kept within reach of the framed volume.
 */
export function StageCameraRig({ fit, resetSignal }: StageCameraRigProps) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const controls = useThree((s) => s.controls) as unknown as StageControls | null;
  const invalidate = useThree((s) => s.invalidate);

  const userControlled = useRef(false);
  const transition = useRef<Transition | null>(null);
  const applied = useRef<{ fit: CameraFit | null; reset: unknown }>({ fit: null, reset: resetSignal });
  const scratch = useMemo(() => ({ lo: new Vector3(), hi: new Vector3(), clamped: new Vector3() }), []);

  const setPose = (position: Vector3, target: Vector3) => {
    camera.position.copy(position);
    if (controls) {
      controls.target.copy(target);
      controls.update();
    } else {
      camera.lookAt(target);
    }
  };

  const endTransition = () => {
    const t = transition.current;
    if (!t) return;
    if (controls) controls.enableDamping = t.dampingWasEnabled;
    transition.current = null;
  };

  const snapTo = (next: CameraFit) => {
    endTransition();
    setPose(new Vector3(...next.position), new Vector3(...next.target));
  };

  const animateTo = (next: CameraFit) => {
    if (prefersReducedMotion()) {
      snapTo(next);
      return;
    }
    endTransition();
    const dampingWasEnabled = controls?.enableDamping ?? false;
    // Dropping damping for the transition discards residual orbit momentum.
    if (controls) {
      controls.enableDamping = false;
      controls.update();
    }
    transition.current = {
      fromPosition: camera.position.clone(),
      fromTarget: controls ? controls.target.clone() : new Vector3(...next.target),
      toPosition: new Vector3(...next.position),
      toTarget: new Vector3(...next.target),
      elapsedMs: 0,
      started: false,
      dampingWasEnabled,
    };
  };

  useLayoutEffect(() => {
    if ('aspect' in camera && width > 0 && height > 0) {
      camera.aspect = width / height;
    }
    camera.near = fit.near;
    camera.far = fit.far;
    camera.updateProjectionMatrix();

    const previous = applied.current;
    const resetRequested = !Object.is(previous.reset, resetSignal);
    applied.current = { fit, reset: resetSignal };

    if (previous.fit === null) {
      snapTo(fit);
    } else if (resetRequested) {
      userControlled.current = false;
      animateTo(fit);
    } else if (!userControlled.current) {
      if (boundsEqual(previous.fit.bounds, fit.bounds)) snapTo(fit);
      else animateTo(fit);
    }
    invalidate();
    // snapTo/animateTo close over camera and controls, which are listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit, resetSignal, camera, controls, invalidate, width, height]);

  useEffect(() => {
    if (!controls) return;
    const onStart = () => {
      userControlled.current = true;
      endTransition();
    };
    controls.addEventListener('start', onStart);
    return () => controls.removeEventListener('start', onStart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controls]);

  useEffect(() => () => endTransition(), []); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame((_, delta) => {
    const t = transition.current;
    if (t) {
      // The first frame after an idle period carries a stale clock delta.
      if (t.started) t.elapsedMs += Math.min(delta, MAX_FRAME_DELTA_S) * 1000;
      t.started = true;
      const k = MathUtils.clamp(t.elapsedMs / RESET_TRANSITION_MS, 0, 1);
      const e = easeInOutCubic(k);
      setPose(
        scratch.clamped.lerpVectors(t.fromPosition, t.toPosition, e),
        new Vector3().lerpVectors(t.fromTarget, t.toTarget, e),
      );
      if (k < 1) invalidate();
      else endTransition();
      return;
    }

    if (controls && userControlled.current) {
      const { min, max } = fit.bounds;
      const reach = fit.radius * 0.75;
      scratch.lo.set(min[0] - reach, min[1], min[2] - reach);
      scratch.hi.set(max[0] + reach, max[1] + reach, max[2] + reach);
      scratch.clamped.copy(controls.target).clamp(scratch.lo, scratch.hi);
      if (!scratch.clamped.equals(controls.target)) {
        camera.position.add(scratch.clamped.sub(controls.target));
        controls.target.add(scratch.clamped);
        controls.update();
      }
    }
  });

  return null;
}
