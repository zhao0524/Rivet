'use client';

import { useEffect, useState } from 'react';
import { DesignStudio } from './DesignStudio';
import type { DesignStartRequest } from './useDesignJob';
import { AppHeader } from '../../flow/AppHeader';
import '../../../styles/generation.css';

/**
 * Entry for v2 geometry-first generation: prompt and/or reference image, mode, explicit cache opt-in.
 * `initialImageAssetId` is a v1 upload (from the build flow's Clarify screen); its bytes are fetched
 * once and re-uploaded to the v2 session when the user generates.
 */
export function DesignStart({ initialText = '', initialImageAssetId = null }: { initialText?: string; initialImageAssetId?: string | null }) {
  const [text, setText] = useState(initialText);
  const [image, setImage] = useState<File | null>(null);
  const [mode, setMode] = useState<DesignStartRequest['mode']>('concept_only');
  const [allowCached, setAllowCached] = useState(false);
  const [request, setRequest] = useState<DesignStartRequest | null>(null);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  useEffect(() => {
    if (!initialImageAssetId) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/assets/${encodeURIComponent(initialImageAssetId)}/preview`);
        if (!res.ok) return;
        const blob = await res.blob();
        if (!cancelled && blob.type.startsWith('image/')) {
          setImage((current) => current ?? new File([blob], 'reference', { type: blob.type }));
        }
      } catch {
        // The photo is optional; the user can pick it again.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialImageAssetId]);
  if (request) return <DesignStudio request={request} onExit={() => setRequest(null)} />;
  const ready = text.trim().length > 0 || image !== null;
  return (
    <>
    <AppHeader />
    <main className="app-main design-start" data-testid="design-start" data-hydrated={hydrated ? 'true' : 'false'}>
      <h1 className="ui-h1">Generate a 3D design</h1>
      <p className="rv-hint">Rivet authors three different designs, builds real geometry, checks it and renders it. Engineered mode also checks real parts with the engineering engine.</p>
      <form data-testid="design-start-form" onSubmit={(e) => { e.preventDefault(); if (ready) setRequest({ text: text.trim(), image, mode, allowCached }); }} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <textarea className="rv-input" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Describe the object, e.g. a small orange rover that avoids obstacles" aria-label="Describe the design" />
        <input type="file" accept="image/png,image/jpeg,image/webp" aria-label="Reference image (optional)" onChange={(e) => setImage(e.target.files?.[0] ?? null)} />
        {image && initialImageAssetId ? <p className="rv-hint" data-testid="design-carried-image">Using the photo from your project.</p> : null}
        <label className="rv-hint">
          Mode{' '}
          <select value={mode} onChange={(e) => setMode(e.target.value as DesignStartRequest['mode'])} data-testid="design-mode-select">
            <option value="concept_only">Concept only (appearance)</option>
            <option value="engineered">Engineered (real parts and checks)</option>
          </select>
        </label>
        <label className="rv-hint" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={allowCached} onChange={(e) => setAllowCached(e.target.checked)} data-testid="design-allow-cached" />
          Reuse a cached result if one exists (shown as a replay)
        </label>
        <button type="submit" className="rv-btn rv-btn--primary" disabled={!ready} data-testid="generate-design-v2">Generate 3D design (3 candidates)</button>
      </form>
    </main>
    </>
  );
}
