# Wiring overlay (C06)

React Three Fiber group that draws `BuildPlan.connections` where `kind === "electrical"`, using only
catalog `ports` and `components[].pose`. Spec: `docs/implementation.md` §3.2–3.4 and C2.

```tsx
import { WiringOverlay, useWiringOverlayState } from '@/components/three/wiring';

const wiring = useWiringOverlayState();
<Canvas>
  {/* ...part meshes... */}
  <WiringOverlay
    plan={plan}
    catalog={catalog}
    visible={wiring.state.visible}
    filter={wiring.state.filter}
    selectedInstanceIds={selectedIds}
    onWireSelect={(w) => wiring.setActive(w.connection_id)}
    onWarnings={(warnings) => console.table(warnings)}
  />
</Canvas>
```

## Honesty rules

- The v1 port schema has no physical port positions, so wires are **schematic**. Ports get deterministic slots
  along the top face of the component's catalog bounds (catalog port order, evenly spaced on local x).
  `WIRING_IS_APPROXIMATE_BY_DEFAULT` and `APPROXIMATE_WIRING_TEXT` ("Approximate wiring visualization") are exported,
  and the in-canvas status panel shows the text whenever any drawn wire is approximate.
- A port `position_mm` (not in v1) is used if a future catalog provides it; the anchor counts as precise
  only when the component also has `physical.bounds_verified: true`.
- Unknown dimensions: anchor at the instance origin, with an advisory `UNKNOWN_BOUNDS` warning.
- Unknown/ambiguous instance, missing catalog item, unknown port, invalid pose, duplicate `connection_id`
  or a port wired to itself: **no wire is drawn**; a blocking `WiringWarning` is returned via `onWarnings`
  and listed in the status panel.

## API

| Export | Purpose |
|---|---|
| `WiringOverlay` | R3F group. Props: `visible`, `filter`, `selectedInstanceIds`, `activeConnectionId`, `highlightConnected`, `showLabels`, `showStatus`, `unitsPerMm` (default 1, BuildPlan is mm), `palette`, callbacks `onWireHover`, `onWireSelect`, `onHighlightInstances`, `onWarnings`. |
| `buildWiringLayout(plan, catalog)` | Pure, deterministic layout (sorted by `connection_id`; input order does not matter). Returns wires, warnings and counts. |
| `filterWires`, `wiresForInstances`, `connectedInstanceIds`, `availableSignals` | Filtering and selection helpers. |
| `useWiringOverlayState`, `wiringOverlayReducer` | Toggle, signal filter and active-wire state for toolbars. |
| `WiringStatusPanel`, `WireLabel`, `describeWire` | DOM text, reusable in the inspector. |
| `WiringPreviewStage` | Standalone `<Canvas>` with bounds-box placeholders, for demos without the studio renderer. |

Scene object names: `wire:<connection_id>`, `wire-anchor:<connection_id>:from|to`, `wire-highlight:<instance_id>`.
Rendering cost: one low-segment `TubeGeometry` per wire, one shared anchor sphere, materials cached per colour
and state; everything is disposed on change/unmount. Labels mount only for the active wire.

## Tests

Self-contained until `apps/web/package.json` exists (then move these devDependencies into `apps/web` and delete
this folder's `package.json`, lockfile and configs):

```bash
cd apps/web/src/components/three/wiring
pnpm install   # pnpm 9 (packageManager field)
pnpm test
pnpm typecheck
```

`__fixtures__/` holds private copies of Appendix A.1/A.2 (synthetic data) per §3.7.
