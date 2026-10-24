import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ResolveLivePanel } from '../ResolveLivePanel';
import { makeResolveFixtures } from '../../../../lib/resolve/fixtures';
import type { ResolveSource } from '../../../../lib/resolve/run';
import type { ResolveJob, ResolveRequest } from '../../../../lib/resolve/types';

afterEach(cleanup);

const FIXTURES = makeResolveFixtures(new Date());

function fakeSource(jobs: ResolveJob[]) {
  const requests: ResolveRequest[] = [];
  const source: ResolveSource = {
    resolveProduct: vi.fn(async (req: ResolveRequest) => {
      requests.push(req);
      return { job_id: 'job-1', status: 'queued', resolution_id: null };
    }),
    getResolveJob: vi.fn(async () => (jobs.length > 1 ? jobs.shift()! : jobs[0])),
    getResolution: vi.fn(async () => ({ ...FIXTURES.partial_match, provenance: { ...FIXTURES.partial_match.provenance, saved_example: false, banner: null } })),
  };
  return { source, requests };
}

const running = (stage: string): ResolveJob => ({ job_id: 'job-1', status: 'running', stage, progress: null });
const complete: ResolveJob = { job_id: 'job-1', status: 'complete', stage: 'complete', progress: 1, resolution_id: 'res-1' };
const upload = vi.fn(async () => ({ asset_id: 'asset-' + 'a'.repeat(32), mime_type: 'image/png', size_bytes: 4, preview_url: '' }));

describe('ResolveLivePanel', () => {
  it('needs a photo or a description before it can start', () => {
    render(<ResolveLivePanel source={fakeSource([]).source} uploadImage={upload} pollIntervalMs={0} />);
    expect((screen.getByTestId('resolve-submit') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId('resolve-text-input'), { target: { value: '   ' } });
    expect((screen.getByTestId('resolve-submit') as HTMLButtonElement).disabled).toBe(true);
  });

  it('sends a text lookup, shows the real stages, then renders the checked result', async () => {
    const { source, requests } = fakeSource([running('identify'), running('verify'), complete]);
    render(<ResolveLivePanel source={source} uploadImage={upload} pollIntervalMs={0} />);
    fireEvent.change(screen.getByTestId('resolve-text-input'), { target: { value: ' Example Aero Scout Mini ' } });
    fireEvent.click(screen.getByTestId('resolve-submit'));
    await waitFor(() => expect(screen.getByTestId('resolve-result')).toBeTruthy());
    expect(requests).toEqual([{ input: { kind: 'text', image_asset_id: null, user_text: 'Example Aero Scout Mini' } }]);
    expect(upload).not.toHaveBeenCalled();
    expect(screen.getByTestId('resolve-result').dataset.outcome).toBe('partial_match');
    expect(screen.queryByTestId('resolve-provenance-banner')).toBeNull();
  });

  it('uploads the photo first and sends it with the description', async () => {
    const { source, requests } = fakeSource([complete]);
    render(<ResolveLivePanel source={source} uploadImage={upload} pollIntervalMs={0} />);
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'drone.png', { type: 'image/png' });
    fireEvent.change(screen.getByTestId('resolve-image-input'), { target: { files: [file] } });
    fireEvent.change(screen.getByTestId('resolve-text-input'), { target: { value: 'my drone' } });
    fireEvent.click(screen.getByTestId('resolve-submit'));
    await waitFor(() => expect(screen.getByTestId('resolve-result')).toBeTruthy());
    expect(upload).toHaveBeenCalledWith(file, expect.anything());
    expect(requests[0].input).toEqual({ kind: 'image_and_text', image_asset_id: 'asset-' + 'a'.repeat(32), user_text: 'my drone' });
  });

  it('refuses an unsupported file before uploading', () => {
    render(<ResolveLivePanel source={fakeSource([]).source} uploadImage={upload} pollIntervalMs={0} />);
    const file = new File(['x'], 'notes.txt', { type: 'text/plain' });
    fireEvent.change(screen.getByTestId('resolve-image-input'), { target: { files: [file] } });
    expect(screen.getByTestId('resolve-image-error').textContent).toContain('not supported');
    expect((screen.getByTestId('resolve-submit') as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the server error when the lookup fails, and no result', async () => {
    const { source } = fakeSource([
      {
        job_id: 'job-1',
        status: 'failed',
        stage: 'failed',
        progress: null,
        error: { code: 'SYNTHETIC_EVIDENCE_IN_LIVE_RESOLUTION', message: 'A live resolution contains sample sources' },
      },
    ]);
    render(<ResolveLivePanel source={source} uploadImage={upload} pollIntervalMs={0} />);
    fireEvent.change(screen.getByTestId('resolve-text-input'), { target: { value: 'drone' } });
    fireEvent.click(screen.getByTestId('resolve-submit'));
    const error = await screen.findByTestId('resolve-error');
    expect(error.dataset.code).toBe('SYNTHETIC_EVIDENCE_IN_LIVE_RESOLUTION');
    expect(error.textContent).toContain('sample sources');
    expect(error.textContent).toContain('Nothing was stored');
    expect(screen.queryByTestId('resolve-result')).toBeNull();
  });
});
