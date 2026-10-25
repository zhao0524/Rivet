'use client';

import { useEffect, useMemo, useState } from 'react';
import { RivetStage } from '../../three/stage/RivetStage';
import { CandidateCompare } from '../../three/generation/CandidateCompare';
import { DesignLayers } from '../../three/generation/DesignLayers';
import { EditableFeatureHandles } from '../../three/generation/EditableFeatureHandles';
import { DEFAULT_LAYERS, PreviewSwapper, growBounds, type LayerState } from '../../three/generation/GeneratedAssembly';
import { VisualDiff } from '../../three/generation/VisualDiff';
import { DesignChoice } from './DesignChoice';
import { GenerationTimeline } from './GenerationTimeline';
import { useDesignJob, type DesignStartRequest } from './useDesignJob';

type Bounds = { min: [number, number, number]; max: [number, number, number] };

/** The v2 design workspace: live generation stream, growing geometry, candidate comparison,
 * inspection, targeted revisions, history and exports, all from the real API. */
export function DesignStudio({ request, onExit }: { request: DesignStartRequest | null; onExit: () => void }) {
  const d = useDesignJob();
  const [selectedBody, setSelectedBody] = useState<string | null>(null);
  const [layers, setLayers] = useState<LayerState>(DEFAULT_LAYERS);
  const [explode, setExplode] = useState(0);
  const [frame, setFrame] = useState<Bounds | null>(null);
  const [instruction, setInstruction] = useState('');
  const [showDiff, setShowDiff] = useState(false);
  useEffect(() => {
    if (request) void d.start(request);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  const chosen = d.bundle?.candidates.find((c) => c.id === d.bundle?.selected_candidate_id) ?? null;
  const streaming = d.latestPreview('cand-1') ?? d.latestPreview(null);
  const sceneUrl = chosen?.scene_asset_url ?? streaming?.snapshot?.scene_asset_url ?? null;
  const part = useMemo(() => chosen?.part_manifest.find((p) => p.body_id === selectedBody) ?? null, [chosen, selectedBody]);
  const exportUrl = (kind: string, bodyId?: string) => (d.bundle ? d.source.exportUrl(d.bundle, kind, bodyId) : '#');
  const fabricated = chosen?.part_manifest.filter((p) => p.kind === 'fabricated') ?? [];

  return (
    <div data-testid="design-studio" style={{ position: 'fixed', inset: 0, display: 'grid', gridTemplateColumns: 'minmax(240px, 22%) 1fr minmax(300px, 28%)', gridTemplateRows: 'auto 1fr', background: 'var(--rv-bg, #0f1115)', color: 'var(--rv-text, #e6e8eb)', zIndex: 50 }}>
      <header style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: '1px solid var(--rv-border, #2a2f37)' }}>
        <button type="button" className="rv-btn" onClick={onExit} data-testid="design-exit">Back to studio</button>
        <strong data-testid="design-title">{d.bundle?.title ?? request?.text ?? '3D design'}</strong>
        {d.bundle ? <span className={`rv-badge rv-badge--${d.bundle.status === 'complete' ? 'ok' : d.bundle.status === 'unbuildable' ? 'bad' : 'warn'}`} data-testid="design-status">{d.bundle.status.replace(/_/g, ' ')}</span> : null}
        {d.bundle ? <span className="rv-badge" data-testid="design-mode">{d.bundle.mode === 'engineered' ? 'Engineered' : 'Concept only'} · {d.bundle.provenance.generation_mode}{d.bundle.provenance.cached ? ' · cached replay' : ' · fresh'}</span> : null}
        {d.busy ? <button type="button" className="rv-btn" onClick={() => void d.cancel()} data-testid="design-cancel">Cancel</button> : null}
        {d.error ? <span role="alert" data-testid="design-error" style={{ color: 'var(--rv-danger-text, #f87171)' }}>{d.error}</span> : null}
      </header>
      <aside style={{ overflowY: 'auto', padding: 12, borderRight: '1px solid var(--rv-border, #2a2f37)' }}>
        {d.bundle?.references.length ? (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
            {d.bundle.references.map((r) => <img key={r.id} src={r.image_url} alt={`${r.view} reference (${r.source})`} title={`${r.view} reference (${r.source})`} width={64} height={64} style={{ borderRadius: 4, objectFit: 'cover' }} />)}
          </div>
        ) : null}
        {d.bundle?.distilled ? <p className="rv-hint" data-testid="design-features">Signature features: {d.bundle.distilled.signature_features.join(', ')}</p> : null}
        <GenerationTimeline events={d.events} />
      </aside>
      <main style={{ position: 'relative', minHeight: 0 }}>
        <RivetStage boundsMm={frame ?? undefined} label="Generated 3D design" onBackgroundClick={() => setSelectedBody(null)}>
          <PreviewSwapper url={sceneUrl} selectedBodyId={selectedBody} layers={layers} explode={explode} onSelect={setSelectedBody}
            onBounds={(b) => setFrame((prev) => growBounds(prev, b))} />
        </RivetStage>
        <div style={{ position: 'absolute', left: 12, right: 12, bottom: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <DesignLayers layers={layers} onChange={setLayers} explode={explode} onExplode={setExplode} />
          {d.bundle ? (
            <form onSubmit={(e) => { e.preventDefault(); if (instruction.trim()) { void d.revise(instruction.trim()); setInstruction(''); } }} style={{ display: 'flex', gap: 6 }}>
              <input className="rv-input" data-testid="design-revise-input" value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="Describe a change, e.g. make the chassis wider" disabled={d.busy} />
              <button type="submit" className="rv-btn rv-btn--primary" data-testid="design-revise-submit" disabled={d.busy || !instruction.trim()}>Revise</button>
            </form>
          ) : null}
        </div>
      </main>
      <aside style={{ overflowY: 'auto', padding: 12, borderLeft: '1px solid var(--rv-border, #2a2f37)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {d.bundle ? (
          <>
            <CandidateCompare candidates={d.bundle.candidates} selectedId={d.bundle.selected_candidate_id} recommendedId={d.bundle.recommendation?.candidate_id} onChoose={(c) => void d.select(c)} />
            <DesignChoice bundle={d.bundle} revisions={d.revisions} onRestore={(r) => void d.restore(r)} busy={d.busy} />
            <EditableFeatureHandles part={part} busy={d.busy} onRequestChange={(text, ids) => void d.revise(text, ids)} />
            {chosen ? (
              <section aria-label="Engineering" className="rv-details" style={{ padding: 10 }} data-testid="design-claims">
                <p style={{ margin: 0 }}>Buildability: <strong>{chosen.claims?.buildability.replace(/_/g, ' ')}</strong> · geometry {chosen.claims?.geometric_validity} · electrical {chosen.claims?.electrical.replace(/_/g, ' ')} · firmware {chosen.claims?.firmware.replace(/_/g, ' ')}</p>
                <p className="rv-hint" style={{ margin: '4px 0 0' }}>Visual scores are subjective and never count toward buildability.</p>
                {(d.bundle.provenance.limitations ?? []).length ? <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{(d.bundle.provenance.limitations ?? []).map((l) => <li key={l} className="rv-hint">{l}</li>)}</ul> : null}
              </section>
            ) : null}
            {chosen ? (
              <section aria-label="Exports" className="rv-details" style={{ padding: 10 }} data-testid="design-exports">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  <a className="rv-btn rv-btn--small" href={exportUrl('glb')} download>Assembly GLB</a>
                  <a className="rv-btn rv-btn--small" href={exportUrl('assembly_step')} download>Assembly STEP</a>
                  <a className="rv-btn rv-btn--small" href={exportUrl('bom')} download>BOM</a>
                  <a className="rv-btn rv-btn--small" href={exportUrl('assembly_steps')} download>Steps</a>
                  <a className="rv-btn rv-btn--small" href={exportUrl('manifest')} download>Manifest</a>
                  {chosen.claims?.firmware === 'supported' ? <a className="rv-btn rv-btn--small" href={exportUrl('firmware')} download>Firmware</a> : null}
                </div>
                {fabricated.length ? <p className="rv-hint" style={{ margin: '6px 0 0' }}>Fabricated parts: {fabricated.map((p) => (
                  <span key={p.body_id}> {String(p.name)} (<a href={exportUrl('step', p.body_id)}>STEP</a>/<a href={exportUrl('stl', p.body_id)}>STL</a>)</span>
                ))}</p> : null}
              </section>
            ) : null}
            {chosen && d.bundle.references.length ? (
              <section aria-label="Reference comparison">
                <button type="button" className="rv-btn rv-btn--small" onClick={() => setShowDiff((v) => !v)}>{showDiff ? 'Hide' : 'Compare with reference'}</button>
                {showDiff ? <VisualDiff references={d.bundle.references} shots={chosen.shots} /> : null}
              </section>
            ) : null}
          </>
        ) : (
          <p className="rv-hint" data-testid="design-waiting">{d.busy ? 'Generating three candidates; geometry appears as each subassembly is built.' : 'No design loaded.'}</p>
        )}
      </aside>
    </div>
  );
}
