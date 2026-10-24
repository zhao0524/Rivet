# Procedural hardware parts (C02)

```tsx
import { PartAssembly } from '@/components/three/parts';

<PartAssembly plan={plan} catalog={catalog} selectedInstanceId={id} onSelect={({ instanceId }) => setId(instanceId)}
  visibility={{ 'power-control-1': 'ghost' }} poseOverrides={explodedOffsets} />
```

- Units are millimetres (wrap in `<group scale={0.001}>` for a metre scene). Pose is `x` right, `y` up, `z` forward, XYZ Euler degrees.
- One `part:<instance_id>` group per plan occurrence, `userData.partNode === true`. Everything under it (screws, traces, pins, tread) is cosmetic and not a part.
- Recipes are chosen by `CATALOG_RECIPES[catalog_id]`, then `identity.category`, then `role`; catalog misses render as an amber-caged `unknown` box.
- Recipes keep the catalog extents but orient them physically: wheels use the smallest extent as tread width with the axle on X; TT motors run their long axis along Z with the output shaft on X, toward `left`/`right` (from mount id, instance id, or the sign of pose X).
- `render_overrides.color` replaces the base body colour.
- `physical.geometry_kind === 'glb'` with a same-origin `/models/*.glb` `asset_path` loads that asset scaled to the catalog bounds; anything else (including remote URLs) stays procedural.
