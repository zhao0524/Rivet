"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createClickGuard, type ClickGuard } from "./click-guard";
import type { PartSelectionContextValue } from "./PartSelectionContext";
import {
  createPartSelectionController,
  type PartSelectionController,
  type SelectOptions,
} from "./selection-controller";
import type {
  PartLabelResolver,
  PartSelectionCallbacks,
  PartSelectionState,
  PartVisualState,
  SelectablePlan,
  SelectablePlanComponent,
} from "./types";

const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export interface UsePartSelectionOptions extends PartSelectionCallbacks {
  getLabel?: PartLabelResolver;
  /** Press Escape to clear selection, hover and isolation. Default `true`. */
  escapeToClear?: boolean;
  /** Where the Escape listener is attached. Defaults to `window`. */
  keyboardTarget?: Pick<EventTarget, "addEventListener" | "removeEventListener"> | null;
  /** Pointer travel (px) above which a press counts as an orbit drag, not a click. Default 4. */
  dragThresholdPx?: number;
}

/** Spread onto the R3F `<Canvas>` so background clicks clear the selection. */
export interface PartSelectionCanvasProps {
  onPointerDown(event: { clientX: number; clientY: number; pointerId?: number }): void;
  onPointerMissed(event: MouseEvent): void;
}

export interface PartSelectionApi {
  readonly state: PartSelectionState;
  readonly selectedInstanceId: string | null;
  readonly hoveredInstanceId: string | null;
  readonly selectedComponent: SelectablePlanComponent | null;
  readonly hoveredComponent: SelectablePlanComponent | null;
  readonly hoverLabel: string | null;
  readonly controller: PartSelectionController;
  readonly clickGuard: ClickGuard;
  /** Pass to `PartSelectionProvider` so `SelectablePart`s find the controller. */
  readonly context: PartSelectionContextValue;
  readonly canvasProps: PartSelectionCanvasProps;
  select(instanceId: string, options?: SelectOptions): boolean;
  clearSelection(): boolean;
  hide(instanceId: string): boolean;
  show(instanceId: string): boolean;
  toggleHidden(instanceId: string): boolean;
  showAll(): boolean;
  isolate(instanceId?: string | null): boolean;
  exitIsolation(): boolean;
  getVisualState(instanceId: string): PartVisualState;
}

const isEditableTarget = (target: EventTarget | null): boolean => {
  const element = target as HTMLElement | null;
  if (!element || typeof element.tagName !== "string") return false;
  const tag = element.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || element.isContentEditable;
};

/**
 * Selection / hover / visibility state for the parts of one `BuildPlan`.
 * The plan is only read; state survives revisions for instances that still exist.
 */
export function usePartSelection(
  plan: SelectablePlan | null | undefined,
  options: UsePartSelectionOptions = {},
): PartSelectionApi {
  const {
    getLabel,
    onSelectionChange,
    onHoverChange,
    onVisibilityChange,
    escapeToClear = true,
    keyboardTarget,
    dragThresholdPx = 4,
  } = options;

  const [controller] = useState(() =>
    createPartSelectionController({ plan: plan ?? null, getLabel }),
  );
  const clickGuard = useMemo(() => createClickGuard(dragThresholdPx), [dragThresholdPx]);

  const callbacksRef = useRef<PartSelectionCallbacks>({});
  callbacksRef.current = { onSelectionChange, onHoverChange, onVisibilityChange };

  useIsomorphicLayoutEffect(() => {
    controller.setCallbacks({
      onSelectionChange: (event) => callbacksRef.current.onSelectionChange?.(event),
      onHoverChange: (event) => callbacksRef.current.onHoverChange?.(event),
      onVisibilityChange: (event) => callbacksRef.current.onVisibilityChange?.(event),
    });
    return () => controller.setCallbacks(undefined);
  }, [controller]);

  useIsomorphicLayoutEffect(() => {
    controller.setLabelResolver(getLabel);
  }, [controller, getLabel]);

  useIsomorphicLayoutEffect(() => {
    controller.setPlan(plan ?? null);
  }, [controller, plan]);

  useEffect(() => {
    if (!escapeToClear) return;
    const target = keyboardTarget === undefined ? globalThis.window : keyboardTarget;
    if (!target) return;
    const onKeyDown = (event: Event) => {
      const keyEvent = event as KeyboardEvent;
      if (keyEvent.key !== "Escape" || keyEvent.defaultPrevented) return;
      if (isEditableTarget(keyEvent.target)) return;
      controller.handleEscape("keyboard");
    };
    target.addEventListener("keydown", onKeyDown);
    return () => target.removeEventListener("keydown", onKeyDown);
  }, [controller, escapeToClear, keyboardTarget]);

  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);

  const onPointerDown = useCallback<PartSelectionCanvasProps["onPointerDown"]>(
    (event) => clickGuard.down(event),
    [clickGuard],
  );
  const onPointerMissed = useCallback<PartSelectionCanvasProps["onPointerMissed"]>(
    (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      if (!clickGuard.isClick(event)) return;
      controller.clearSelection("background");
    },
    [clickGuard, controller],
  );

  const context = useMemo(() => ({ controller, clickGuard }), [controller, clickGuard]);
  const canvasProps = useMemo(
    () => ({ onPointerDown, onPointerMissed }),
    [onPointerDown, onPointerMissed],
  );

  // `state` is part of the deps so component lookups refresh after `setPlan`.
  const selectedComponent = useMemo(
    () => controller.getComponent(state.selected_instance_id),
    [controller, state],
  );
  const hoveredComponent = useMemo(
    () => controller.getComponent(state.hovered_instance_id),
    [controller, state],
  );
  const hoverLabel = useMemo(
    () => controller.getLabel(state.hovered_instance_id),
    [controller, state],
  );

  return {
    state,
    selectedInstanceId: state.selected_instance_id,
    hoveredInstanceId: state.hovered_instance_id,
    selectedComponent,
    hoveredComponent,
    hoverLabel,
    controller,
    clickGuard,
    context,
    canvasProps,
    select: controller.select,
    clearSelection: () => controller.clearSelection("api"),
    hide: controller.hide,
    show: controller.show,
    toggleHidden: controller.toggleHidden,
    showAll: controller.showAll,
    isolate: controller.isolate,
    exitIsolation: controller.exitIsolation,
    getVisualState: controller.getVisualState,
  };
}

/** Subscribe to the visual state of one part. */
export function usePartVisualState(
  controller: PartSelectionController,
  instanceId: string,
): PartVisualState {
  const subscribe = controller.subscribe;
  const getSnapshot = controller.getState;
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  // Recompute only when the shared snapshot changes.
  return useMemo(() => controller.getVisualState(instanceId), [controller, instanceId, state]);
}
