'use client';

import { useEffect, useId, useState } from 'react';
import '../../styles/phase2.css';
import { useProjectContext } from '../flow/ProjectShell';
import { Modal } from '../system/Modal';

const EXAMPLES = ['Make it cheaper', 'Move the sensor higher', 'Use a bigger battery'] as const;

/**
 * Iterate: one textarea, "Apply change" sends it to the engine. An accepted edit bumps the project
 * revision and lands on Review; a refusal (always, offline) shows the engine's reason and keeps the text.
 */
export function IterateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { update, build, goTo } = useProjectContext();
  const { store, ready } = build;
  const [text, setText] = useState('');
  const [reason, setReason] = useState<string | null>(null);
  const fieldId = useId();
  const pending = store.editPending;

  // A fresh open starts without a stale refusal; the text itself is kept while the modal stays open.
  useEffect(() => {
    if (open) setReason(null);
  }, [open]);

  function discard() {
    setText('');
    setReason(null);
    onClose();
  }

  async function apply() {
    const instruction = text.trim();
    if (!instruction || pending || !ready) return;
    setReason(null);
    const res = await store.submitEdit(instruction);
    if (!res) return; // store.editError carries the failure
    if (res.accepted && typeof res.revision === 'number') {
      update({ revision: res.revision, reviewDone: false });
      setText('');
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
      description="Describe the change in plain words. Rivet re-plans and re-checks the whole build, then you review it again."
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
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. Swap the range sensor for a wider one"
          disabled={pending}
          data-testid="iterate-text"
        />
      </div>
      <div className="p2-chips iter__chips" aria-label="Examples">
        {EXAMPLES.map((ex) => (
          <button key={ex} type="button" className="ui-chip" onClick={() => setText(ex)} data-testid="iterate-example">
            {ex}
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
        {store.editError ? (
          <p className="ui-notice ui-notice--danger" data-testid="iterate-error">
            {store.editError}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
