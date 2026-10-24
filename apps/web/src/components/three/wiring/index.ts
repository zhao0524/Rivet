export { WiringOverlay, type WiringOverlayProps } from './WiringOverlay';
export { WiringPreviewStage } from './WiringPreviewStage';
export { WiringStatusPanel, WireLabel, describeWire, type WiringStatusPanelProps } from './WiringStatusPanel';
export { buildWiringLayout, wireColor, signalLabel, type WiringLayoutOptions } from './layout';
export { filterWires, wiresForInstances, connectedInstanceIds, availableSignals } from './filter';
export { resolveAnchor, schematicLocalAnchor, localToWorld, knownDimensions, ANCHOR_STANDOFF_MM } from './anchors';
export {
  useWiringOverlayState,
  wiringOverlayReducer,
  INITIAL_WIRING_OVERLAY_STATE,
  type WiringOverlayState,
  type WiringOverlayAction,
} from './state';
export {
  WIRING_IS_APPROXIMATE_BY_DEFAULT,
  APPROXIMATE_WIRING_TEXT,
  APPROXIMATE_WIRING_DETAIL,
  DEFAULT_SIGNAL_PALETTE,
  DEFAULT_SIGNAL_COLOR,
  WIRE_OBJECT_PREFIX,
  ANCHOR_OBJECT_PREFIX,
  HIGHLIGHT_OBJECT_PREFIX,
} from './constants';
export type * from './types';
