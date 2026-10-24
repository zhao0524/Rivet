import { defaultPartLabel, indexPlanComponents } from "./plan-index";
import type {
  PartLabelResolver,
  PartSelectionCallbacks,
  PartSelectionState,
  PartVisualState,
  SelectablePlan,
  SelectablePlanComponent,
  SelectionChangeReason,
} from "./types";

export interface PartSelectionControllerOptions {
  plan?: SelectablePlan | null;
  getLabel?: PartLabelResolver;
  callbacks?: PartSelectionCallbacks;
}

export interface SelectOptions {
  reason?: SelectionChangeReason;
  /** Unhide / leave isolation so a hidden instance can be selected (e.g. from a BOM row). */
  reveal?: boolean;
}

export interface PartSelectionController {
  getState(): PartSelectionState;
  subscribe(listener: () => void): () => void;
  setCallbacks(callbacks: PartSelectionCallbacks | undefined): void;
  setLabelResolver(getLabel: PartLabelResolver | undefined): void;
  /** Reconcile with a new plan or revision. Keeps state only for instances still present. */
  setPlan(plan: SelectablePlan | null | undefined): void;

  getComponent(instanceId: string | null | undefined): SelectablePlanComponent | null;
  getLabel(instanceId: string | null | undefined): string | null;
  getVisualState(instanceId: string): PartVisualState;
  isKnown(instanceId: string | null | undefined): boolean;

  /** Returns `false` (and changes nothing) for unknown or non-interactive IDs. */
  select(instanceId: string, options?: SelectOptions): boolean;
  clearSelection(reason?: SelectionChangeReason): boolean;
  hover(instanceId: string): boolean;
  /** Clears hover only if `instanceId` is the hovered one (tolerates out-of-order events). */
  unhover(instanceId: string): boolean;
  clearHover(): boolean;

  hide(instanceId: string): boolean;
  show(instanceId: string): boolean;
  toggleHidden(instanceId: string): boolean;
  showAll(): boolean;
  /** Isolate `instanceId` (defaults to the selected instance). */
  isolate(instanceId?: string | null): boolean;
  exitIsolation(): boolean;
  /** Clears selection, hover and isolation. Hidden parts stay hidden. */
  handleEscape(reason?: SelectionChangeReason): boolean;
}

const EMPTY_HIDDEN: ReadonlySet<string> = new Set();

const emptyState = (plan: SelectablePlan | null | undefined): PartSelectionState => ({
  build_id: plan?.build_id ?? null,
  revision: plan?.revision ?? null,
  selected_instance_id: null,
  hovered_instance_id: null,
  hidden_instance_ids: EMPTY_HIDDEN,
  isolated_instance_id: null,
});

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean => {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
};

const sameComponent = (
  a: SelectablePlanComponent | null,
  b: SelectablePlanComponent | null,
): boolean =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.instance_id === b.instance_id &&
    a.catalog_id === b.catalog_id &&
    a.role === b.role &&
    (a.parent_instance_id ?? null) === (b.parent_instance_id ?? null));

export function computeVisualState(
  state: PartSelectionState,
  instanceId: string,
  known: boolean,
): PartVisualState {
  const hidden = state.hidden_instance_ids.has(instanceId);
  const isolatedOut =
    state.isolated_instance_id !== null && state.isolated_instance_id !== instanceId;
  const visible = known && !hidden && !isolatedOut;
  return {
    instance_id: instanceId,
    known,
    selected: visible && state.selected_instance_id === instanceId,
    hovered: visible && state.hovered_instance_id === instanceId,
    hidden,
    isolated_out: isolatedOut,
    visible,
    interactive: visible,
  };
}

