"use client";

import type { ThreeElements } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import type { Group } from "three";
import type { ClickGuard } from "./click-guard";
import { usePartSelectionContext } from "./PartSelectionContext";
import { createPartPointerHandlers } from "./pointer-handlers";
import { PART_INSTANCE_KEY, setRaycastEnabled } from "./raycast";
import type { PartSelectionController } from "./selection-controller";
import type { PartVisualState } from "./types";
import { usePartVisualState } from "./usePartSelection";

type GroupProps = ThreeElements["group"];

export interface SelectablePartProps
  extends Omit<
    GroupProps,
    | "children"
    | "ref"
    | "visible"
    | "onClick"
    | "onPointerOver"
    | "onPointerOut"
    | "onPointerDown"
  > {
  instanceId: string;
  /** Rendered children, or a render function receiving the part's visual state. */
  children?: ReactNode | ((state: PartVisualState) => ReactNode);
  /** Defaults to the nearest `PartSelectionProvider`. */
  controller?: PartSelectionController;
  clickGuard?: ClickGuard | null;
  /**
   * How parts outside an isolation are drawn: `hide` (default) or `ghost`
   * (still rendered so the child can fade it, never raycastable).
   */
  isolatedOutBehavior?: "hide" | "ghost";
}

/**
 * Wraps arbitrary Three.js children as one selectable part keyed by `instance_id`.
 * Never reads or writes plan geometry; transforms passed through are presentation only.
 */
export function SelectablePart({
  instanceId,
  children,
  controller: controllerProp,
  clickGuard: clickGuardProp,
  isolatedOutBehavior = "hide",
  name,
  userData,
  ...groupProps
}: SelectablePartProps) {
  const context = usePartSelectionContext();
  const controller = controllerProp ?? context?.controller;
  if (!controller) {
    throw new Error("SelectablePart needs a `controller` prop or a PartSelectionProvider");
  }
  const clickGuard = clickGuardProp === undefined ? (context?.clickGuard ?? null) : clickGuardProp;

  const ref = useRef<Group>(null);
  const visual = usePartVisualState(controller, instanceId);
  const handlers = useMemo(
    () => createPartPointerHandlers(controller, instanceId, clickGuard),
    [controller, instanceId, clickGuard],
  );
  const mergedUserData = useMemo(
    () => ({ ...userData, [PART_INSTANCE_KEY]: instanceId }),
    [userData, instanceId],
  );

  // Runs every render so meshes mounted later are guarded too.
  useLayoutEffect(() => {
    if (ref.current) setRaycastEnabled(ref.current, visual.interactive);
  });

  const drawn =
    visual.visible || (isolatedOutBehavior === "ghost" && visual.isolated_out && !visual.hidden);

  return (
    <group
      {...groupProps}
      ref={ref}
      name={name ?? `part:${instanceId}`}
      userData={mergedUserData}
      visible={drawn}
      onPointerOver={handlers.onPointerOver}
      onPointerOut={handlers.onPointerOut}
      onPointerDown={handlers.onPointerDown}
      onClick={handlers.onClick}
    >
      {typeof children === "function" ? children(visual) : children}
    </group>
  );
}
