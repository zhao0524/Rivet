'use client';

import { useState, type FormEvent } from 'react';
import type {
  BuildPlan,
  CatalogComponent,
  EditOperation,
  EditResponse,
  RevisionSummary,
} from '../../lib/rivet/types';
import type { PartSelectionApi } from '../three/interactions';
import { PLAN_STATUS_LABEL } from './panels/helpers';

export interface PartsPanelProps {
  plan: BuildPlan;
  catalog: readonly CatalogComponent[];
  revisions: RevisionSummary[];
  selection: PartSelectionApi;
  revisionPending?: boolean;
  revisionError?: string | null;
  onSelectRevision: (revision: number) => void;
  editPending?: boolean;
  lastEditResponse?: EditResponse | null;
  editError?: string | null;
  onSubmitEdit: (instruction: string, operation?: EditOperation) => Promise<EditResponse | null>;
  onOpenIntake?: () => void;
  /** What was asked for: reference image, original prompt and stated constraints. */
  request?: BuildRequestSummary | null;
}

export interface BuildRequestSummary {
  prompt: string | null;
  imageUrl: string | null;
  /** `generated`: requested in this session; `saved`: the intent stored with a saved example. */
  origin: 'generated' | 'saved';
  requirements: string[];
}

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'bad'> = {
  verified: 'ok',
  verified_with_warnings: 'warn',
  needs_review: 'warn',
  unbuildable: 'bad',
};

const CHANGE_PLACEHOLDER = 'Make it cheaper and move the sensor higher';

type EditOpKind =
  | 'set_behavior_parameter'
  | 'change_appearance_color'
  | 'set_mount_offset_within_template'
  | 'set_budget'
  | 'replace_optional_sensor';

