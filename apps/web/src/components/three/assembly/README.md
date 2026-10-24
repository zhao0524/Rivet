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
  bounds, and inherit their parent's offset.
- `scrubToStep` / `stepToScrub` / `advancePlayback` map a continuous timeline
  position in `[0, stepCount]` to `{step, progress}`.
- `AssemblyTimelineControls` is controlled and unstyled (`data-part` hooks).

Limitations: bounds are axis-aligned; rotated parts use a conservative cube;
missing dimensions fall back to 20 mm; unscheduled parts stay ghosted in step mode.
