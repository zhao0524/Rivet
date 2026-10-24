import { useMemo, useReducer } from 'react';
import type { WiringFilter } from './types';

export interface WiringOverlayState {
  visible: boolean;
  filter: WiringFilter;
  active_connection_id: string | null;
}

export type WiringOverlayAction =
  | { type: 'toggle' }
  | { type: 'set_visible'; visible: boolean }
  | { type: 'set_filter'; filter: WiringFilter }
  | { type: 'clear_filter' }
  | { type: 'toggle_signal'; signal: string }
  | { type: 'set_active'; connection_id: string | null };

export const INITIAL_WIRING_OVERLAY_STATE: WiringOverlayState = {
  visible: true,
  filter: {},
  active_connection_id: null,
};

export function wiringOverlayReducer(state: WiringOverlayState, action: WiringOverlayAction): WiringOverlayState {
  switch (action.type) {
    case 'toggle':
      return { ...state, visible: !state.visible };
    case 'set_visible':
      return { ...state, visible: action.visible };
    case 'set_filter':
      return { ...state, filter: action.filter };
    case 'clear_filter':
      return { ...state, filter: {} };
    case 'toggle_signal': {
      const current = state.filter.signals ?? [];
      const signals = current.includes(action.signal)
        ? current.filter((s) => s !== action.signal)
        : [...current, action.signal].sort();
      return { ...state, filter: { ...state.filter, signals } };
    }
    case 'set_active':
      return { ...state, active_connection_id: action.connection_id };
    default:
      return state;
  }
}

/** Optional state holder for toolbar toggles and filters; the overlay itself is fully controlled. */
export function useWiringOverlayState(initial: Partial<WiringOverlayState> = {}) {
  const [state, dispatch] = useReducer(wiringOverlayReducer, { ...INITIAL_WIRING_OVERLAY_STATE, ...initial });
  const actions = useMemo(
    () => ({
      toggle: () => dispatch({ type: 'toggle' }),
      setVisible: (visible: boolean) => dispatch({ type: 'set_visible', visible }),
      setFilter: (filter: WiringFilter) => dispatch({ type: 'set_filter', filter }),
      clearFilter: () => dispatch({ type: 'clear_filter' }),
      toggleSignal: (signal: string) => dispatch({ type: 'toggle_signal', signal }),
      setActive: (connection_id: string | null) => dispatch({ type: 'set_active', connection_id }),
    }),
    [],
  );
  return { state, ...actions };
}
