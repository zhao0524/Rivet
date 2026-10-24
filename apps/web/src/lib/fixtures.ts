import rawIntent from './rivet/fixtures/synthetic-intent-rover-obstacle-v1.json';
import rawPlan from './rivet/fixtures/synthetic-rover-obstacle-v1.json';
import rawCatalog from './rivet/fixtures/synthetic-seed-components.json';
import {
  SYNTHETIC_ROVER_BUILD_ID,
  assertPlanIntegrity,
  parseBuildPlan,
  parseCatalogComponents,
  parseIntentSpec,
  type BuildPlan,
  type CatalogComponent,
  type IntentSpec,
  type SavedExampleSummary,
} from './rivet';

export { SYNTHETIC_ROVER_BUILD_ID };

export function getSyntheticCatalog(): CatalogComponent[] {
  return parseCatalogComponents(structuredClone(rawCatalog));
}

export function getSyntheticRoverPlan(): BuildPlan {
  const catalog = getSyntheticCatalog();
  const plan = parseBuildPlan(structuredClone(rawPlan));
  assertPlanIntegrity(plan, catalog);
  return plan;
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
]);
