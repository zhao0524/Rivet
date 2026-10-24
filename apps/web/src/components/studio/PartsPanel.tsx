'use client';

import { useState, type FormEvent } from 'react';
import type {
  BuildPlan,
  CatalogComponent,
  EditOperation,
  EditResponse,
  RevisionSummary,
} from '../../lib/rivet/types';
import { ProjectRevisionPicker } from './panels';
import type { PartSelectionApi } from '../three/interactions';

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
}

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
}: PartsPanelProps) {
  const catalogById = new Map(catalog.map((c) => [c.catalog_id, c]));

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

  return (
    <div data-testid="parts-panel" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* New Build / Upload Trigger */}
      {onOpenIntake ? (
        <button
          type="button"
          data-testid="open-intake-button"
          onClick={onOpenIntake}
          style={{
            background: '#2563eb',
            color: '#ffffff',
            border: '1px solid #3b82f6',
            borderRadius: 6,
            padding: '8px 12px',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            textAlign: 'center',
          }}
        >
          + Upload image / New build
        </button>
      ) : null}

      {/* Project Revision Switcher (work_(9)) */}
      <div
        style={{
          background: '#141821',
          border: '1px solid #222938',
          borderRadius: 8,
          padding: 10,
        }}
      >
        <ProjectRevisionPicker
          buildId={plan.build_id}
          revisions={revisions}
          currentRevision={plan.revision}
          onSelectRevision={onSelectRevision}
          pending={revisionPending}
          error={revisionError}
        />
      </div>

      {/* Component Hierarchy & Visibility List */}
      <section
        aria-label="Placed components"
        data-testid="component-tree"
        style={{
          background: '#141821',
          border: '1px solid #222938',
          borderRadius: 8,
          padding: 10,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 8,
          }}
        >
          <h2 style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>
            Components ({plan.components.length})
          </h2>
          {selection.state.hidden_instance_ids.size > 0 && (
            <button
              type="button"
              onClick={() => selection.showAll()}
              data-testid="tree-show-all"
              style={{
                background: 'transparent',
                color: '#60a5fa',
                border: 'none',
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              Unhide all ({selection.state.hidden_instance_ids.size})
            </button>
          )}
        </div>

        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
          {plan.components.map((comp) => {
            const cat = catalogById.get(comp.catalog_id);
            const visual = selection.getVisualState(comp.instance_id);
            const isSelected = selection.selectedInstanceId === comp.instance_id;
            const isIsolated = selection.state.isolated_instance_id === comp.instance_id;
            return (
              <li
                key={comp.instance_id}
                data-testid={`tree-item-${comp.instance_id}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 6,
                  padding: '5px 7px',
                  borderRadius: 6,
                  background: isSelected ? '#1e3a8a' : '#10141c',
                  border: isSelected ? '1px solid #3b82f6' : '1px solid #1e2430',
                  opacity: visual.hidden ? 0.5 : 1,
                }}
              >
                <button
                  type="button"
                  data-testid={`tree-select-${comp.instance_id}`}
                  onClick={() => selection.select(comp.instance_id, { reason: 'api', reveal: true })}
                  style={{
                    flex: 1,
                    background: 'transparent',
                    border: 'none',
                    color: '#e2e8f0',
                    textAlign: 'left',
                    cursor: 'pointer',
                    padding: 0,
                    fontSize: 12,
                  }}
                >
                  <div style={{ fontWeight: 500 }}>
                    {cat?.identity.model ?? comp.catalog_id}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: '#94a3b8',
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    }}
                  >
                    {comp.instance_id} · {comp.role}
                  </div>
                </button>

                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    type="button"
                    data-testid={`tree-isolate-${comp.instance_id}`}
                    title={isIsolated ? 'Exit isolation' : `Isolate ${comp.instance_id}`}
                    aria-pressed={isIsolated}
                    onClick={() =>
                      isIsolated ? selection.exitIsolation() : selection.isolate(comp.instance_id)
                    }
                    style={{
                      background: isIsolated ? '#2563eb' : '#1a202c',
                      color: '#cbd5e1',
                      border: '1px solid #2d3748',
                      borderRadius: 4,
                      padding: '2px 6px',
                      fontSize: 10,
                      cursor: 'pointer',
                    }}
                  >
                    {isIsolated ? 'All' : 'Solo'}
                  </button>
                  <button
                    type="button"
                    data-testid={`tree-hide-${comp.instance_id}`}
                    title={visual.hidden ? `Show ${comp.instance_id}` : `Hide ${comp.instance_id}`}
                    aria-pressed={visual.hidden}
                    onClick={() => selection.toggleHidden(comp.instance_id)}
                    style={{
                      background: visual.hidden ? '#374151' : '#1a202c',
                      color: '#cbd5e1',
                      border: '1px solid #2d3748',
                      borderRadius: 4,
                      padding: '2px 6px',
                      fontSize: 10,
                      cursor: 'pointer',
                    }}
                  >
                    {visual.hidden ? 'Show' : 'Hide'}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Declarative Design Edits (project.md §2 / implementation.md A3) */}
      <section
        aria-label="Design revision edits"
        data-testid="design-edit-panel"
        style={{
          background: '#141821',
          border: '1px solid #222938',
          borderRadius: 8,
          padding: 10,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <h2 style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>Propose design edit</h2>
        <p style={{ fontSize: 11, color: '#94a3b8', margin: 0 }}>
          Edits run through the backend validator and create a new immutable revision if accepted.
        </p>

        {/* Quick Demo Presets */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          <button
            type="button"
            data-testid="preset-edit-sensor-higher"
            disabled={editPending}
            onClick={() => {
              setOpKind('set_mount_offset_within_template');
              setInstruction('Make it cheaper and move the sensor higher');
              setOffsetY('12');
              void onSubmitEdit('Make it cheaper and move the sensor higher', {
                op: 'set_mount_offset_within_template',
                instance_id: 'sensor-1',
                offset_mm: [0, 12, 0],
              });
            }}
            style={{
              background: '#1e293b',
              color: '#e2e8f0',
              border: '1px solid #334155',
              borderRadius: 5,
              padding: '4px 8px',
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            Move sensor +12 mm higher
          </button>
          <button
            type="button"
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
            style={{
              background: '#1e293b',
              color: '#e2e8f0',
              border: '1px solid #334155',
              borderRadius: 5,
              padding: '4px 8px',
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            Stop distance → 0.40 m
          </button>
          <button
            type="button"
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
            style={{
              background: '#1e293b',
              color: '#e2e8f0',
              border: '1px solid #334155',
              borderRadius: 5,
              padding: '4px 8px',
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            Tint cobalt (#2563EB)
          </button>
        </div>

        <form onSubmit={handleEditSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <label style={{ fontSize: 11, color: '#cbd5e1', display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span>Operation type</span>
            <select
              data-testid="edit-operation-select"
              value={opKind}
              onChange={(e) => setOpKind(e.target.value as EditOpKind)}
              style={{
                background: '#0f131a',
                color: '#f1f5f9',
                border: '1px solid #2d3748',
                borderRadius: 5,
                padding: '4px 6px',
                fontSize: 12,
              }}
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
                style={{
                  background: '#0f131a',
                  color: '#f1f5f9',
                  border: '1px solid #2d3748',
                  borderRadius: 5,
                  padding: '4px 6px',
                  fontSize: 12,
                }}
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
                style={{
                  background: '#0f131a',
                  color: '#f1f5f9',
                  border: '1px solid #2d3748',
                  borderRadius: 5,
                  padding: '4px 6px',
                  fontSize: 12,
                }}
              />
            </div>
          )}

          {opKind === 'change_appearance_color' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 70px', gap: 6 }}>
              <select
                data-testid="edit-color-instance"
                value={selection.selectedInstanceId ?? targetInstanceId}
                onChange={(e) => setTargetInstanceId(e.target.value)}
                style={{
                  background: '#0f131a',
                  color: '#f1f5f9',
                  border: '1px solid #2d3748',
                  borderRadius: 5,
                  padding: '4px 6px',
                  fontSize: 12,
                }}
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
                style={{
                  background: '#0f131a',
                  color: '#f1f5f9',
                  border: '1px solid #2d3748',
                  borderRadius: 5,
                  padding: '4px 6px',
                  fontSize: 12,
                }}
              />
            </div>
          )}

          {opKind === 'set_mount_offset_within_template' && (
            <label style={{ fontSize: 11, color: '#cbd5e1', display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span>Vertical offset Y (mm) on {selection.selectedInstanceId ?? 'sensor-1'}</span>
              <input
                type="number"
                step="1"
                data-testid="edit-mount-offset-y"
                value={offsetY}
                onChange={(e) => setOffsetY(e.target.value)}
                style={{
                  background: '#0f131a',
                  color: '#f1f5f9',
                  border: '1px solid #2d3748',
                  borderRadius: 5,
                  padding: '4px 6px',
                  fontSize: 12,
                }}
              />
            </label>
          )}

          {opKind === 'set_budget' && (
            <label style={{ fontSize: 11, color: '#cbd5e1', display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span>Max budget ({plan.bom.currency || 'USD'})</span>
              <input
                type="text"
                data-testid="edit-budget-amount"
                value={budgetAmount}
                onChange={(e) => setBudgetAmount(e.target.value)}
                style={{
                  background: '#0f131a',
                  color: '#f1f5f9',
                  border: '1px solid #2d3748',
                  borderRadius: 5,
                  padding: '4px 6px',
                  fontSize: 12,
                }}
              />
            </label>
          )}

          {opKind === 'replace_optional_sensor' && (
            <label style={{ fontSize: 11, color: '#cbd5e1', display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span>Replacement sensor catalog ID</span>
              <input
                type="text"
                data-testid="edit-sensor-catalog-id"
                value={sensorCatalogId}
                onChange={(e) => setSensorCatalogId(e.target.value)}
                style={{
                  background: '#0f131a',
                  color: '#f1f5f9',
                  border: '1px solid #2d3748',
                  borderRadius: 5,
                  padding: '4px 6px',
                  fontSize: 12,
                }}
              />
            </label>
          )}

          <label style={{ fontSize: 11, color: '#cbd5e1', display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span>Instruction note</span>
            <input
              type="text"
              data-testid="edit-instruction-input"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              style={{
                background: '#0f131a',
                color: '#f1f5f9',
                border: '1px solid #2d3748',
                borderRadius: 5,
                padding: '4px 6px',
                fontSize: 12,
              }}
            />
          </label>

          <button
            type="submit"
            data-testid="edit-submit-button"
            disabled={editPending}
            style={{
              background: '#1d4ed8',
              color: '#ffffff',
              border: '1px solid #3b82f6',
              borderRadius: 5,
              padding: '6px 10px',
              fontSize: 12,
              fontWeight: 600,
              cursor: editPending ? 'not-allowed' : 'pointer',
            }}
          >
            {editPending ? 'Validating edit…' : `Apply edit to r${plan.revision}`}
          </button>
        </form>

        {lastEditResponse && (
          <div
            role="status"
            data-testid="edit-outcome-banner"
            data-accepted={lastEditResponse.accepted ? 'true' : 'false'}
            style={{
              padding: '7px 9px',
              borderRadius: 6,
              fontSize: 11,
              background: lastEditResponse.accepted ? '#064e3b' : '#3f2e1e',
              border: lastEditResponse.accepted ? '1px solid #10b981' : '1px solid #f59e0b',
              color: '#f8fafc',
            }}
          >
            {lastEditResponse.accepted ? (
              <span>
                Edit accepted → created immutable revision <strong>r{lastEditResponse.revision}</strong>.
              </span>
            ) : (
              <div>
                <strong>Edit not applied (revision r{plan.revision} preserved):</strong>{' '}
                {lastEditResponse.finding?.message ?? 'Rejected by validator.'}
              </div>
            )}
          </div>
        )}

        {editError && (
          <div
            role="alert"
            data-testid="edit-error-banner"
            style={{
              padding: '7px 9px',
              borderRadius: 6,
              fontSize: 11,
              background: '#450a0a',
              border: '1px solid #ef4444',
              color: '#fecaca',
            }}
          >
            {editError}
          </div>
        )}
      </section>
    </div>
  );
}