export function PartsPanel({
  plan,
  catalog,
  revisions,
  selection,
  revisionPending = false,
  revisionError = null,
  onSelectRevision,
  editPending = false,
  lastEditResponse = null,
  editError = null,
  onSubmitEdit,
  onOpenIntake,
  request = null,
}: PartsPanelProps) {
  const catalogById = new Map(catalog.map((c) => [c.catalog_id, c]));
  const [changeText, setChangeText] = useState('');
  const orderedRevisions = [...revisions].sort((a, b) => b.revision - a.revision);
  const latestRevision = orderedRevisions[0]?.revision;

  const [opKind, setOpKind] = useState<EditOpKind>('set_behavior_parameter');
  const [instruction, setInstruction] = useState('Make it cheaper and move the sensor higher');
  const [behaviorParam, setBehaviorParam] = useState('obstacle_stop_distance_m');
  const [behaviorValue, setBehaviorValue] = useState('0.35');
  const [targetInstanceId, setTargetInstanceId] = useState(
    () => plan.components[0]?.instance_id ?? 'chassis-1',
  );
  const [colorHex, setColorHex] = useState('#2563EB');
  const [offsetY, setOffsetY] = useState('12');
  const [budgetAmount, setBudgetAmount] = useState('45.00');
  const [sensorCatalogId, setSensorCatalogId] = useState('demo.range');

  function buildOperation(): EditOperation {
    switch (opKind) {
      case 'set_behavior_parameter':
        return {
          op: 'set_behavior_parameter',
          name: behaviorParam,
          value: Number(behaviorValue),
        };
      case 'change_appearance_color':
        return {
          op: 'change_appearance_color',
          instance_id: selection.selectedInstanceId ?? targetInstanceId,
          color: colorHex,
        };
      case 'set_mount_offset_within_template':
        return {
          op: 'set_mount_offset_within_template',
          instance_id: selection.selectedInstanceId ?? 'sensor-1',
          offset_mm: [0, Number(offsetY) || 0, 0],
        };
      case 'set_budget':
        return {
          op: 'set_budget',
          amount: budgetAmount.trim() || '50.00',
          currency: plan.bom.currency || 'USD',
        };
      case 'replace_optional_sensor':
        return {
          op: 'replace_optional_sensor',
          catalog_id: sensorCatalogId,
        };
    }
  }

  function handleEditSubmit(e: FormEvent) {
    e.preventDefault();
    const op = buildOperation();
    const desc = instruction.trim() || `${opKind}`;
    void onSubmitEdit(desc, op);
  }

  function handleChangeRequest(e: FormEvent) {
    e.preventDefault();
    const text = changeText.trim();
    if (!text || editPending) return;
    void onSubmitEdit(text);
  }

  const presetButtons = (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }} aria-label="Example changes" role="group">
      <button
        type="button"
        className="rv-chip"
        data-testid="preset-edit-sensor-higher"
        disabled={editPending}
        onClick={() => {
          setOpKind('set_mount_offset_within_template');
          setInstruction(CHANGE_PLACEHOLDER);
          setOffsetY('12');
          void onSubmitEdit(CHANGE_PLACEHOLDER, {
            op: 'set_mount_offset_within_template',
            instance_id: 'sensor-1',
            offset_mm: [0, 12, 0],
          });
        }}
      >
        Move sensor 12 mm higher
      </button>
      <button
        type="button"
        className="rv-chip"
        data-testid="preset-edit-stop-distance"
        disabled={editPending}
        onClick={() => {
          setOpKind('set_behavior_parameter');
          setBehaviorParam('obstacle_stop_distance_m');
          setBehaviorValue('0.4');
          setInstruction('Increase obstacle stop distance to 0.40 m');
          void onSubmitEdit('Increase obstacle stop distance to 0.40 m', {
            op: 'set_behavior_parameter',
            name: 'obstacle_stop_distance_m',
            value: 0.4,
          });
        }}
      >
        Stop at 0.40 m
      </button>
      <button
        type="button"
        className="rv-chip"
        data-testid="preset-edit-color"
        disabled={editPending}
        onClick={() => {
          const target = selection.selectedInstanceId ?? 'chassis-1';
          setOpKind('change_appearance_color');
          setTargetInstanceId(target);
          setColorHex('#2563EB');
          setInstruction(`Change ${target} color to #2563EB`);
          void onSubmitEdit(`Change ${target} color to #2563EB`, {
            op: 'change_appearance_color',
            instance_id: target,
            color: '#2563EB',
          });
        }}
      >
        Tint it blue
      </button>
    </div>
  );

  return (
    <div data-testid="parts-panel" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <section aria-label="Request" data-testid="request-summary" className="rv-section">
        <h2 className="rv-section__title">Request</h2>
        <div className="rv-request">
          {request?.imageUrl ? (
            <img className="rv-request__image" src={request.imageUrl} alt="Reference image" data-testid="request-image" />
          ) : (
            <div className="rv-request__image rv-request__no-image" role="img" aria-label="No reference image">
              No image
            </div>
          )}
          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {request?.prompt ? (
              <p className="rv-request__prompt" data-testid="request-prompt">
                “{request.prompt}”
              </p>
            ) : (
              <p className="rv-hint" data-testid="request-prompt-missing">
                No prompt is stored with this build.
              </p>
            )}
            {request?.origin === 'saved' ? (
              <span className="rv-hint">Saved with the example, not typed in this session.</span>
            ) : null}
          </div>
        </div>
        {request && request.requirements.length > 0 ? (
          <ul aria-label="Stated constraints" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: 0, padding: 0, listStyle: 'none' }}>
            {request.requirements.map((r) => (
              <li key={r} className="rv-badge rv-badge--neutral">
                {r}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section aria-label="Change request" data-testid="design-edit-panel" className="rv-section">
        <form onSubmit={handleChangeRequest} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label htmlFor="rv-change-request" className="rv-section__title">
            Ask for a change
          </label>
          <textarea
            id="rv-change-request"
            data-testid="change-request-input"
            className="rv-input"
            rows={2}
            value={changeText}
            placeholder={CHANGE_PLACEHOLDER}
            disabled={editPending}
            onChange={(e) => setChangeText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleChangeRequest(e);
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="submit"
              data-testid="change-request-submit"
              className="rv-btn rv-btn--primary"
              disabled={editPending || changeText.trim() === ''}
            >
              {editPending ? 'Checking change…' : 'Request change'}
            </button>
            <span className="rv-hint">Creates revision {plan.revision + 1} if the checks accept it.</span>
          </div>
        </form>
        {presetButtons}

        {lastEditResponse && (
          <p
            role="status"
            data-testid="edit-outcome-banner"
            data-accepted={lastEditResponse.accepted ? 'true' : 'false'}
            className={`rv-callout rv-callout--${lastEditResponse.accepted ? 'ok' : 'warn'}`}
          >
            {lastEditResponse.accepted ? (
              <>
                Change accepted. Created revision <strong>{lastEditResponse.revision}</strong>.
              </>
            ) : (
              <>
                <strong>Change not applied; revision {plan.revision} is unchanged.</strong>{' '}
                {lastEditResponse.finding?.message ?? 'Rejected by validator.'}
              </>
            )}
          </p>
        )}

        {editError && (
          <p role="alert" data-testid="edit-error-banner" className="rv-callout rv-callout--bad">
            {editError}
          </p>
        )}

        <details className="rv-details" data-testid="advanced-edit">
          <summary>Advanced: apply an exact operation</summary>
          <form onSubmit={handleEditSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label className="rv-field rv-hint">
              <span>Operation type</span>
              <select
                data-testid="edit-operation-select"
                value={opKind}
                onChange={(e) => setOpKind(e.target.value as EditOpKind)}
                  className="rv-input"
              >
                <option value="set_behavior_parameter">set_behavior_parameter</option>
                <option value="change_appearance_color">change_appearance_color</option>
                <option value="set_mount_offset_within_template">set_mount_offset_within_template</option>
                <option value="set_budget">set_budget</option>
                <option value="replace_optional_sensor">replace_optional_sensor</option>
              </select>
            </label>

            {opKind === 'set_behavior_parameter' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px', gap: 6 }}>
                <select
                  data-testid="edit-behavior-name"
                  value={behaviorParam}
                  onChange={(e) => setBehaviorParam(e.target.value)}
                  className="rv-input"
                >
                  <option value="obstacle_stop_distance_m">obstacle_stop_distance_m</option>
                  <option value="turn_duration_ms">turn_duration_ms</option>
                  <option value="forward_speed_fraction">forward_speed_fraction</option>
                </select>
                <input
                  type="number"
                  step="any"
                  data-testid="edit-behavior-value"
                  value={behaviorValue}
                  onChange={(e) => setBehaviorValue(e.target.value)}
                  className="rv-input"
                />
              </div>
            )}

            {opKind === 'change_appearance_color' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 70px', gap: 6 }}>
                <select
                  data-testid="edit-color-instance"
                  value={selection.selectedInstanceId ?? targetInstanceId}
                  onChange={(e) => setTargetInstanceId(e.target.value)}
                  className="rv-input"
                >
                  {plan.components.map((c) => (
                    <option key={c.instance_id} value={c.instance_id}>
                      {c.instance_id}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  data-testid="edit-color-hex"
                  value={colorHex}
                  onChange={(e) => setColorHex(e.target.value)}
                  className="rv-input"
                />
              </div>
            )}

            {opKind === 'set_mount_offset_within_template' && (
              <label className="rv-field rv-hint">
                <span>Vertical offset Y (mm) on {selection.selectedInstanceId ?? 'sensor-1'}</span>
                <input
                  type="number"
                  step="1"
                  data-testid="edit-mount-offset-y"
                  value={offsetY}
                  onChange={(e) => setOffsetY(e.target.value)}
                  className="rv-input"
                />
              </label>
            )}

            {opKind === 'set_budget' && (
              <label className="rv-field rv-hint">
                <span>Max budget ({plan.bom.currency || 'USD'})</span>
                <input
                  type="text"
                  data-testid="edit-budget-amount"
                  value={budgetAmount}
                  onChange={(e) => setBudgetAmount(e.target.value)}
                  className="rv-input"
                />
              </label>
            )}

            {opKind === 'replace_optional_sensor' && (
              <label className="rv-field rv-hint">
                <span>Replacement sensor catalog ID</span>
                <input
                  type="text"
                  data-testid="edit-sensor-catalog-id"
                  value={sensorCatalogId}
                  onChange={(e) => setSensorCatalogId(e.target.value)}
                  className="rv-input"
                />
              </label>
            )}

            <label className="rv-field rv-hint">
              <span>Instruction note</span>
              <input
                type="text"
                data-testid="edit-instruction-input"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                  className="rv-input"
              />
            </label>

            <button
              type="submit"
              data-testid="edit-submit-button"
              disabled={editPending}
              className="rv-btn"
            >
              {editPending ? 'Validating edit…' : `Apply edit to r${plan.revision}`}
            </button>
          </form>
        </details>
      </section>

      <section aria-label="Revision history" data-testid="revision-history" className="rv-section" aria-busy={revisionPending}>
        <h2 className="rv-section__title">History</h2>
        <ol className="rv-history">
          {orderedRevisions.map((r) => {
            const current = r.revision === plan.revision;
            return (
              <li key={r.revision}>
                <button
                  type="button"
                  className="rv-history__item"
                  data-testid={`revision-history-${r.revision}`}
                  aria-current={current ? 'true' : undefined}
                  disabled={revisionPending}
                  onClick={() => {
                    if (!current) onSelectRevision(r.revision);
                  }}
                >
                  <span style={{ minWidth: 0 }}>
                    <strong>Revision {r.revision}</strong>
                    {r.revision === latestRevision ? ' · latest' : ''}
                    {r.label || r.title ? (
                      <span className="rv-hint" style={{ display: 'block', overflowWrap: 'anywhere' }}>
                        {r.label ?? r.title}
                      </span>
                    ) : null}
                  </span>
                  {r.status ? (
                    <span className={`rv-badge rv-badge--${STATUS_TONE[r.status] ?? 'warn'}`}>
                      {PLAN_STATUS_LABEL[r.status].replace(' (implemented checks passed)', '')}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ol>
        {revisionPending ? <p className="rv-hint">Loading revision…</p> : null}
        {!revisionPending && latestRevision !== undefined && plan.revision !== latestRevision ? (
          <p className="rv-hint" data-testid="revision-state" style={{ color: 'var(--rv-warn-text)' }}>
            Viewing an older revision; latest is {latestRevision}.
          </p>
        ) : null}
        {revisionError ? (
          <p role="alert" data-testid="revision-error" className="rv-callout rv-callout--bad">
            {revisionError}
          </p>
        ) : null}
      </section>

      <details open aria-label="Placed components" data-testid="component-tree" className="rv-section">
        <summary className="rv-section__title">Parts ({plan.components.length})</summary>
        {selection.state.hidden_instance_ids.size > 0 ? (
          <button
            type="button"
            onClick={() => selection.showAll()}
            data-testid="tree-show-all"
            className="rv-btn rv-btn--ghost rv-btn--small"
            style={{ alignSelf: 'flex-start', color: 'var(--rv-accent-text)' }}
          >
            Show all ({selection.state.hidden_instance_ids.size} hidden)
          </button>
        ) : null}
        <ul className="rv-tree">
          {plan.components.map((comp) => {
            const cat = catalogById.get(comp.catalog_id);
            const visual = selection.getVisualState(comp.instance_id);
            const isSelected = selection.selectedInstanceId === comp.instance_id;
            const isIsolated = selection.state.isolated_instance_id === comp.instance_id;
            const name = cat?.identity.model ?? comp.catalog_id;
            return (
              <li
                key={comp.instance_id}
                data-testid={`tree-item-${comp.instance_id}`}
                className="rv-tree-row"
                data-selected={isSelected}
                data-hidden={visual.hidden}
                data-isolated={isIsolated}
              >
                <button
                  type="button"
                  data-testid={`tree-select-${comp.instance_id}`}
                  className="rv-tree-row__select"
                  aria-pressed={isSelected}
                  onClick={() => selection.select(comp.instance_id, { reason: 'api', reveal: true })}
                >
                  <span className="rv-tree-row__name">{name}</span>
                  <span className="rv-mono">
                    {comp.instance_id}
                    {comp.render_overrides?.visible === false ? ' · unmodeled kit item' : ''}
                  </span>
                </button>
                <div className="rv-tree-row__actions">
                  <button
                    type="button"
                    className="rv-btn rv-btn--small"
                    data-testid={`tree-isolate-${comp.instance_id}`}
                    title={isIsolated ? 'Show all parts' : `Show only ${name}`}
                    aria-label={isIsolated ? 'Show all parts' : `Show only ${name}`}
                    aria-pressed={isIsolated}
                    onClick={() => (isIsolated ? selection.exitIsolation() : selection.isolate(comp.instance_id))}
                  >
                    {isIsolated ? 'All' : 'Solo'}
                  </button>
                  <button
                    type="button"
                    className="rv-btn rv-btn--small"
                    data-testid={`tree-hide-${comp.instance_id}`}
                    title={visual.hidden ? `Show ${name}` : `Hide ${name}`}
                    aria-label={visual.hidden ? `Show ${name}` : `Hide ${name}`}
                    aria-pressed={visual.hidden}
                    onClick={() => selection.toggleHidden(comp.instance_id)}
                  >
                    {visual.hidden ? 'Show' : 'Hide'}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </details>
    </div>
  );
}
