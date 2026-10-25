'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { blockers, isSafety, partRows } from '../../../lib/flow/derive';
import { projectPath } from '../../../lib/flow/steps';
import { CONCEPT_MODEL_LABEL, isConceptPlan } from '../../../lib/rivet/honesty';
import type { BuildPlan, CatalogComponent, VerificationFinding } from '../../../lib/rivet/types';
import { useProjectContext } from '../../flow/ProjectShell';
import { StepLayout } from '../../flow/StepLayout';
import { usePartSelection, type PartSelectionApi } from '../../three/interactions';
import { BuildError, SceneSkeleton, SceneViewport, SkeletonRows, useStepOverflow } from '../phase1/shared';
import { BlockerCard, type Blocker, type FixAttempt } from './BlockerCard';

const NEEDS_PART = /missing|unresolved|real_parts|catalog_ids|needs_part/i;

/** Blocking findings plus any component whose catalog entry is missing ("Needs a part"). */
export function reviewBlockers(plan: BuildPlan, catalog: readonly CatalogComponent[]): Blocker[] {
  const known = new Set(catalog.map((c) => c.catalog_id));
  const list: Blocker[] = blockers(plan).map((finding) => ({
    key: `${finding.rule_id}:${finding.affected_instance_ids.join(',')}`,
    kind: isSafety(finding) ? 'safety' : NEEDS_PART.test(finding.rule_id) ? 'needs-part' : 'wont-work',
    finding,
  }));
  for (const c of plan.components) {
    if (known.has(c.catalog_id)) continue;
    const finding: VerificationFinding = {
      rule_id: 'parts.missing_catalog_entry',
      result: 'FAIL',
      severity: 'blocking',
      affected_instance_ids: [c.instance_id],
      message: `${c.instance_id} points at ${c.catalog_id}, which is not in the catalog, so it has no specs or price.`,
      evidence_urls: [],
    };
    list.push({ key: `${finding.rule_id}:${c.instance_id}`, kind: 'needs-part', finding });
  }
  // Safety first, then anything that needs a part, then the rest.
  const rank: Record<Blocker['kind'], number> = { safety: 0, 'needs-part': 1, 'wont-work': 2 };
  return list.sort((a, b) => rank[a.kind] - rank[b.kind]);
}

