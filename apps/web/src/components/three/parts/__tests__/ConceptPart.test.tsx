import ReactThreeTestRenderer from '@react-three/test-renderer';
import { describe, expect, it } from 'vitest';
import { PartAssembly, resolveRecipe } from '..';
import conceptPlan from '../../../../lib/rivet/fixtures/concept-quadcopter-v1.json';
import { checkPlanIntegrity } from '../../../../lib/rivet/integrity';
import { describeBuildTrust, CONCEPT_MODEL_LABEL } from '../../../../lib/rivet/honesty';
import type { BuildPlan } from '../../../../lib/rivet/types';
import { buildPlanCheck, safeParse } from '../../../../lib/rivet/validate';
import { conceptShape } from '../recipes/ConceptPart';

const plan = conceptPlan as unknown as BuildPlan;
const catalog = plan.concept_catalog ?? [];

describe('concept plans', () => {
  it('pass the BuildPlan contract and integrity against their own concept catalog', () => {
    expect(safeParse(buildPlanCheck, conceptPlan).ok).toBe(true);
    expect(checkPlanIntegrity(plan, catalog)).toEqual([]);
  });

  it('are labelled as appearance-only concepts, never verified', () => {
    const trust = describeBuildTrust(plan, 'http', catalog);
    expect(trust.isConcept).toBe(true);
    expect(trust.label).toBe(CONCEPT_MODEL_LABEL);
    expect(trust.canDisplayAsVerified).toBe(false);
  });

  it('resolve every concept part to the concept recipe', () => {
    const byId = new Map(catalog.map((c) => [c.catalog_id, c]));
    for (const component of plan.components) {
      expect(resolveRecipe(component, byId.get(component.catalog_id))).toBe('concept');
    }
    expect(conceptShape('concept:propeller')).toBe('propeller');
    expect(conceptShape('procedural')).toBeNull();
  });

  it('renders one part node per component with its shape', async () => {
    const r = await ReactThreeTestRenderer.create(<PartAssembly plan={plan} catalog={catalog} />);
    const nodes = r.scene.findAll((n) => n.instance.userData?.partNode === true);
    expect(nodes).toHaveLength(plan.components.length);
    const shapes = new Set(
      r.scene.findAll((n) => typeof n.instance.userData?.conceptShape === 'string').map((n) => n.instance.userData.conceptShape),
    );
    expect(shapes).toEqual(new Set(['rounded_box', 'hemisphere', 'box', 'sphere', 'cylinder', 'propeller', 'cable']));
    await r.unmount();
  });

  it('draws wires as tubes along their path and lets X-ray parts be click-through', async () => {
    const wires = plan.components.filter((c) => c.role === 'wire');
    expect(wires.length).toBeGreaterThan(0);
    const shell = plan.components.filter((c) => c.render_overrides?.internal !== true).map((c) => c.instance_id);
    const r = await ReactThreeTestRenderer.create(
      <PartAssembly plan={plan} catalog={catalog} inertInstanceIds={new Set(shell)} onSelect={() => {}} />,
    );
    const cables = r.scene.findAll((n) => n.instance.userData?.conceptShape === 'cable');
    expect(cables).toHaveLength(wires.length);
    const tube = cables[0].findAll((n) => (n.instance as { geometry?: { type?: string } }).geometry?.type === 'TubeGeometry');
    expect(tube).toHaveLength(1);
    const node = (id: string) => r.scene.findAll((n) => n.instance.userData?.partNode === true && n.instance.userData.instanceId === id)[0];
    expect(node(shell[0]).props.onClick).toBeUndefined();
    expect(node(wires[0].instance_id).props.onClick).toBeTypeOf('function');
    await r.unmount();
  });
});
