'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getProject, markSaved, type ProjectRecord } from '../../lib/flow/projects';

/** How often the workspace checks for changes and saves them. */
export const AUTOSAVE_MS = 15_000;
/** How long "Saving…" shows, so a save is noticed rather than flickering past. */
const SAVING_MS = 700;

export interface Autosave {
  saving: boolean;
  savedAt: string | null;
  /** Saves now; resolves once the indicator has shown it. */
  save: (patch?: Parameters<typeof markSaved>[1]) => Promise<void>;
}

/** Saves the project on an interval whenever it changed since the last save, and on demand. */
export function useAutosave(project: ProjectRecord): Autosave {
  const id = project.id;
  const [saving, setSaving] = useState(false);
  const timer = useRef<number | null>(null);

  const save = useCallback(
    (patch?: Parameters<typeof markSaved>[1]) =>
      new Promise<void>((resolve) => {
        setSaving(true);
        markSaved(id, patch);
        if (timer.current !== null) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => {
          setSaving(false);
          resolve();
        }, SAVING_MS);
      }),
    [id],
  );

  useEffect(() => {
    const tick = () => {
      const p = getProject(id);
      if (p && (!p.savedAt || p.updatedAt > p.savedAt)) void save();
    };
    // A project that has never been saved is saved as soon as it opens.
    const first = window.setTimeout(tick, 1200);
    const every = window.setInterval(tick, AUTOSAVE_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(every);
    };
  }, [id, save]);

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  return { saving, savedAt: project.savedAt ?? null, save };
}
