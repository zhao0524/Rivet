import rawConceptPlan from './rivet/fixtures/concept-quadcopter-v1.json';
import rawSourcedPlan from './rivet/fixtures/sourced-rover-obstacle-v1.json';
import rawSourcedCatalog from './rivet/fixtures/sourced-seed-components.json';
import rawIntent from './rivet/fixtures/synthetic-intent-rover-obstacle-v1.json';
import rawPlan from './rivet/fixtures/synthetic-rover-obstacle-v1.json';
import rawCatalog from './rivet/fixtures/synthetic-seed-components.json';
import {
  FixtureSource,
  SAVED_BUILD_LABEL,
  SAVED_SYNTHETIC_EXAMPLE_LABEL,
  SYNTHETIC_ROVER_BUILD_ID,
  assertPlanIntegrity,
  isSyntheticPlan,
  parseBuildPlan,
  parseCatalogComponents,
  parseIntentSpec,
  type BuildPlan,
  type CatalogComponent,
  type IntentSpec,
  type SavedExampleSummary,
} from './rivet';

export { SYNTHETIC_ROVER_BUILD_ID };
export const SOURCED_ROVER_BUILD_ID = 'rivet-intent-rover-001';

export function getSyntheticCatalog(): CatalogComponent[] {
  return parseCatalogComponents(structuredClone(rawCatalog));
}

export function getSyntheticRoverPlan(): BuildPlan {
  const catalog = getSyntheticCatalog();
  const plan = parseBuildPlan(structuredClone(rawPlan));
  assertPlanIntegrity(plan, catalog);
  return plan;
}

export function getSourcedCatalog(): CatalogComponent[] {
  return parseCatalogComponents(structuredClone(rawSourcedCatalog));
}

/** Saved concept model (appearance only) served for concept requests in fixture mode. */
export function getConceptExamplePlan(): BuildPlan {
  return parseBuildPlan(structuredClone(rawConceptPlan));
}

export function getSourcedRoverPlan(): BuildPlan {
  const catalog = getSourcedCatalog();
  const plan = parseBuildPlan(structuredClone(rawSourcedPlan));
  assertPlanIntegrity(plan, catalog);
  return plan;
}

export function getCombinedFixtureCatalog(): CatalogComponent[] {
  const byId = new Map<string, CatalogComponent>();
  for (const item of getSyntheticCatalog()) byId.set(item.catalog_id, item);
  for (const item of getSourcedCatalog()) byId.set(item.catalog_id, item);
  return [...byId.values()];
}

export function createCombinedFixtureSource(defaultBuildId: string = SYNTHETIC_ROVER_BUILD_ID): FixtureSource {
  const catalog = getCombinedFixtureCatalog();
  const plans = [getSyntheticRoverPlan(), getSourcedRoverPlan(), getConceptExamplePlan()];
  const opened = plans.find((p) => p.build_id === defaultBuildId);
  return new FixtureSource({
    catalog,
    plans,
    defaultBuildId,
    // Names the build being opened in revision labels, edit findings and the saved-job event,
    // so the sourced snapshot is never called synthetic (and the synthetic one always is).
    label: opened && !isSyntheticPlan(opened, catalog) ? SAVED_BUILD_LABEL : SAVED_SYNTHETIC_EXAMPLE_LABEL,
  });
}

export function getSyntheticRoverIntent(): IntentSpec {
  return parseIntentSpec(structuredClone(rawIntent));
}

export const DEFAULT_SAVED_EXAMPLES: readonly SavedExampleSummary[] = Object.freeze([
  {
    example_id: SYNTHETIC_ROVER_BUILD_ID,
    title: 'Synthetic starter rover (NOT SOURCED)',
    project_family: 'rover',
    status: 'needs_review',
    generation_mode: 'fixture',
  },
  {
    example_id: SOURCED_ROVER_BUILD_ID,
    title: 'Indoor obstacle rover (Engine-Sourced Stack)',
    project_family: 'rover',
    status: 'needs_review',
    generation_mode: 'fixture',
  },
]);
