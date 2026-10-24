export { createClickGuard } from "./click-guard";
export type { ClickGuard, PointerPositionLike } from "./click-guard";
export {
  NEUTRAL_HIGHLIGHT_PALETTE,
  resolvePartHighlight,
} from "./highlight";
export type { PartHighlightPalette, PartHighlightStyle, PartOutline } from "./highlight";
export { PartSelectionProvider, usePartSelectionContext } from "./PartSelectionContext";
export type { PartSelectionContextValue } from "./PartSelectionContext";
export {
  defaultPartLabel,
  findBomItemForInstance,
  indexPlanComponents,
  instanceIdsForCatalogId,
} from "./plan-index";
export { createPartPointerHandlers } from "./pointer-handlers";
export type { PartPointerEventLike, PartPointerHandlers } from "./pointer-handlers";
export {
  PART_INSTANCE_KEY,
  RAYCAST_BLOCK_KEY,
  guardRaycast,
  isRaycastBlocked,
  setRaycastEnabled,
} from "./raycast";
export { SelectablePart } from "./SelectablePart";
export {
  HIGHLIGHT_OUTLINE,
  HOVER_OUTLINE,
  SELECTED_OUTLINE,
  SelectionOutline,
  findPartNode,
  resolveOutlineTargets,
} from "./SelectionOutline";
export type { OutlineStyle, SelectionOutlineProps } from "./SelectionOutline";
export type { SelectablePartProps } from "./SelectablePart";
export { computeVisualState, createPartSelectionController } from "./selection-controller";
export type {
  PartSelectionController,
  PartSelectionControllerOptions,
  SelectOptions,
} from "./selection-controller";
export { usePartSelection, usePartVisualState } from "./usePartSelection";
export type {
  PartSelectionApi,
  PartSelectionCanvasProps,
  UsePartSelectionOptions,
} from "./usePartSelection";
export type * from "./types";
