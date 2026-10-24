import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BuildIntake } from '../src/components/studio/intake/BuildIntake';
import { getSyntheticRoverIntent } from '../src/lib/fixtures';
import { HttpSource } from '../src/lib/rivet/http-source';
import { parseOrThrow, interpretResponseCheck } from '../src/lib/rivet/validate';
import type { InterpretResponse } from '../src/lib/rivet/types';

afterEach(cleanup);
const result = (supported = true): InterpretResponse => ({
  intent_id: 'intent-reviewed', intent: { ...getSyntheticRoverIntent(), confidence: 'low',
    project_family: supported ? 'rover' : 'drone' }, supported,
  limitation: supported ? null : { code: 'UNSUPPORTED_PROJECT_FAMILY', message: 'Drones cannot be built.', details: {} },
  vision_mode: 'fixture',
});

async function review(onGenerate = vi.fn(), supported = true) {
  const onInterpret = vi.fn().mockResolvedValue(result(supported));
  render(<BuildIntake onUpload={vi.fn()} onGenerate={onGenerate} onInterpret={onInterpret} />);
  fireEvent.change(screen.getByLabelText(/What should it do/), { target: { value: 'Make a rover' } });
  fireEvent.click(screen.getByRole('button', { name: 'Review interpretation' }));
  await screen.findByTestId('interpretation-card');
  return { onGenerate, onInterpret };
}

describe('interpretation before generation', () => {
  it('waits for confirmation and discloses confidence and fixture vision', async () => {
    const { onGenerate } = await review();
    expect(onGenerate).not.toHaveBeenCalled();
    expect(screen.getByTestId('interpretation-card').textContent).toContain('Low confidence');
    expect(screen.getByTestId('interpretation-card').textContent).toContain('does not read your image');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and build' }));
    await waitFor(() => expect(onGenerate).toHaveBeenCalledWith(expect.objectContaining({ intent_id: 'intent-reviewed', interpretation_choice: 'as_interpreted' })));
  });
  it('unsupported family requires an explicit closest-rover choice', async () => {
    const { onGenerate } = await review(vi.fn(), false);
    expect(screen.queryByRole('button', { name: 'Confirm and build' })).toBeNull();
    expect(onGenerate).not.toHaveBeenCalled();
    expect(screen.getByTestId('interpretation-card').textContent).toContain('Drones cannot be built');
    fireEvent.click(screen.getByRole('button', { name: 'Build the closest supported rover' }));
    await waitFor(() => expect(onGenerate).toHaveBeenCalledWith(expect.objectContaining({ interpretation_choice: 'closest_supported_rover' })));
  });
  it('changing the description invalidates the previous interpretation', async () => {
    const { onGenerate, onInterpret } = await review();
    fireEvent.change(screen.getByLabelText(/What should it do/), { target: { value: 'A different request' } });
    expect(screen.queryByTestId('interpretation-card')).toBeNull();
    expect(onGenerate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Review interpretation' }));
    await waitFor(() => expect(onInterpret).toHaveBeenCalledTimes(2));
    expect(onInterpret.mock.calls[1][0].input.user_text).toBe('A different request');
  });
  it('expired interpretations return to review without retrying generation', async () => {
    const generate = vi.fn().mockRejectedValue({ code: 'INTENT_NOT_FOUND' });
    await review(generate);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and build' }));
    await waitFor(() => expect(screen.queryByTestId('interpretation-card')).toBeNull());
    expect(screen.getByTestId('intake-error').textContent).toContain('expired');
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it('sends the preview to the interpretation endpoint and validates feature enums', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(result()), { status: 200 }));
    const source = new HttpSource({ baseUrl: '', fetch });
    const input = { input: { kind: 'text' as const, image_asset_id: null, user_text: 'rover' } };
    expect((await source.interpret(input)).intent_id).toBe('intent-reviewed');
    expect(fetch.mock.calls[0][0]).toBe('/api/intents/interpret');
    const bad = result();
    (bad.intent as unknown as { image_features: unknown }).image_features = { range_sensor_position: 'anywhere' };
    expect(() => parseOrThrow(interpretResponseCheck, bad, 'interpretation')).toThrow();
  });
  it('accepts an image-only interpretation whose user_text is null (contract §3.1)', async () => {
    const imageOnly = result();
    imageOnly.intent.input = { kind: 'image', image_asset_id: 'asset-1', user_text: null };
    const parsed = parseOrThrow(interpretResponseCheck, imageOnly, 'interpretation');
    expect(parsed.intent.input.user_text).toBeNull();
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(imageOnly), { status: 200 }));
    const source = new HttpSource({ baseUrl: '', fetch });
    const interpreted = await source.interpret({ input: { kind: 'image', image_asset_id: 'asset-1', user_text: null } });
    expect(interpreted.intent.input.user_text).toBeNull();
  });
});
