import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExportPanel, type ExportPanelProps } from '../ExportPanel';
import { getSyntheticRoverPlan } from '../../../lib/fixtures';
import { FixtureSource, type EstelleStatusState } from '../../../lib/rivet';
import {
  ESTELLE_STATUS,
  FIXTURE_STATUS_REASON,
  GROUNDED_RESULT,
} from '../../../lib/rivet/__tests__/estelle-payloads';

afterEach(() => {
  cleanup();
});

function renderPanel(estelleStatus: EstelleStatusState, overrides: Partial<ExportPanelProps> = {}) {
  const props: ExportPanelProps = {
    plan: getSyntheticRoverPlan(),
    dataSource: new FixtureSource(),
    estelleStatus,
    estelleGroundResult: null,
    estelleLoading: false,
    estelleError: null,
    onGroundSymbol: vi.fn(async () => null),
    ...overrides,
  };
  render(<ExportPanel {...props} />);
  return { props, panel: screen.getByTestId('estelle-grounding-panel') };
}

const badge = () => screen.getByTestId('estelle-status-badge');
const message = () => screen.getByTestId('estelle-status-message');
const reason = () => screen.getByTestId('estelle-status-reason').textContent;
const enableHint = () => screen.queryByTestId('estelle-enable-hint');
const groundButton = () => screen.queryByTestId('estelle-ground-button');

function expectEnableHint() {
  const hint = enableHint()?.textContent ?? '';
  for (const step of ['RIVET_ENABLE_ESTELLE=true', 'npm i -g @fatelabs/estelle', 'estelle login', 'estelle setup']) {
    expect(hint).toContain(step);
  }
}

const NETWORK_ERROR: EstelleStatusState = {
  kind: 'network_error',
  message: 'HTTP_500: GET /api/estelle/status failed with HTTP 500',
};

describe('ExportPanel Estelle states (#65)', () => {
  it('disabled: says disabled by configuration with the API reason verbatim, how to enable, no Ground controls', () => {
    const { panel } = renderPanel({ kind: 'disabled', status: ESTELLE_STATUS.disabled });
    expect(panel.dataset.state).toBe('disabled');
    expect(badge().textContent).toBe('disabled');
    expect(message().textContent).toContain('Disabled by configuration.');
    expect(reason()).toBe('Estelle is disabled (RIVET_ENABLE_ESTELLE is not true)');
    expect(panel.textContent).not.toMatch(/could not reach|network error/i);
    expectEnableHint();
    expect(groundButton()).toBeNull();
  });

  it('unavailable (CLI not installed): shows the API reason verbatim and how to enable, no Ground controls', () => {
    renderPanel({ kind: 'unavailable', status: ESTELLE_STATUS.cliMissing });
    expect(badge().textContent).toBe('unavailable');
    expect(message().textContent).toContain('Unavailable.');
    expect(reason()).toBe('The estelle CLI is not installed (npm i -g @fatelabs/estelle)');
    expect(screen.queryByTestId('estelle-doctor-output')).toBeNull();
    expectEnableHint();
    expect(groundButton()).toBeNull();
  });

  it('unavailable (not authenticated): shows the API reason and the estelle doctor output', () => {
    renderPanel({ kind: 'unavailable', status: ESTELLE_STATUS.notAuthenticated });
    expect(reason()).toBe('estelle doctor exited with status 2');
    const doctor = screen.getByTestId('estelle-doctor-output').textContent;
    expect(doctor).toContain('exit 2');
    expect(doctor).toContain('Error: not logged in. Run estelle login');
    expectEnableHint();
    expect(groundButton()).toBeNull();
  });

  it('unavailable in fixture mode: keeps the fixture reason', () => {
    renderPanel({
      kind: 'unavailable',
      status: { enabled: false, mode: 'fixture', available: false, doctor: null, reason: FIXTURE_STATUS_REASON },
    });
    expect(badge().textContent).toBe('unavailable');
    expect(reason()).toBe(FIXTURE_STATUS_REASON);
    expect(groundButton()).toBeNull();
  });

  it('ready: offers the Ground controls and sends the chosen symbol', () => {
    const { panel, props } = renderPanel({ kind: 'ready', status: ESTELLE_STATUS.ready });
    expect(panel.dataset.state).toBe('ready');
    expect(badge().textContent).toBe('ready');
    expect(message().textContent).toContain('Ready.');
    expect(message().textContent).toContain('cli mode, estelle doctor exit 0');
    expect(enableHint()).toBeNull();

    fireEvent.change(screen.getByTestId('estelle-ground-kind'), { target: { value: 'dependencies' } });
    fireEvent.change(screen.getByTestId('estelle-symbol-select'), { target: { value: 'stop_motors' } });
    fireEvent.click(groundButton()!);
    expect(props.onGroundSymbol).toHaveBeenCalledWith({ kind: 'dependencies', name: 'stop_motors' });
  });

  it('ready: lists the citations of a grounding result', () => {
    renderPanel({ kind: 'ready', status: ESTELLE_STATUS.ready }, { estelleGroundResult: GROUNDED_RESULT });
    const result = screen.getByTestId('estelle-ground-result');
    expect(result.dataset.status).toBe('ok');
    expect(within(result).getByTestId('estelle-citations-list').textContent).toContain(
      'services/api/rivet_api/firmware/templates/esp32_rover/main.cpp.tmpl:54',
    );
  });

  it('network error: shows a distinct alert with the failure detail, no enable hint and no Ground controls', () => {
    const { panel } = renderPanel(NETWORK_ERROR);
    expect(panel.dataset.state).toBe('network_error');
    expect(badge().textContent).toBe('network error');
    expect(message().getAttribute('role')).toBe('alert');
    expect(message().textContent).toContain('Network error.');
    expect(screen.getByTestId('estelle-status-error').textContent).toBe(
      'HTTP_500: GET /api/estelle/status failed with HTTP 500',
    );
    expect(enableHint()).toBeNull();
    expect(groundButton()).toBeNull();
  });

  it('checking: says so and offers nothing yet', () => {
    renderPanel({ kind: 'checking' });
    expect(badge().textContent).toBe('checking');
    expect(message().textContent).toBe('Checking Estelle status…');
    expect(enableHint()).toBeNull();
    expect(groundButton()).toBeNull();
  });

  it('never shows a grounding result or error unless ready', () => {
    renderPanel(
      { kind: 'disabled', status: ESTELLE_STATUS.disabled },
      { estelleGroundResult: GROUNDED_RESULT, estelleError: 'NETWORK_ERROR: grounding failed' },
    );
    expect(screen.queryByTestId('estelle-ground-result')).toBeNull();
    expect(screen.queryByText('NETWORK_ERROR: grounding failed')).toBeNull();
  });

  it('gives every state its own message', () => {
    const states: EstelleStatusState[] = [
      { kind: 'checking' },
      { kind: 'disabled', status: ESTELLE_STATUS.disabled },
      { kind: 'unavailable', status: ESTELLE_STATUS.cliMissing },
      { kind: 'ready', status: ESTELLE_STATUS.ready },
      NETWORK_ERROR,
    ];
    const lead = states.map((state) => {
      renderPanel(state);
      const text = message().querySelector('strong')?.textContent ?? message().textContent;
      cleanup();
      return text;
    });
    expect(lead).toEqual(['Checking Estelle status…', 'Disabled by configuration.', 'Unavailable.', 'Ready.', 'Network error.']);
  });
});
