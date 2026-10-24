# `components/three/interactions`

Reusable part selection, hover, hide/isolate and inspector events for the 3D studio (implementation.md C1/C3).
It wraps any Three.js children and does not import a renderer, data layer or UI. It only reads the `BuildPlan`.

## Usage

```tsx
import { Canvas } from "@react-three/fiber";
import { PartSelectionProvider, SelectablePart, resolvePartHighlight, usePartSelection } from "@/components/three/interactions";

function Scene({ plan }: { plan: BuildPlan }) {
  const selection = usePartSelection(plan, {
    onSelectionChange: (e) => inspector.show(e.instance_id), // BOM / inspector consume this
    getLabel: (c) => catalogName(c.catalog_id) ?? c.instance_id,
  });

  return (
    <Canvas {...selection.canvasProps}>
      <PartSelectionProvider value={selection.context}>
        {plan.components.map((c) => (
          <SelectablePart key={c.instance_id} instanceId={c.instance_id}>
            {(state) => <PartMesh component={c} highlight={resolvePartHighlight(state)} />}
          </SelectablePart>
        ))}
      </PartSelectionProvider>
    </Canvas>
  );
}
```

`selection.hoverLabel` is the tooltip text. Call `selection.hide(id)`, `show`, `toggleHidden`, `showAll`, `isolate()` (isolates the selected part), and `exitIsolation()` from toolbar buttons.

## Behavior

| Input | Result |
|---|---|
| Click a part | Selects that `instance_id` (one at a time). Repeated catalog parts such as two `demo.tt_motor` motors are separate. |
| Drag (orbit/pan) then release | No selection change. Travel above `dragThresholdPx` (default 4) counts as a drag. Uses R3F `event.delta` and the canvas `pointerdown`. |
| Click empty background | Clears selection (`reason: "background"`). |
| `Escape` | Clears selection, hover and isolation. Hidden parts stay hidden. Ignored while typing in inputs. |
| Hide a part | Not drawn and not raycastable. Clears its hover and selection (`reason: "hidden"`). |
| Isolate | Every other part is hidden (or ghosted with `isolatedOutBehavior="ghost"`) and not raycastable. |
| Unknown `instance_id` | `select` / `hover` / `hide` / `isolate` return `false` and change nothing. |
| New revision, same `build_id` | Selection, hover, hidden and isolation are kept for instances still present and dropped for removed ones (`reason: "plan_change"`). |
| Different `build_id` or `null` plan | Everything resets. |

Three.js raycasting ignores `visible`, so `SelectablePart` also blocks raycasts on hidden/isolated-out subtrees (`setRaycastEnabled`).

## Event contract

Payload fields are `snake_case` to match `contracts/`.

```ts
onSelectionChange({ build_id, revision, instance_id, previous_instance_id, component, reason })
// reason: "pointer" | "api" | "background" | "keyboard" | "hidden" | "plan_change"
onHoverChange({ build_id, revision, instance_id, previous_instance_id, component, label })
onVisibilityChange({ build_id, revision, hidden_instance_ids, isolated_instance_id })
```

`component` is the plan's `{ instance_id, catalog_id, role, ... }` entry, or `null` when cleared.
Use `findBomItemForInstance(plan, instance_id)` to find the BOM row to highlight.

## Styling

`resolvePartHighlight(state)` returns neutral hints (`outline`, `emissive`, `emissive_intensity`, `opacity`, `transparent`). Renderers map them onto their own materials or outline pass. Final colors come from design tokens through a custom `PartHighlightPalette`.

`<SelectionOutline selectedInstanceId hoveredInstanceId highlightedInstanceIds />` (inside the canvas) draws screen-space silhouette outlines with three's `EffectComposer` + `OutlinePass`: it follows the rendered geometry of the whole PartNode (`part:<instance_id>`, every child mesh), keeps a constant pixel width under zoom, dims edges hidden behind other geometry, and never touches part materials. With nothing outlined it renders the scene directly.

## Without React

`createPartSelectionController({ plan, callbacks })` is the same state machine with no React dependency. `usePartSelection` wraps it.

## Tests

`__tests__/` uses Vitest (the hook test runs under jsdom). The rover plan is a private copy of Appendix A.2 until `fixtures/` lands.
