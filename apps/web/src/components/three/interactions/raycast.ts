import type { Object3D, Raycaster, Intersection } from "three";

/** `userData` flag that blocks raycasts for an object and all of its descendants. */
export const RAYCAST_BLOCK_KEY = "rivet_raycast_blocked";
/** `userData` key holding the `instance_id` on each `SelectablePart` root group. */
export const PART_INSTANCE_KEY = "rivet_instance_id";

const patched = new WeakSet<Object3D>();

export function isRaycastBlocked(object: Object3D): boolean {
  for (let node: Object3D | null = object; node; node = node.parent) {
    if (node.userData?.[RAYCAST_BLOCK_KEY] === true) return true;
  }
  return false;
}

/**
 * Wrap `raycast` on `root` and its descendants so it returns no hits while any
 * ancestor is blocked. Idempotent; call again after children change.
 * Three.js raycasting ignores `visible`, so hidden parts need this to stay unpickable.
 */
export function guardRaycast(root: Object3D): void {
  root.traverse((node) => {
    if (patched.has(node)) return;
    patched.add(node);
    const original = node.raycast;
    node.raycast = function guardedRaycast(
      this: Object3D,
      raycaster: Raycaster,
      intersects: Intersection[],
    ) {
      if (isRaycastBlocked(this)) return;
      original.call(this, raycaster, intersects);
    };
  });
}

export function setRaycastEnabled(root: Object3D, enabled: boolean): void {
  guardRaycast(root);
  if (enabled) delete root.userData[RAYCAST_BLOCK_KEY];
  else root.userData[RAYCAST_BLOCK_KEY] = true;
}
