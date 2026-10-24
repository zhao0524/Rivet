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

## Dependencies (for `apps/web/package.json`, C0)

- runtime: `react@19`, `react-dom@19`, `three@0.180`, `@react-three/fiber@9`, `@react-three/drei@10`
- dev: `@types/three`, `vitest@3`, `jsdom`, `@testing-library/react@16`, `@vitejs/plugin-react`

Tests in `__tests__/` run under Vitest with the React plugin; math tests use the
node environment and DOM tests opt into jsdom per file. `demo/StageDemo.tsx` is a local playground with wide/tall/small/empty
presets; it is not product UI.
