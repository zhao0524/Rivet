# Assembly view (C2)

Pure engine plus neutral controls for the exploded view and assembly timeline.
No rendering, store, or stage code lives here.

```ts
import { computeAssemblyView, toPoseOverrides } from '@/components/three/assembly';

const view = computeAssemblyView(plan, {
  mode: 'step',             // 'assembled' | 'exploded' | 'step'
  step: 3,                  // 0 = prep, plan.assembly_steps.length = final
  progress: 0.6,            // step: seat-in of the current step; exploded: explode amount
  dimensionsByCatalogId,    // optional catalog physical.dimensions_mm by catalog_id
});
const overrides = toPoseOverrides(view); // Record<instance_id, AssemblyPoseOverride>
```

- A renderer applies `position_offset_mm` on top of the canonical `pose` and uses
  `opacity` / `visible` / `ghost` / `highlighted`. The plan is never written back.
- Steps come from `assembly_steps` sorted by `step`. A part is *added* in the first
  step that references it; later references mark it *revisited* (highlighted, never
  added twice). Unresolved IDs are ignored and reported in `diagnostics`.
- Explode offsets are computed once per plan (cached by object identity): roots
  stay put, children move by role (wheels/motors sideways, electronics/power up,
  caster down, sensor forward) far enough to clear their parent's and siblings'
  bounds (and always at least one gap), and inherit their parent's offset. Parts
  with `render_overrides.visible === false` ride with their parent and are left out
  of the gap and sibling packing, so loose kit items cannot push visible parts away.
- `ExplodeAnimator` (inside the R3F canvas) animates the explode fraction with a
  critically damped spring (~350 ms, smooth reversal, exact rest). Parts bound via
  `PoseOverride.explode_offset_mm` are drawn at `position_mm + offset * progress`;
  positions are written in the frame loop, so the animation causes no React renders.
- `scrubToStep` / `stepToScrub` / `advancePlayback` map a continuous timeline
  position in `[0, stepCount]` to `{step, progress}`.
- `AssemblyTimelineControls` is controlled and unstyled (`data-part` hooks).

Limitations: bounds are axis-aligned (rotated parts use the exact axis-aligned
envelope of their rotated box); missing dimensions fall back to 20 mm; unscheduled
parts stay ghosted in step mode.
