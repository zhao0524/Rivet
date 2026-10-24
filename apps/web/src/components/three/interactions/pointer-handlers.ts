import type { ClickGuard, PointerPositionLike } from "./click-guard";
import type { PartSelectionController } from "./selection-controller";

/** Structural subset of R3F `ThreeEvent<PointerEvent | MouseEvent>`. */
export interface PartPointerEventLike {
  stopPropagation(): void;
  readonly object?: { readonly uuid: string };
  readonly delta?: number;
  readonly nativeEvent?: PointerPositionLike & { readonly button?: number };
}

export interface PartPointerHandlers {
  onPointerOver(event: PartPointerEventLike): void;
  onPointerOut(event: PartPointerEventLike): void;
  onPointerDown(event: PartPointerEventLike): void;
  onClick(event: PartPointerEventLike): void;
}

/**
 * Pointer handlers for one part. Events for non-interactive parts are ignored and
 * left to propagate so the part behind (or the background) receives them.
 * Hover is reference-counted per intersected mesh so moving between meshes of the
 * same part does not flicker the label.
 */
export function createPartPointerHandlers(
  controller: PartSelectionController,
  instanceId: string,
  guard: ClickGuard | null,
): PartPointerHandlers {
  const hoveredObjects = new Set<string>();
  const interactive = () => controller.getVisualState(instanceId).interactive;
  const key = (event: PartPointerEventLike) => event.object?.uuid ?? instanceId;

  return {
    onPointerOver(event) {
      if (!interactive()) return;
      event.stopPropagation();
      hoveredObjects.add(key(event));
      controller.hover(instanceId);
    },
    onPointerOut(event) {
      hoveredObjects.delete(key(event));
      if (hoveredObjects.size === 0) controller.unhover(instanceId);
    },
    onPointerDown(event) {
      if (!interactive()) return;
      if (event.nativeEvent) guard?.down(event.nativeEvent);
    },
    onClick(event) {
      if (!interactive()) return;
      const button = event.nativeEvent?.button;
      if (button !== undefined && button !== 0) return;
      event.stopPropagation();
      const delta = event.delta ?? 0;
      const isClick = guard ? guard.isClick(event.nativeEvent, delta) : delta <= 4;
      if (!isClick) return;
      controller.select(instanceId, { reason: "pointer" });
    },
  };
}
