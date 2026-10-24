export { PartAssembly, indexCatalog, type PartAssemblyProps } from './PartAssembly';
export { HardwarePart, normalizeVisibility, toRadians, type HardwarePartProps } from './HardwarePart';
export { CATALOG_RECIPES, RECIPES, UNKNOWN_PART_SIZE, resolveRecipe, resolveSide, resolveSize, type RecipeId } from './recipes';
export { isLocalModelPath } from './recipes/GlbPart';
export { disposePartGeometries } from './geometry';
export { disposePartMaterials, getPartMaterial } from './materials';
export type * from './types';
