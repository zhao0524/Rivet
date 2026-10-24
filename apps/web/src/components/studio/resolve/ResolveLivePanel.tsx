'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { UploadedImageAsset } from '../../../lib/rivet/types';
import { isRivetError } from '../../../lib/rivet/errors';
import { RESOLVE_STAGE_LABEL, runResolve, type ResolveSource } from '../../../lib/resolve/run';
import type { Resolution, ResolveRequest } from '../../../lib/resolve/types';
import { ACCEPTED_IMAGE_TYPES, validateImageFile } from '../intake/validation';
import { ResolveResultView } from './ResolveResultView';

type State =
  | { kind: 'idle' }
  | { kind: 'running'; label: string }
  | { kind: 'done'; resolution: Resolution }
  | { kind: 'error'; message: string; hint?: string; code?: string };

export interface ResolveLivePanelProps {
  source: ResolveSource;
  uploadImage: (file: File, options?: { signal?: AbortSignal }) => Promise<UploadedImageAsset>;
  /** Poll interval for the resolve job; tests shorten it. */
  pollIntervalMs?: number;
}

const MAX_TEXT = 2000;

/** Live mode: identify a product from a photo or a description and show what the sources back. */
export function ResolveLivePanel({ source, uploadImage, pollIntervalMs }: ResolveLivePanelProps) {
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [state, setState] = useState<State>({ kind: 'idle' });
  const abort = useRef<AbortController | null>(null);
  const textId = useId();
  const fileId = useId();

  useEffect(() => () => abort.current?.abort(), []);

  const busy = state.kind === 'running';
  const canSubmit = !busy && fileError === null && (file !== null || text.trim() !== '');

  async function submit() {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    try {
      let assetId: string | null = null;
      if (file) {
        setState({ kind: 'running', label: 'Uploading the image' });
        assetId = (await uploadImage(file, { signal: controller.signal })).asset_id;
      }
      const userText = text.trim() === '' ? null : text.trim();
      const request: ResolveRequest = {
        input: {
          kind: assetId && userText ? 'image_and_text' : assetId ? 'image' : 'text',
          image_asset_id: assetId,
          user_text: userText,
        },
      };
      setState({ kind: 'running', label: 'Starting the lookup' });
      const resolution = await runResolve(source, request, {
        signal: controller.signal,
        pollIntervalMs,
        onJob: (job) =>
          setState({
            kind: 'running',
            label: (job.stage && RESOLVE_STAGE_LABEL[job.stage]) ?? 'Waiting for the lookup to start',
          }),
      });
      if (!controller.signal.aborted) setState({ kind: 'done', resolution });
    } catch (err) {
      if (controller.signal.aborted) return;
      setState(
        isRivetError(err)
          ? { kind: 'error', message: err.message, hint: err.hint, code: err.code }
          : { kind: 'error', message: 'The lookup failed unexpectedly.' },
      );
    }
  }

  return (
    <div style={{ display: 'grid', gap: 12 }} data-testid="resolve-live">
      <form
        style={{ display: 'grid', gap: 8 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) void submit();
        }}
      >
        <label htmlFor={fileId} className="rv-label">
          Photo of the product (optional)
        </label>
        <input
          id={fileId}
          type="file"
          accept={ACCEPTED_IMAGE_TYPES.join(',')}
          disabled={busy}
          data-testid="resolve-image-input"
          onChange={(e) => {
            const next = e.target.files?.[0] ?? null;
            const check = next ? validateImageFile(next) : { ok: true as const };
            setFile(check.ok ? next : null);
            setFileError(check.ok ? null : check.message);
          }}
        />
        {fileError ? (
          <span className="rv-hint" role="alert" data-testid="resolve-image-error">
            {fileError}
          </span>
        ) : null}
        <label htmlFor={textId} className="rv-label">
          Describe it (brand and model help)
        </label>
        <textarea
          id={textId}
          className="rv-input"
          rows={2}
          maxLength={MAX_TEXT}
          disabled={busy}
          value={text}
          data-testid="resolve-text-input"
          placeholder="For example: DJI Mini 4 drone"
          onChange={(e) => setText(e.target.value)}
        />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button type="submit" className="rv-btn rv-btn--primary" disabled={!canSubmit} data-testid="resolve-submit">
            Identify product
          </button>
          {busy ? (
            <button
              type="button"
              className="rv-btn"
              data-testid="resolve-cancel"
              onClick={() => {
                abort.current?.abort();
                setState({ kind: 'idle' });
              }}
            >
              Cancel
            </button>
          ) : null}
        </div>
      </form>

      {state.kind === 'running' ? (
        <p role="status" aria-live="polite" data-testid="resolve-progress" className="rv-muted" style={{ margin: 0 }}>
          {state.label}…
        </p>
      ) : null}
      {state.kind === 'error' ? (
        <div role="alert" className="rv-callout rv-callout--bad" data-testid="resolve-error" data-code={state.code}>
          <strong>{state.message}</strong>
          {state.hint ? <div className="rv-muted">{state.hint}</div> : null}
        </div>
      ) : null}
      {state.kind === 'done' ? <ResolveResultView result={state.resolution} /> : null}
    </div>
  );
}