/** Step 1: fix what would stop the build from working or being safe. Only blocking checks show here. */
export function ReviewStep() {
  const { project, update, build, goTo, openIterate } = useProjectContext();
  const { store, ready, error } = build;
  const plan = store.plan;
  const catalog = store.catalog;
  const { items: overflow, toast } = useStepOverflow();

  // Concept models were never engineered, so there is nothing to fix here: they get their own view.
  const concept = ready && isConceptPlan(plan);
  const list = useMemo(() => (ready && !concept ? reviewBlockers(plan, catalog) : []), [ready, concept, plan, catalog]);
  const partNames = useMemo(() => {
    const names = new Map<string, string>();
    if (ready) for (const row of partRows(plan, catalog)) names.set(row.instanceId, row.name);
    return names;
  }, [ready, plan, catalog]);

  const [attempts, setAttempts] = useState<Record<string, FixAttempt>>({});
  const busyKey = Object.keys(attempts).find((k) => attempts[k]?.status === 'pending') ?? null;

  const fix = useCallback(
    async (blocker: Blocker) => {
      setAttempts((a) => ({ ...a, [blocker.key]: { status: 'pending', message: null } }));
      const res = await store.submitEdit(`Fix: ${blocker.finding.message}`);
      if (res?.accepted) {
        // The plan reloads and the card drops out of the blocker list on its own.
        setAttempts((a) => {
          const next = { ...a };
          delete next[blocker.key];
          return next;
        });
        return;
      }
      setAttempts((a) => ({
        ...a,
        [blocker.key]: { status: 'failed', message: res?.finding?.message ?? null },
      }));
    },
    [store],
  );
  // A thrown edit (network or contract) sets store.editError after submitEdit resolves to null.
  const failedWithoutMessage = Object.keys(attempts).find(
    (k) => attempts[k]?.status === 'failed' && attempts[k]?.message === null,
  );
  useEffect(() => {
    if (!failedWithoutMessage || !store.editError) return;
    const message = store.editError;
    setAttempts((a) => ({ ...a, [failedWithoutMessage]: { status: 'failed', message } }));
  }, [failedWithoutMessage, store.editError]);

  // Small model: the top blocker's first affected part (not the chassis) is selected and outlined.
  const selection = usePartSelection(ready ? plan : null, { escapeToClear: false });
  const focusId = useMemo(() => {
    const top = list[0];
    if (!top) return null;
    const ids = top.finding.affected_instance_ids;
    const roles = new Map(plan.components.map((c) => [c.instance_id, c.role]));
    return ids.find((id) => roles.get(id) !== 'chassis') ?? ids[0] ?? null;
  }, [list, plan.components]);
  useEffect(() => {
    if (focusId) selection.select(focusId, { reason: 'api', reveal: true });
    else selection.clearSelection();
    // The selection api is stable per hook instance; only the focused part matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, plan.revision]);

  const pending = ready && (store.editPending || store.job?.status === 'queued' || store.job?.status === 'running');
  const assumptions = project.assumptions;
  const n = list.length;

  const waitingFor = !ready
    ? 'Loading the build'
    : pending
      ? 'Checks are still running'
      : n > 0
        ? `${n} ${n === 1 ? 'check is' : 'checks are'} unresolved. Build will flag ${n === 1 ? 'it' : 'them'} again.`
        : undefined;

  function next() {
    update({ reviewDone: true });
    goTo('parts');
  }

  return (
    <StepLayout
      title="Review"
      purpose="Fix what would stop this robot from working or being safe. Warnings and unverified values wait for you in Parts."
      primary={{
        label: 'Looks good, continue to Parts',
        onClick: next,
        disabled: !ready || Boolean(pending),
        waitingFor,
        testId: 'review-primary',
      }}
      overflow={overflow}
      testId="review-step"
    >
      {error ? <BuildError message={error} /> : null}
      {!ready ? (
        <div className="split">
          <SkeletonRows count={3} testId="review-skeleton" />
          <SceneSkeleton small />
        </div>
      ) : concept ? (
        <ConceptReview plan={plan} catalog={catalog} selection={selection} pending={Boolean(pending)} onChange={openIterate} />
      ) : n === 0 && !pending ? (
        <div className="ui-card p1-empty" data-testid="review-empty">
          <h2 className="ui-h2">Nothing blocks this build. Every safety and fit check passed.</h2>
        </div>
      ) : (
        <div className="split">
          <div className="p1-stack">
            {pending ? (
              <div className="ui-island p1-pending" role="status" aria-live="polite" data-testid="review-pending">
                <span className="ui-spinner" aria-hidden="true" />
                <span className="ui-muted">Checks are still running. New results appear here.</span>
              </div>
            ) : null}
            <ul className="p1-blockers" aria-label="Blocking checks" data-testid="review-blockers">
              {list.map((b) => (
                <BlockerCard
                  key={b.key}
                  blocker={b}
                  partNames={partNames}
                  attempt={attempts[b.key] ?? null}
                  busy={busyKey !== null && busyKey !== b.key}
                  onFix={(bl) => void fix(bl)}
                  partsHref={`${projectPath(project.id, 'parts')}${
                    b.finding.affected_instance_ids[0] ? `?part=${encodeURIComponent(focusFor(b, plan))}` : ''
                  }`}
                />
              ))}
            </ul>
            <details className="p1-details" data-testid="review-assumptions">
              <summary>
                <span>
                  Assumptions <span className="p1-count">({assumptions.length})</span>
                </span>
              </summary>
              <div className="p1-details__body p1-stack">
                {assumptions.length > 0 ? (
                  <ul className="ui-muted" style={{ margin: 0, paddingLeft: 18 }}>
                    {assumptions.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="ui-muted" style={{ margin: 0 }}>
                    Rivet recorded no assumptions for this prompt.
                  </p>
                )}
                <div>
                  <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={openIterate}>
                    Edit assumptions
                  </button>
                </div>
              </div>
            </details>
          </div>
          <SceneViewport
            plan={plan}
            catalog={catalog}
            selection={selection}
            assemblyMode="assembled"
            small
            label={focusId ? `Showing ${partNames.get(focusId) ?? focusId}` : undefined}
            testId="review-viewport"
          />
        </div>
      )}
      {toast}
    </StepLayout>
  );
}

/** A concept model rebuilt from the photo: the 3D model first, with what it is and is not. */
function ConceptReview({
  plan,
  catalog,
  selection,
  pending,
  onChange,
}: {
  plan: BuildPlan;
  catalog: readonly CatalogComponent[];
  selection: PartSelectionApi;
  pending: boolean;
  onChange: () => void;
}) {
  const [xray, setXray] = useState(false);
  const hasInternals = plan.components.some((c) => c.render_overrides?.internal === true);
  const visible = plan.components.filter((c) => c.render_overrides?.visible !== false).length;
  const objectType = plan.concept?.object_type ?? 'object';
  return (
    <div className="split" data-testid="review-concept">
      <div className="p1-stack">
        <div className="ui-card ui-card--pad p1-stack">
          <span className="ui-badge">{CONCEPT_MODEL_LABEL}</span>
          <h2 className="ui-h2" style={{ margin: 0 }}>
            3D model of {/^[aeiou]/i.test(objectType) ? 'an' : 'a'} {objectType}
          </h2>
          {plan.concept?.summary ? (
            <p className="ui-muted" style={{ margin: 0 }}>
              {plan.concept.summary}
            </p>
          ) : null}
          <p className="ui-small ui-subtle" style={{ margin: 0 }}>
            {visible} shaped parts, sizes estimated from your photo or description. Parts with a known role (boards, motors,
            battery…) come with a suggested real product in Parts and Buy; wiring, power and fit were not checked.
          </p>
          {pending ? (
            <div className="ui-island p1-pending" role="status" aria-live="polite" data-testid="review-pending">
              <span className="ui-spinner" aria-hidden="true" />
              <span className="ui-muted">Applying your change…</span>
            </div>
          ) : null}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={onChange} disabled={pending}>
              Change something
            </button>
            {hasInternals ? (
              <button
                type="button"
                className="ui-btn ui-btn--secondary ui-btn--sm"
                aria-pressed={xray}
                onClick={() => setXray((x) => !x)}
                data-testid="review-xray"
              >
                {xray ? 'Hide inside parts' : 'Show inside parts'}
              </button>
            ) : null}
          </div>
        </div>
      </div>
      <SceneViewport
        plan={plan}
        catalog={catalog}
        selection={selection}
        assemblyMode="assembled"
        xray={xray}
        label={CONCEPT_MODEL_LABEL}
        testId="review-viewport"
      />
    </div>
  );
}

/** The part to preselect in Parts for a blocker: first affected part that is not the chassis. */
function focusFor(b: Blocker, plan: BuildPlan): string {
  const roles = new Map(plan.components.map((c) => [c.instance_id, c.role]));
  const ids = b.finding.affected_instance_ids;
  return ids.find((id) => roles.get(id) !== 'chassis') ?? ids[0] ?? '';
}
