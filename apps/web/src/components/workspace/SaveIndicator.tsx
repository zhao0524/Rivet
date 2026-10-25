'use client';

import { useEffect, useState } from 'react';
import { relativeTime } from '../start/shared';

/** Top-bar save status: "Saving…" while a save runs, then when the last one happened. */
export function SaveIndicator({ saving, savedAt }: { saving: boolean; savedAt: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 20_000);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => setNow(Date.now()), [savedAt]);

  return (
    <span className="ws-saved" data-state={saving ? 'saving' : savedAt ? 'saved' : 'idle'} aria-live="polite" data-testid="workspace-saved">
      {saving ? <span className="ws-spin" aria-hidden="true" /> : <span className="ws-saved__dot" aria-hidden="true" />}
      <span>{saving ? 'Saving…' : savedAt ? `Saved ${savedLabel(savedAt, now)}` : 'Not saved yet'}</span>
    </span>
  );
}

function savedLabel(iso: string, now: number): string {
  const ms = now - new Date(iso).getTime();
  if (ms < 45_000) return 'just now';
  return relativeTime(iso, now);
}
