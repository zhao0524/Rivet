import type { PartVisualState } from "./types";

export type PartOutline = "none" | "hover" | "selected";

/**
 * Neutral style hints for a part. Renderers map these onto their own materials or
 * outline passes; final colors belong to the design tokens, not to this module.
 */
export interface PartHighlightStyle {
  readonly outline: PartOutline;
  /** Emissive tint as a hex string, or `null` for none. */
  readonly emissive: string | null;
  readonly emissive_intensity: number;
  readonly opacity: number;
  readonly transparent: boolean;
}

export interface PartHighlightPalette {
  readonly selected_emissive: string;
  readonly selected_intensity: number;
  readonly hover_emissive: string;
  readonly hover_intensity: number;
  readonly ghost_opacity: number;
}

export const NEUTRAL_HIGHLIGHT_PALETTE: PartHighlightPalette = {
  selected_emissive: "#ffffff",
  selected_intensity: 0.35,
  hover_emissive: "#ffffff",
  hover_intensity: 0.15,
  ghost_opacity: 0.15,
};

export function resolvePartHighlight(
  state: PartVisualState,
  palette: PartHighlightPalette = NEUTRAL_HIGHLIGHT_PALETTE,
): PartHighlightStyle {
  if (!state.visible) {
    return {
      outline: "none",
      emissive: null,
      emissive_intensity: 0,
      opacity: state.isolated_out && !state.hidden ? palette.ghost_opacity : 0,
      transparent: true,
    };
  }
  if (state.selected) {
    return {
      outline: "selected",
      emissive: palette.selected_emissive,
      emissive_intensity: palette.selected_intensity,
      opacity: 1,
      transparent: false,
    };
  }
  if (state.hovered) {
    return {
      outline: "hover",
      emissive: palette.hover_emissive,
      emissive_intensity: palette.hover_intensity,
      opacity: 1,
      transparent: false,
    };
  }
  return { outline: "none", emissive: null, emissive_intensity: 0, opacity: 1, transparent: false };
}
