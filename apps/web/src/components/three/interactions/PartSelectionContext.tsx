"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { ClickGuard } from "./click-guard";
import type { PartSelectionController } from "./selection-controller";

export interface PartSelectionContextValue {
  readonly controller: PartSelectionController;
  readonly clickGuard: ClickGuard | null;
}

const PartSelectionContext = createContext<PartSelectionContextValue | null>(null);

export function PartSelectionProvider({
  value,
  children,
}: {
  value: PartSelectionContextValue;
  children?: ReactNode;
}) {
  return <PartSelectionContext.Provider value={value}>{children}</PartSelectionContext.Provider>;
}

export function usePartSelectionContext(): PartSelectionContextValue | null {
  return useContext(PartSelectionContext);
}
