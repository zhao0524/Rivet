'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import type { BuildPlan, EditOperation } from '../../lib/rivet/types';
import '../../styles/phase2.css';
import { useProjectContext } from '../flow/ProjectShell';
import { Modal } from '../system/Modal';

interface Preset {
  id: string;
  label: string;
  instruction: string;
  operation: EditOperation;
}

/**
 * Changes the engine can apply directly. The API maps free text to an operation only when an
 * edit selector is configured, so these presets send one of its five allowed operations.
 * A preset is offered only when the build has the part it touches.
 */
function presetsFor(plan: BuildPlan): Preset[] {
  const byRole = (re: RegExp) => plan.components.find((c) => re.test(c.role))?.instance_id;
  const sensor = byRole(/sensor/i);
  const chassis = byRole(/chassis|frame/i);
  const list: Preset[] = [
    {
      id: 'stop-distance',
      label: 'Stop at 0.40 m from walls',
      instruction: 'Increase obstacle stop distance to 0.40 m',
      operation: { op: 'set_behavior_parameter', name: 'obstacle_stop_distance_m', value: 0.4 },
    },
  ];
  if (sensor) {
    list.push({
      id: 'sensor-higher',
      label: 'Move the sensor 12 mm higher',
      instruction: 'Move the front sensor 12 mm higher',
      operation: { op: 'set_mount_offset_within_template', instance_id: sensor, offset_mm: [0, 12, 0] },
    });
  }
  if (chassis) {
    list.push({
      id: 'tint-blue',
      label: 'Tint the chassis blue',
      instruction: 'Tint the chassis blue',
      operation: { op: 'change_appearance_color', instance_id: chassis, color: '#2563EB' },
    });
  }
  return list;
}

/**
 * Iterate: one textarea, "Apply change" sends it to the engine. An accepted edit bumps the project
 * revision and lands on Review; a refusal (always, offline) shows the engine's reason and keeps the text.
 */
export function IterateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { update, build, goTo } = useProjectContext();
  const { store, ready } = build;
  const [text, setText] = useState('');
  const [preset, setPreset] = useState<Preset | null>(null);
  const presets = useMemo(() => (ready ? presetsFor(store.plan) : []), [ready, store.plan]);
  const [reason, setReason] = useState<string | null>(null);
  const fieldId = useId();
  const pending = store.editPending;

  // A fresh open starts without a stale refusal; the text itself is kept while the modal stays open.
  useEffect(() => {
    if (open) setReason(null);
  }, [open]);

  function discard() {
    setText('');
    setPreset(null);
    setReason(null);
    onClose();
  }

  async function apply() {
    const instruction = text.trim();
    if (!instruction || pending || !ready) return;
    setReason(null);
    // A preset sends its operation only while its wording is unchanged.
    const operation = preset && preset.instruction === instruction ? preset.operation : undefined;
    const res = await store.submitEdit(instruction, operation);
    if (!res) return; // store.editError carries the failure
    if (res.accepted && typeof res.revision === 'number') {
      update({ revision: res.revision, reviewDone: false });
      setText('');
      setPreset(null);
      onClose();
      goTo('review');
      return;
    }
    setReason(res.finding?.message ?? 'The engine did not accept this change and gave no reason.');
  }

  const canApply = text.trim().length > 0 && !pending && ready;

  return (
    <Modal
      open={open}
      onClose={discard}
      title="Change something"
      description="Pick a change Rivet can apply directly, or describe one. Rivet re-checks the whole build, then you review it again."
      testId="iterate"
      initialFocus="textarea"
      footer={
        <>
          <button type="button" className="ui-btn ui-btn--secondary" onClick={discard} disabled={pending} data-testid="iterate-discard">
            Discard
          </button>
          <button type="button" className="ui-btn ui-btn--primary" onClick={() => void apply()} disabled={!canApply} aria-busy={pending || undefined} data-testid="iterate-apply">
            {pending ? <span className="ui-spinner" aria-hidden="true" style={{ borderTopColor: 'var(--ui-on-accent)' }} /> : null}
            {pending ? 'Applying' : 'Apply change'}
          </button>
        </>
      }
    >
      <div className="ui-field">
        <label className="ui-label" htmlFor={fieldId}>
          What do you want to change?
        </label>
        <textarea
          id={fieldId}
          className="ui-textarea"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (preset && e.target.value.trim() !== preset.instruction) setPreset(null);
          }}
          placeholder="e.g. Swap the range sensor for a wider one"
          disabled={pending}
          data-testid="iterate-text"
        />
      </div>
      <div className="p2-chips iter__chips" role="group" aria-label="Changes Rivet can apply directly">
        {presets.map((p) => (
          <button
            key={p.id}
            type="button"
            className="ui-chip"
            aria-pressed={preset?.id === p.id}
            onClick={() => {
              setPreset(p);
              setText(p.instruction);
              setReason(null);
            }}
            data-testid="iterate-example"
            data-preset={p.id}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div aria-live="polite" style={{ marginTop: 12 }}>
        {!ready ? <p className="ui-notice">The build is still loading; apply once it is ready.</p> : null}
        {reason ? (
          <p className="ui-notice ui-notice--warn" data-testid="iterate-reason">
            {reason}
          </p>
        ) : null}
        {store.editError && !preset ? (
          <p className="ui-small ui-muted" data-testid="iterate-hint">
            Free-text changes need the engine&apos;s edit assistant. Try one of the changes above.
          </p>
        ) : null}
        {store.editError ? (
          <p className="ui-notice ui-notice--danger" data-testid="iterate-error">
            {store.editError}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
