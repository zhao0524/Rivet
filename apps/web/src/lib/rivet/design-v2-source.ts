import type { DesignBundle, DesignCandidate, DesignEvent, DesignJob, DesignPart, DesignRequest, SavedDesign } from './design-v2-types';

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label}`);
  return value as Record<string, unknown>;
}
function string(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string') throw new Error(`Invalid ${label}`);
}
function integer(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error(`Invalid ${label}`);
}
export function designAssetUrl(value: unknown): string {
  if (typeof value !== 'string' || !/^\/api\/v2\/assets\/[a-zA-Z0-9_-]+(?:\/preview)?$/.test(value)) throw new Error('Invalid design asset URL');
  return value;
}
function parts(value: unknown): asserts value is DesignPart[] {
  if (!Array.isArray(value)) throw new Error('Invalid part manifest');
  const ids = new Set<string>();
  for (const raw of value) {
    const part = object(raw, 'part'); string(part.body_id, 'body ID');
    if (ids.has(part.body_id)) throw new Error('Duplicate body ID'); ids.add(part.body_id);
    if (part.asset_url != null) designAssetUrl(part.asset_url);
    if (part.bounds_mm != null) {
      const bounds = object(part.bounds_mm, 'bounds');
      for (const key of ['min', 'max']) if (!Array.isArray(bounds[key]) || bounds[key].length !== 3 || !bounds[key].every(Number.isFinite)) throw new Error('Invalid part bounds');
    }
  }
}
export function parseDesignBundle(value: unknown): DesignBundle {
  const b = object(value, 'design');
  if (b.schema_version !== '2.0') throw new Error('Unsupported design version');
  for (const key of ['build_id', 'job_id', 'title', 'created_at']) string(b[key], key);
  integer(b.revision, 'revision');
  if (!['concept_only', 'engineered'].includes(String(b.mode)) || !['complete', 'needs_review', 'unbuildable'].includes(String(b.status))) throw new Error('Invalid design status or mode');
  if (!Array.isArray(b.candidates) || !Array.isArray(b.references)) throw new Error('Invalid design candidates/references');
  const ids = new Set<string>();
  for (const raw of b.candidates) {
    const c = object(raw, 'candidate'); string(c.id, 'candidate ID'); string(c.strategy, 'strategy');
    if (ids.has(c.id)) throw new Error('Duplicate candidate ID'); ids.add(c.id);
    if (!['complete', 'failed'].includes(String(c.status)) || typeof c.feasible !== 'boolean') throw new Error('Invalid candidate status');
    if (c.scene_asset_url !== null) designAssetUrl(c.scene_asset_url);
    parts(c.part_manifest); object(c.mechanical, 'mechanical report'); object(c.functional, 'functional report');
    if (!Array.isArray(c.shots)) throw new Error('Invalid screenshots');
    for (const rawShot of c.shots) { const shot = object(rawShot, 'shot'); string(shot.view, 'view'); designAssetUrl(shot.image_url); }
    if (c.visual != null) {
      const review = object(c.visual, 'visual review'); object(review.scores, 'scores'); string(review.summary, 'review summary');
      if (review.subjective !== true || !Number.isFinite(review.overall) || !Array.isArray(review.issues)) throw new Error('Invalid visual review');
      for (const rawIssue of review.issues) {
        const issue = object(rawIssue, 'issue');
        if (issue.body_id !== null) string(issue.body_id, 'body_id');
        for (const key of ['view', 'severity', 'observed', 'target', 'proposed_change']) string(issue[key], key);
      }
    }
  }
  if (b.selected_candidate_id !== null && !ids.has(String(b.selected_candidate_id))) throw new Error('Selected candidate is missing');
  if (b.scene_asset_url !== null) designAssetUrl(b.scene_asset_url);
  parts(b.assembly);
  for (const raw of b.references) { const ref = object(raw, 'reference'); string(ref.id, 'reference ID'); string(ref.view, 'reference view'); designAssetUrl(ref.image_url); }
  const distilled = object(b.distilled, 'distilled intent'); string(distilled.subject, 'subject'); string(distilled.summary, 'summary');
  if (!Array.isArray(distilled.signature_features) || !distilled.signature_features.every((x) => typeof x === 'string')) throw new Error('Invalid signature_features');
  for (const key of ['mechanical_constraints', 'uncertainties', 'unsupported', 'simplifications']) {
    if (distilled[key] != null && (!Array.isArray(distilled[key]) || !(distilled[key] as unknown[]).every((x) => typeof x === 'string'))) throw new Error(`Invalid ${key}`);
  }
  const provenance = object(b.provenance, 'provenance');
  if (typeof provenance.cached !== 'boolean' || !['live', 'fixture'].includes(String(provenance.generation_mode))) throw new Error('Invalid provenance');
  if (b.visual_quality !== undefined) {
    const vq = object(b.visual_quality, 'visual_quality');
    if (typeof vq.achieved !== 'boolean' || !Number.isFinite(vq.target) || typeof vq.statement !== 'string') throw new Error('Invalid visual quality');
  }
  const budget = object(b.budget, 'budget');
  for (const key of ['limit_usd', 'spent_usd', 'reserved_usd']) if (!Number.isFinite(budget[key]) || Number(budget[key]) < 0) throw new Error('Invalid budget');
  return b as unknown as DesignBundle;
}
export function parseDesignEvent(value: unknown): DesignEvent {
  const e = object(value, 'event');
  if (e.schema_version !== '2.0') throw new Error('Unsupported event version');
  integer(e.event_id, 'event ID');
  for (const key of ['job_id', 'stage', 'status', 'actor', 'message', 'timestamp']) string(e[key], key);
  if (!Array.isArray(e.references) || typeof e.is_partial !== 'boolean') throw new Error('Invalid event references');
  for (const raw of e.references) { const ref = object(raw, 'event reference'); string(ref.type, 'reference type'); string(ref.id, 'reference ID'); designAssetUrl(ref.url); }
  if (e.snapshot) { const s = object(e.snapshot, 'snapshot'); designAssetUrl(s.scene_asset_url); integer(s.preview_revision, 'preview revision'); parts(s.part_manifest); string(s.geometry_digest, 'geometry digest'); }
  return e as unknown as DesignEvent;
}
function job(value: unknown): DesignJob {
  const j = object(value, 'job'); string(j.job_id, 'job ID'); string(j.status, 'job status');
  if (j.build_id != null) string(j.build_id, 'build ID');
  return j as unknown as DesignJob;
}
export function mergeDesignEvents(previous: DesignEvent[], incoming: DesignEvent, jobId: string): DesignEvent[] {
  if (incoming.job_id !== jobId || previous.some((e) => e.event_id === incoming.event_id)) return previous;
  return [...previous, incoming].sort((a, b) => a.event_id - b.event_id);
}
export function latestPreview(events: DesignEvent[], candidateId: string | null) {
  return events.filter((e) => e.snapshot && (!candidateId || e.candidate_id === candidateId))
    .sort((a, b) => (b.snapshot!.preview_revision - a.snapshot!.preview_revision) || b.event_id - a.event_id)[0];
}
export class DesignSource {
  private sessionRequest: Promise<void> | null = null;
  async request(path: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
    const response = await fetch(`/api/v2${path}`, { method: body === undefined ? 'GET' : 'POST', credentials: 'include',
      headers: body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body), signal });
    const value: unknown = await response.json();
    if (!response.ok) {
      if (path === '/session' && response.status === 404) throw new Error('3D generation is unavailable on this server. Try again later or explore a saved example.');
      const error = object(value, 'error').error as { message?: string; code?: string } | undefined;
      throw new Error(`${error?.code ?? response.status}: ${error?.message ?? 'Request failed'}`);
    }
    return value;
  }
  async session() {
    // Concurrent callers must share the cookie handshake; competing sessions orphan jobs.
    this.sessionRequest ??= this.request('/session').then(() => undefined).catch((error) => {
      this.sessionRequest = null;
      throw error;
    });
    await this.sessionRequest;
  }
  async upload(file: File) { const data = new FormData(); data.append('file', file); const result = object(await this.request('/assets/images', data), 'upload'); string(result.asset_id, 'asset ID'); designAssetUrl(result.preview_url); return result as { asset_id: string; preview_url: string; sha256: string }; }
  async generate(request: DesignRequest) { return job(await this.request('/generations', request)); }
  async status(id: string) { return job(await this.request(`/generations/${encodeURIComponent(id)}`)); }
  async cancel(id: string) { return this.request(`/generations/${encodeURIComponent(id)}/cancel`, {}); }
  async design(id: string, revision?: number) { return parseDesignBundle(await this.request(`/projects/${encodeURIComponent(id)}/design${revision ? `?revision=${revision}` : ''}`)); }
  async projects() { const r = object(await this.request('/projects'), 'projects'); if (!Array.isArray(r.projects)) throw new Error('Invalid projects'); return r.projects as SavedDesign[]; }
  async revisions(id: string) { const r = object(await this.request(`/projects/${encodeURIComponent(id)}/revisions`), 'revisions'); if (!Array.isArray(r.revisions)) throw new Error('Invalid revisions'); return r.revisions as SavedDesign[]; }
  async select(bundle: DesignBundle, candidate: DesignCandidate) { await this.request(`/projects/${encodeURIComponent(bundle.build_id)}/select`, { job_id: bundle.job_id, base_revision: bundle.revision, candidate_id: candidate.id }); return this.design(bundle.build_id); }
  async revise(bundle: DesignBundle, instruction: string, selected: string[]) { return job(await this.request(`/projects/${encodeURIComponent(bundle.build_id)}/revise`, { base_revision: bundle.revision, instruction, selected_body_ids: selected })); }
  async restore(bundle: DesignBundle, targetRevision: number) { await this.request(`/projects/${encodeURIComponent(bundle.build_id)}/restore`, { base_revision: bundle.revision, target_revision: targetRevision }); return this.design(bundle.build_id); }
  exportUrl(bundle: DesignBundle, kind: string, bodyId?: string) { return `/api/v2/projects/${encodeURIComponent(bundle.build_id)}/export?revision=${bundle.revision}&kind=${encodeURIComponent(kind)}${bodyId ? `&body_id=${encodeURIComponent(bodyId)}` : ''}`; }
  async events(id: string, onEvent: (event: DesignEvent) => void, signal: AbortSignal) {
    let last = 0;
    while (!signal.aborted) {
      try {
        const response = await fetch(`/api/v2/generations/${encodeURIComponent(id)}/events?last_event_id=${last}`, { credentials: 'include', signal, headers: { Accept: 'text/event-stream', 'Last-Event-ID': String(last) } });
        if (!response.ok || !response.body) throw new Error('Event stream unavailable');
        const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
        try {
          while (!signal.aborted) {
            const result = await reader.read(); if (result.done) break;
            buffer += decoder.decode(result.value, { stream: true }).replace(/\r\n/g, '\n');
            let end;
            while ((end = buffer.indexOf('\n\n')) !== -1) {
              const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
              const data = frame.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
              if (!data) continue;
              const event = parseDesignEvent(JSON.parse(data));
              if (event.job_id !== id || event.event_id <= last) continue;
              last = event.event_id; onEvent(event);
              if (['complete', 'failed', 'cancelled', 'budget_exhausted'].includes(event.stage)) return;
            }
          }
        } finally { await reader.cancel().catch(() => {}); }
      } catch (error) { if (signal.aborted) return; if (error instanceof SyntaxError || (error instanceof Error && error.message.startsWith('Invalid'))) throw error; }
      await new Promise<void>((done) => { const timer = setTimeout(done, 1500); signal.addEventListener('abort', () => { clearTimeout(timer); done(); }, { once: true }); });
    }
  }
}