export function createPartSelectionController(
  options: PartSelectionControllerOptions = {},
): PartSelectionController {
  let plan: SelectablePlan | null = options.plan ?? null;
  let index = indexPlanComponents(plan);
  let getLabelFn: PartLabelResolver = options.getLabel ?? defaultPartLabel;
  let callbacks: PartSelectionCallbacks = options.callbacks ?? {};
  let state: PartSelectionState = emptyState(plan);
  const listeners = new Set<() => void>();

  const getComponent = (id: string | null | undefined) =>
    (id != null ? index.get(id) : undefined) ?? null;
  const isKnown = (id: string | null | undefined) => id != null && index.has(id);
  const isInteractive = (s: PartSelectionState, id: string) =>
    computeVisualState(s, id, isKnown(id)).interactive;
  const labelFor = (id: string | null | undefined) => {
    const component = getComponent(id);
    return component ? getLabelFn(component) : null;
  };

  /** Drop selection / hover that point at instances that are no longer interactive. */
  const normalize = (
    next: PartSelectionState,
  ): PartSelectionState => {
    let result = next;
    if (result.selected_instance_id && !isInteractive(result, result.selected_instance_id)) {
      result = { ...result, selected_instance_id: null };
    }
    if (result.hovered_instance_id && !isInteractive(result, result.hovered_instance_id)) {
      result = { ...result, hovered_instance_id: null };
    }
    return result;
  };

  const commit = (
    draft: PartSelectionState,
    reason: SelectionChangeReason,
    previousComponents?: {
      selected: SelectablePlanComponent | null;
      hovered: SelectablePlanComponent | null;
    },
  ): boolean => {
    const prev = state;
    const next = normalize(draft);
    const prevSelected =
      previousComponents?.selected ?? getComponent(prev.selected_instance_id);
    const prevHovered = previousComponents?.hovered ?? getComponent(prev.hovered_instance_id);
    const nextSelected = getComponent(next.selected_instance_id);
    const nextHovered = getComponent(next.hovered_instance_id);

    const selectionChanged =
      prev.selected_instance_id !== next.selected_instance_id ||
      !sameComponent(prevSelected, nextSelected);
    const hoverChanged =
      prev.hovered_instance_id !== next.hovered_instance_id ||
      !sameComponent(prevHovered, nextHovered);
    const visibilityChanged =
      prev.isolated_instance_id !== next.isolated_instance_id ||
      !sameSet(prev.hidden_instance_ids, next.hidden_instance_ids);
    const planChanged = prev.build_id !== next.build_id || prev.revision !== next.revision;

    if (!selectionChanged && !hoverChanged && !visibilityChanged && !planChanged) return false;

    state = next;
    // A selection that is dropped because its part became hidden reports `hidden`.
    const selectionReason: SelectionChangeReason =
      reason !== "plan_change" &&
      draft.selected_instance_id !== null &&
      next.selected_instance_id === null
        ? "hidden"
        : reason;

    for (const listener of [...listeners]) listener();

    if (selectionChanged) {
      callbacks.onSelectionChange?.({
        build_id: next.build_id,
        revision: next.revision,
        instance_id: next.selected_instance_id,
        previous_instance_id: prev.selected_instance_id,
        component: nextSelected,
        reason: selectionReason,
      });
    }
    if (hoverChanged) {
      callbacks.onHoverChange?.({
        build_id: next.build_id,
        revision: next.revision,
        instance_id: next.hovered_instance_id,
        previous_instance_id: prev.hovered_instance_id,
        component: nextHovered,
        label: labelFor(next.hovered_instance_id),
      });
    }
    if (visibilityChanged) {
      callbacks.onVisibilityChange?.({
        build_id: next.build_id,
        revision: next.revision,
        hidden_instance_ids: [...next.hidden_instance_ids],
        isolated_instance_id: next.isolated_instance_id,
      });
    }
    return true;
  };

  const withHidden = (mutate: (hidden: Set<string>) => void): ReadonlySet<string> => {
    const hidden = new Set(state.hidden_instance_ids);
    mutate(hidden);
    return hidden.size === 0 ? EMPTY_HIDDEN : hidden;
  };

  const controller: PartSelectionController = {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setCallbacks(next) {
      callbacks = next ?? {};
    },
    setLabelResolver(next) {
      getLabelFn = next ?? defaultPartLabel;
    },
    setPlan(nextPlan) {
      const previous = {
        selected: getComponent(state.selected_instance_id),
        hovered: getComponent(state.hovered_instance_id),
      };
      const sameBuild =
        nextPlan != null && state.build_id !== null && nextPlan.build_id === state.build_id;
      plan = nextPlan ?? null;
      index = indexPlanComponents(plan);

      if (!sameBuild) {
        commit(emptyState(plan), "plan_change", previous);
        return;
      }
      const keep = (id: string | null) => (id !== null && index.has(id) ? id : null);
      const hidden = new Set([...state.hidden_instance_ids].filter((id) => index.has(id)));
      commit(
        {
          build_id: plan!.build_id,
          revision: plan!.revision,
          selected_instance_id: keep(state.selected_instance_id),
          hovered_instance_id: keep(state.hovered_instance_id),
          hidden_instance_ids: hidden.size === 0 ? EMPTY_HIDDEN : hidden,
          isolated_instance_id: keep(state.isolated_instance_id),
        },
        "plan_change",
        previous,
      );
    },

    getComponent,
    getLabel: labelFor,
    getVisualState: (id) => computeVisualState(state, id, isKnown(id)),
    isKnown,

    select(id, { reason = "api", reveal = false } = {}) {
      if (!isKnown(id)) return false;
      let draft = state;
      if (!isInteractive(draft, id)) {
        if (!reveal) return false;
        draft = {
          ...draft,
          hidden_instance_ids: withHidden((hidden) => hidden.delete(id)),
          isolated_instance_id:
            draft.isolated_instance_id === id ? draft.isolated_instance_id : null,
        };
      }
      if (draft === state && state.selected_instance_id === id) return true;
      commit({ ...draft, selected_instance_id: id }, reason);
      return true;
    },
    clearSelection(reason = "api") {
      if (state.selected_instance_id === null) return false;
      return commit({ ...state, selected_instance_id: null }, reason);
    },
    hover(id) {
      if (!isKnown(id) || !isInteractive(state, id)) return false;
      if (state.hovered_instance_id === id) return true;
      return commit({ ...state, hovered_instance_id: id }, "pointer");
    },
    unhover(id) {
      if (state.hovered_instance_id !== id) return false;
      return commit({ ...state, hovered_instance_id: null }, "pointer");
    },
    clearHover() {
      if (state.hovered_instance_id === null) return false;
      return commit({ ...state, hovered_instance_id: null }, "pointer");
    },

    hide(id) {
      if (!isKnown(id) || state.hidden_instance_ids.has(id)) return false;
      return commit(
        {
          ...state,
          hidden_instance_ids: withHidden((hidden) => hidden.add(id)),
          // Hiding the isolated part would leave nothing on screen; leave isolation instead.
          isolated_instance_id:
            state.isolated_instance_id === id ? null : state.isolated_instance_id,
        },
        "api",
      );
    },
    show(id) {
      if (!state.hidden_instance_ids.has(id)) return false;
      return commit(
        { ...state, hidden_instance_ids: withHidden((hidden) => hidden.delete(id)) },
        "api",
      );
    },
    toggleHidden(id) {
      return state.hidden_instance_ids.has(id) ? controller.show(id) : controller.hide(id);
    },
    showAll() {
      if (state.hidden_instance_ids.size === 0) return false;
      return commit({ ...state, hidden_instance_ids: EMPTY_HIDDEN }, "api");
    },
    isolate(id = state.selected_instance_id) {
      if (!id || !isKnown(id)) return false;
      if (state.isolated_instance_id === id && !state.hidden_instance_ids.has(id)) return true;
      commit(
        {
          ...state,
          hidden_instance_ids: withHidden((hidden) => hidden.delete(id)),
          isolated_instance_id: id,
        },
        "api",
      );
      return true;
    },
    exitIsolation() {
      if (state.isolated_instance_id === null) return false;
      return commit({ ...state, isolated_instance_id: null }, "api");
    },
    handleEscape(reason = "keyboard") {
      if (
        state.selected_instance_id === null &&
        state.hovered_instance_id === null &&
        state.isolated_instance_id === null
      ) {
        return false;
      }
      return commit(
        {
          ...state,
          selected_instance_id: null,
          hovered_instance_id: null,
          isolated_instance_id: null,
        },
        reason,
      );
    },
  };

  return controller;
}
