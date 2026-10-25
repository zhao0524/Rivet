'use client';

import { useState } from 'react';
import { Modal } from '../../system/Modal';
import type { StepPart } from './build-model';

export interface MissingPartModalProps {
  open: boolean;
  onClose: () => void;
  parts: readonly StepPart[];
  /** instance_id → everyday nickname ("left motor"), shown under each name. */
  nicknames?: ReadonlyMap<string, string>;
  alreadyMissing: readonly string[];
  onMark: (catalogId: string) => void;
}

/** Pick one part from the current step to mark as missing. The note lands on the step; buying stays in Buy. */
export function MissingPartModal({ open, onClose, parts, nicknames, alreadyMissing, onMark }: MissingPartModalProps) {
  const [choice, setChoice] = useState<string | null>(null);
  const options = parts.filter((p) => !alreadyMissing.includes(p.catalogId));
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Mark a part missing"
      description="Pick the part you don't have. It stays on this step as a note, and you can order it from Buy."
      testId="build-missing"
      footer={
        <button
          type="button"
          className="ui-btn ui-btn--primary"
          disabled={!choice}
          onClick={() => {
            if (!choice) return;
            onMark(choice);
            setChoice(null);
            onClose();
          }}
          data-testid="build-missing-confirm"
        >
          Mark missing
        </button>
      }
    >
      {options.length === 0 ? (
        <p className="ui-muted">Every part in this step is already marked missing.</p>
      ) : (
        <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
          <legend className="ui-sr-only">Part to mark missing</legend>
          {options.map((p) => (
            <label key={p.instanceId} className="build__radio">
              <input type="radio" name="missing-part" value={p.catalogId} checked={choice === p.catalogId} onChange={() => setChoice(p.catalogId)} data-testid={`build-missing-${p.instanceId}`} />
              <span className="list__main">
                <span className="list__title">{p.name}</span>
                <span className="list__meta">{nicknames?.get(p.instanceId) ?? p.role.replace(/_/g, ' ')}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
    </Modal>
  );
}
