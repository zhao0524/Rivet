import type { WiringPalette } from './types';

/**
 * The v1 port schema lists logical ports only; it carries no physical port positions.
 * Every wire is therefore schematic unless a catalog entry later proves otherwise.
 */
export const WIRING_IS_APPROXIMATE_BY_DEFAULT = true as const;

export const APPROXIMATE_WIRING_TEXT = 'Approximate wiring visualization';

export const APPROXIMATE_WIRING_DETAIL =
  'Port anchors are schematic positions on component bounds, not measured pin locations.';

export const DEFAULT_SIGNAL_COLOR = '#E879F9';

/** Wire colours keyed by catalog `ports[].signal`. Override per mount via the `palette` prop. */
export const DEFAULT_SIGNAL_PALETTE: WiringPalette = {
  power_output: '#E5484D',
  power_input: '#E5484D',
  power_in: '#E5484D',
  power_out: '#E5484D',
  motor_power: '#E5484D',
  ground: '#A1A1AA',
  i2c: '#3B82F6',
  spi: '#06B6D4',
  uart: '#A855F7',
  digital_output: '#F5B83D',
  digital_input: '#F5B83D',
  pwm_output: '#F5B83D',
  pwm_input: '#F5B83D',
  analog_input: '#22C55E',
  analog_output: '#22C55E',
  motor_output: '#F97316',
};

export const WIRE_OBJECT_PREFIX = 'wire:';
export const ANCHOR_OBJECT_PREFIX = 'wire-anchor:';
export const HIGHLIGHT_OBJECT_PREFIX = 'wire-highlight:';
