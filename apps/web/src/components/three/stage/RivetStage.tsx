'use client';

import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import {
  Component,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import { Box3, NeutralToneMapping, type Group } from 'three';
import { boundsEqual, STAGE_FOV_DEG, type CameraView } from './cameraFit';
import { StageCameraRig, useStageFit } from './StageCameraRig';
import { StageAxes } from './StageAxes';
import { StageGround } from './StageGround';
import { StageLighting } from './StageLighting';
import { resolveStageTheme, type StageTheme } from './theme';
import { boundsMmToScene, SCENE_UNITS_PER_MM, type Bounds3, type BoundsMm } from './units';
import { detectWebGLSupport } from './webgl';

/** Device pixel ratio range; the upper cap keeps fill rate predictable on HiDPI laptops. */
export const STAGE_DPR: [number, number] = [1, 1.5];

export interface RivetStageProps {
  /** Scene content authored in millimeters (canonical BuildPlan units). */
  children?: ReactNode;
  /** Framing volume in millimeters. When omitted, the children's bounding box is measured. */
  boundsMm?: BoundsMm;
  /** Any change animates the camera back to the fitted opening view. */
  resetSignal?: unknown;
  /** When false, rendering stops entirely (hidden tab or collapsed panel). Defaults to true. */
  active?: boolean;
  /** Millimeter floor grid. Defaults to true. */
  showGrid?: boolean;
  /** X/Y/Z millimetre rulers from a corner of the model. Defaults to false. */
  showAxes?: boolean;
  /** Pointer click that did not hit any interactive object. */
  onBackgroundClick?: (event: MouseEvent) => void;
  /** Optional pointer-down hook (e.g. for a drag click-guard). */
  onCanvasPointerDown?: (event: { clientX: number; clientY: number; pointerId?: number }) => void;
  theme?: Partial<StageTheme>;
  view?: CameraView;
  /** Fraction of each half-frame kept free around the framed volume. */
  padding?: number;
  /**
   * Drag-to-rotate only: no zoom or pan, so wheel and touch scrolling reach the page.
   * For scroll-driven embeds where camera zoom would fight the page's scroll effects.
   */
  orbitOnly?: boolean;
  /** Turn slowly around the model on its own (dragging still orbits). Renders every frame while on. */
  autoRotate?: boolean;
  /** Replaces the built-in message when WebGL is unavailable or the renderer fails. */
  fallback?: ReactNode;
  className?: string;
  style?: CSSProperties;
  label?: string;
}

type Support = 'pending' | 'ready' | 'unavailable';

class StageErrorBoundary extends Component<{ onError: (error: Error) => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('RivetStage renderer failed', error, info.componentStack);
    this.props.onError(error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function useStableBoundsMm(boundsMm?: BoundsMm): Bounds3 | null {
  const key = boundsMm ? [...boundsMm.min, ...boundsMm.max].join(',') : '';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (boundsMm ? boundsMmToScene(boundsMm) : null), [key]);
}

function MountSignal({ onMount }: { onMount: () => void }) {
  useLayoutEffect(onMount, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function RendererSettings({ theme, active }: { theme: StageTheme; active: boolean }) {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  useLayoutEffect(() => {
    gl.toneMapping = NeutralToneMapping;
    gl.toneMappingExposure = theme.exposure;
    invalidate();
  }, [gl, theme.exposure, invalidate]);
  useEffect(() => {
    if (active) invalidate();
  }, [active, invalidate]);
  return null;
}

function ContextLossWatcher({ onChange }: { onChange: (lost: boolean) => void }) {
  const canvas = useThree((s) => s.gl.domElement);
  useEffect(() => {
    const lost = (event: Event) => {
      event.preventDefault();
      onChange(true);
    };
    const restored = () => onChange(false);
    canvas.addEventListener('webglcontextlost', lost);
    canvas.addEventListener('webglcontextrestored', restored);
    return () => {
      canvas.removeEventListener('webglcontextlost', lost);
      canvas.removeEventListener('webglcontextrestored', restored);
    };
  }, [canvas, onChange]);
  return null;
}

interface StageSceneProps {
  children?: ReactNode;
  explicitBounds: Bounds3 | null;
  resetSignal?: unknown;
  showGrid: boolean;
  showAxes: boolean;
  active: boolean;
  theme: StageTheme;
  view?: CameraView;
  padding?: number;
  orbitOnly: boolean;
  autoRotate: boolean;
  onContextLost: (lost: boolean) => void;
}

function StageScene({ children, explicitBounds, resetSignal, showGrid, showAxes, active, theme, view, padding, orbitOnly, autoRotate, onContextLost }: StageSceneProps) {
  const contentRef = useRef<Group>(null);
  const canvas = useThree((s) => s.gl.domElement);
  const box = useMemo(() => new Box3(), []);
  const [measured, setMeasured] = useState<Bounds3 | null>(null);
  const [mountTick, setMountTick] = useState(0);

  useLayoutEffect(() => {
    if (explicitBounds) return;
    const group = contentRef.current;
    if (!group) return;
    group.updateWorldMatrix(true, true);
    box.setFromObject(group);
    const next: Bounds3 | null = box.isEmpty()
      ? null
      : { min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z] };
    setMeasured((previous) => (boundsEqual(previous, next) ? previous : next));
  }, [children, mountTick, explicitBounds, resetSignal, box]);

  const fit = useStageFit(explicitBounds ?? measured, view, padding);

  useEffect(() => {
    if (!orbitOnly) return;
    // OrbitControls sets touch-action: none; let vertical swipes scroll the page instead.
    canvas.style.touchAction = 'pan-y';
    // A trackpad pinch arrives as ctrl+wheel; with zoom off it would zoom the whole page.
    const blockPinch = (event: WheelEvent) => {
      if (event.ctrlKey) event.preventDefault();
    };
    canvas.addEventListener('wheel', blockPinch, { passive: false });
    return () => {
      canvas.style.touchAction = 'none';
      canvas.removeEventListener('wheel', blockPinch);
    };
  }, [canvas, orbitOnly]);

  return (
    <>
      <RendererSettings theme={theme} active={active} />
      <ContextLossWatcher onChange={onContextLost} />
      <color attach="background" args={[theme.background]} />
      <fog attach="fog" args={[theme.background, fit.distance * 1.5, fit.distance * 5]} />
      <StageLighting theme={theme} />
      <StageGround fit={fit} theme={theme} showGrid={showGrid} />
      {showAxes ? <StageAxes fit={fit} /> : null}
      <group ref={contentRef} name="rivet-stage-content" scale={SCENE_UNITS_PER_MM}>
        <Suspense fallback={null}>
          {children}
          <MountSignal onMount={() => setMountTick((t) => t + 1)} />
        </Suspense>
      </group>
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.085}
        rotateSpeed={0.7}
        zoomSpeed={0.8}
        panSpeed={0.8}
        enableZoom={!orbitOnly}
        enablePan={!orbitOnly}
        autoRotate={autoRotate}
        autoRotateSpeed={0.9}
        screenSpacePanning
        minDistance={fit.minDistance}
        maxDistance={fit.maxDistance}
        minPolarAngle={0.12}
        maxPolarAngle={Math.PI * 0.47}
      />
      <StageCameraRig fit={fit} resetSignal={resetSignal} />
    </>
  );
}

const overlayStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
  textAlign: 'center',
  font: '14px/1.5 system-ui, sans-serif',
};

/**
 * The Rivet 3D stage: one React Three Fiber canvas with studio lighting, contact
 * shadows, a millimeter grid, damped orbit controls and an automatically fitted
 * camera. It renders whatever `children` it is given, in millimeters.
 */
export function RivetStage({
  children,
  boundsMm,
  resetSignal,
  active = true,
  showGrid = true,
  showAxes = false,
  onBackgroundClick,
  onCanvasPointerDown,
  theme: themeOverrides,
  view,
  padding,
  orbitOnly = false,
  autoRotate = false,
  fallback,
  className,
  style,
  label = '3D assembly view',
}: RivetStageProps) {
  const theme = useMemo(() => resolveStageTheme(themeOverrides), [themeOverrides]);
  const explicitBounds = useStableBoundsMm(boundsMm);
  const [support, setSupport] = useState<Support>('pending');
  const [crashed, setCrashed] = useState(false);
  const [contextLost, setContextLost] = useState(false);

  useEffect(() => {
    setSupport(detectWebGLSupport() ? 'ready' : 'unavailable');
  }, []);

  const unavailable = support === 'unavailable' || crashed;
  const state = unavailable ? 'unavailable' : contextLost ? 'context-lost' : support;

  return (
    <div
      className={className}
      role="region"
      aria-label={label}
      data-rivet-stage=""
      data-stage-state={state}
      onPointerDown={
        onCanvasPointerDown
          ? (e) => onCanvasPointerDown({ clientX: e.clientX, clientY: e.clientY, pointerId: e.pointerId })
          : undefined
      }
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: 240,
        overflow: 'hidden',
        background: theme.background,
        color: theme.gridSection,
        ...style,
      }}
    >
      {support === 'ready' && !crashed && (
        <StageErrorBoundary onError={() => setCrashed(true)}>
          <Canvas
            frameloop={active ? (autoRotate ? 'always' : 'demand') : 'never'}
            dpr={STAGE_DPR}
            camera={{ fov: STAGE_FOV_DEG, near: 0.001, far: 100, position: [0.4, 0.3, 0.6] }}
            gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
            onCreated={({ gl }) => {
              // Contact shadows render with a null background; they need a
              // transparent clear or the whole shadow plane turns opaque.
              gl.setClearAlpha(0);
            }}
            onPointerMissed={onBackgroundClick}
            style={{ position: 'absolute', inset: 0 }}
          >
            <StageScene
              explicitBounds={explicitBounds}
              resetSignal={resetSignal}
              showGrid={showGrid}
              showAxes={showAxes}
              active={active}
              theme={theme}
              view={view}
              padding={padding}
              orbitOnly={orbitOnly}
              autoRotate={autoRotate}
              onContextLost={setContextLost}
            >
              {children}
            </StageScene>
          </Canvas>
        </StageErrorBoundary>
      )}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background: `radial-gradient(ellipse 75% 70% at 50% 48%, transparent 55%, ${theme.vignette} 100%)`,
        }}
      />
      {unavailable &&
        (fallback ?? (
          <div role="status" data-stage-fallback="" style={overlayStyle}>
            3D view unavailable: this browser could not start WebGL. Part, wiring and assembly data are still
            available outside the 3D view.
          </div>
        ))}
      {contextLost && !unavailable && (
        <div role="status" data-stage-context-lost="" style={{ ...overlayStyle, pointerEvents: 'none' }}>
          Rendering paused: the graphics context was lost. It resumes if the browser restores it.
        </div>
      )}
    </div>
  );
}
