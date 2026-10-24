/**
 * Scene-internal colors and light levels. These are local to the 3D stage and
 * intentionally separate from the app design tokens; designers can override any
 * field through the `theme` prop of `RivetStage`.
 */
export interface StageTheme {
  background: string;
  vignette: string;
  floor: string;
  gridCell: string;
  gridSection: string;
  shadow: string;
  shadowOpacity: number;
  keyLight: string;
  rimLight: string;
  fillLight: string;
  skyLight: string;
  groundBounce: string;
  exposure: number;
}

export const graphiteStageTheme: StageTheme = {
  background: '#0f1114',
  vignette: 'rgba(0, 0, 0, 0.42)',
  floor: '#15181c',
  gridCell: '#252a31',
  gridSection: '#363d47',
  shadow: '#000000',
  shadowOpacity: 0.62,
  keyLight: '#fff3e6',
  rimLight: '#a9c8ff',
  fillLight: '#dfe7f2',
  skyLight: '#d8e2f0',
  groundBounce: '#1b1d21',
  exposure: 1.05,
};

export const studioLightStageTheme: StageTheme = {
  background: '#e9eaec',
  vignette: 'rgba(40, 44, 52, 0.16)',
  floor: '#e4e5e8',
  gridCell: '#d3d5da',
  gridSection: '#bfc3ca',
  shadow: '#1c2230',
  shadowOpacity: 0.38,
  keyLight: '#fff6ec',
  rimLight: '#c9dcff',
  fillLight: '#ffffff',
  skyLight: '#ffffff',
  groundBounce: '#c9ccd2',
  exposure: 1,
};

export function resolveStageTheme(overrides?: Partial<StageTheme>): StageTheme {
  return overrides ? { ...graphiteStageTheme, ...overrides } : graphiteStageTheme;
}
