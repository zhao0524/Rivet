import { useMemo } from 'react';
import { HardwarePart } from './HardwarePart';
import type { PartCatalogItem, PartPlan, PartSelectEvent, PartVisibility, PoseOverride } from './types';

export interface PartAssemblyProps {
  plan: PartPlan;
  /** Catalog records (array or keyed by `catalog_id`). Missing entries render as labelled unknown geometry. */
  catalog: readonly PartCatalogItem[] | Readonly<Record<string, PartCatalogItem>>;
  onSelect?: (event: PartSelectEvent) => void;
  onHover?: (instanceId: string | null) => void;
  selectedInstanceId?: string | null;
  /** Additional instances highlighted by step timeline or wiring hover. */
  highlightedInstanceIds?: ReadonlySet<string> | readonly string[];
  wireframe?: boolean;
  showMounts?: boolean;
  /** Per-`instance_id` visibility; absent ids are visible. */
  visibility?: Readonly<Record<string, PartVisibility>>;
  /** Per-`instance_id` presentation transforms (exploded view, previews). The plan is never mutated. */
  poseOverrides?: Readonly<Record<string, PoseOverride>>;
  /** Instances drawn without pointer events, so parts behind them can be picked. */
  inertInstanceIds?: ReadonlySet<string>;
}

export function indexCatalog(catalog: PartAssemblyProps['catalog']): ReadonlyMap<string, PartCatalogItem> {
  const items = Array.isArray(catalog) ? catalog : Object.values(catalog as Record<string, PartCatalogItem>);
  return new Map(items.map((c) => [c.catalog_id, c]));
}

/** Renders every BuildPlan component occurrence exactly once, in millimetres, flat in plan space. */
export function PartAssembly({
  plan,
  catalog,
  onSelect,
  onHover,
  selectedInstanceId,
  highlightedInstanceIds,
  wireframe = false,
  showMounts = false,
  visibility,
  poseOverrides,
  inertInstanceIds,
}: PartAssemblyProps) {
  const byId = useMemo(() => indexCatalog(catalog), [catalog]);
  const highlightedSet = useMemo(() => {
    if (!highlightedInstanceIds) return null;
    return highlightedInstanceIds instanceof Set ? highlightedInstanceIds : new Set(highlightedInstanceIds);
  }, [highlightedInstanceIds]);

  return (
    <group name="part-assembly" userData={{ buildId: plan.build_id ?? null, revision: plan.revision ?? null }}>
      {plan.components.map((component) => (
        <HardwarePart
          key={component.instance_id}
          component={component}
          catalogItem={byId.get(component.catalog_id)}
          selected={selectedInstanceId === component.instance_id}
          highlighted={highlightedSet?.has(component.instance_id) ?? false}
          wireframe={wireframe}
          showMounts={showMounts}
          visibility={visibility?.[component.instance_id]}
          poseOverride={poseOverrides?.[component.instance_id]}
          interactive={!inertInstanceIds?.has(component.instance_id)}
          onSelect={onSelect}
          onHover={onHover}
        />
      ))}
    </group>
  );
}
