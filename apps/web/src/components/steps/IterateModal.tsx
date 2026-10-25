'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import type { BuildPlan, EditOperation } from '../../lib/rivet/types';
import '../../styles/phase2.css';
import { useProjectContext } from '../flow/ProjectShell';
import { Modal } from '../system/Modal';
import { Thinking, formatElapsed, type ThinkingStep } from '../system/Thinking';

/** What happened to the last change sent: real outcome only, timed from send to answer. */
interface Trace {
  running: boolean;
  steps: ThinkingStep[];
  ms: number | null;
}

/** Engine text with ids turned into words (`set_behavior_parameter` → "set behavior parameter"). */
function plainEngineText(message: string): string {
  return message.replace(/\b[a-z][a-z0-9]*(?:[._][a-z][a-z0-9]+)+\b/gi, (m) => m.replace(/^[a-z]+\./, '').replace(/[_.]+/g, ' '));
}

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
  const [trace, setTrace] = useState<Trace | null>(null);
  const offline = store.dataSource.mode === 'fixture';
  const fieldId = useId();
  const pending = store.editPending;

  // A fresh open starts without a stale refusal; the text itself is kept while the modal stays open.
  useEffect(() => {
    if (open) {
      setReason(null);
      setTrace(null);
    }
  }, [open]);

  function discard() {
    setText('');
    setPreset(null);
    setReason(null);
    setTrace(null);
    onClose();
  }

  async function apply() {
    const instruction = text.trim();
    if (!instruction || pending || !ready) return;
    setReason(null);
    setTrace({ running: true, steps: [], ms: null });
    const t0 = performance.now();
    // A preset sends its operation only while its wording is unchanged.
    const operation = preset && preset.instruction === instruction ? preset.operation : undefined;
    const res = await store.submitEdit(instruction, operation);
    const ms = performance.now() - t0;
    if (!res) {
      // store.editError carries the failure.
      setTrace({ running: false, ms, steps: [{ id: 'answer', text: "The change didn't go through", detail: 'Rivet sent back an error, shown below.', status: 'failed' }] });
      return;
    }
    if (res.accepted && typeof res.revision === 'number') {
      setTrace({ running: false, ms, steps: [{ id: 'answer', text: 'Rivet made the change and re-checked the build', status: 'done' }] });
      update({ revision: res.revision, reviewDone: false });
      setText('');
      setPreset(null);
      onClose();
      goTo('review');
      return;
    }
    setTrace({
      running: false,
      ms,
      steps: [
        {
          id: 'answer',
          text: "Rivet didn't make this change",
          detail: offline ? "Rivet's live engine isn't connected, so nothing was re-checked." : 'Its reason is below.',
          status: 'warning',
        },
      ],
    });
    setReason(res.finding?.message ?? 'Rivet did not make this change and gave no reason.');
  }

  const canApply = text.trim().length > 0 && !pending && ready;

  return (
    <Modal
      open={open}
      onClose={discard}
      title="Change something"
      description="Pick a change Rivet can make for you, or describe your own. Rivet re-checks the whole build, then you look it over again."
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
          What would you like to change?
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
      <div className="p2-chips iter__chips" role="group" aria-label="Changes Rivet can make for you">
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
      {trace ? (
        <div style={{ marginTop: 14 }}>
          <Thinking
            title={offline ? 'Sending your change to Rivet' : 'Re-checking the whole build'}
            running={trace.running}
            steps={trace.steps}
            elapsedMs={trace.ms}
            doneLabel={trace.ms !== null ? `Answered in ${formatElapsed(trace.ms)}` : undefined}
            replayable={false}
            foldWhenDone={false}
            testId="iterate-thinking"
          />
        </div>
      ) : null}
      <div aria-live="polite" style={{ marginTop: 12 }}>
        {!ready ? <p className="ui-notice">The build is still loading. You can send a change once it&apos;s ready.</p> : null}
        {reason ? (
          <div className="ui-notice ui-notice--warn" style={{ display: 'grid', gap: 6 }} data-testid="iterate-reason">
            <span>
              {offline
                ? "Changes need Rivet's live engine, which isn't connected right now. Your text is kept so you can try again later."
                : plainEngineText(reason)}
            </span>
            <details className="ui-small">
              <summary style={{ cursor: 'pointer' }}>Details</summary>
              <span className="ui-muted" style={{ overflowWrap: 'anywhere' }}>{reason}</span>
            </details>
          </div>
        ) : null}
        {store.editError && !preset ? (
          <p className="ui-small ui-muted" data-testid="iterate-hint">
            Rivet only understands typed changes when its edit helper is connected. Try one of the changes above.
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
