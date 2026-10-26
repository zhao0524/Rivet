# Rivet 3D stage

`RivetStage` is the shared 3D viewport: one React Three Fiber canvas with
studio lighting, contact shadows, a millimeter grid, damped orbit controls and
a camera fitted to the content bounds. It renders whatever `children` it gets,
in canonical millimeters (see `units.ts` for the mm → scene adapter).

```tsx
import { RivetStage } from './components/three/stage';

<RivetStage boundsMm={assemblyBoundsMm} resetSignal={resetCount} onBackgroundClick={clearSelection}>
  <PartRenderer parts={parts} />
</RivetStage>
```

Omit `boundsMm` to measure the children. `fitCameraToBounds` is exported for
callers that need the same framing math (thumbnails, screenshots).

## Dependencies

Pinned in `apps/web/package.json`: `react@18`, `three@0.169`, `@react-three/fiber@8`,
`@react-three/drei@9`.

Tests in `__tests__/` run under Vitest (jsdom by default, see `apps/web/vitest.config.ts`).
