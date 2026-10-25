'use client';

import { useEffect, useState } from 'react';
import type { ProjectRecord } from '../../lib/flow/projects';
import { Modal } from '../system/Modal';

/**
 * Save and publish: the build goes into the community gallery under a title you choose. (Accounts are
 * not live yet, so the gallery is this browser's.)
 */
export function PublishModal({
  open,
  project,
  onClose,
  onPublish,
  onUnpublish,
}: {
  open: boolean;
  project: ProjectRecord;
  onClose: () => void;
  onPublish: (title: string) => void | Promise<void>;
  onUnpublish: () => void | Promise<void>;
}) {
  const [title, setTitle] = useState(project.title);
  const [busy, setBusy] = useState(false);
  const published = Boolean(project.publishedAt);

  useEffect(() => {
    if (open) {
      setTitle(project.title);
      setBusy(false);
    }
  }, [open, project.title]);

  async function run(action: () => void | Promise<void>) {
    setBusy(true);
    await action();
    setBusy(false);
  }

  const name = title.trim();
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={published ? 'Update your published build' : 'Save and publish this build'}
      description="Published builds show in the community gallery, so others can open them and build their own."
      testId="publish-modal"
      initialFocus="input"
      footer={
        <>
          {published ? (
            <button type="button" className="ui-btn ui-btn--secondary" onClick={() => void run(onUnpublish)} disabled={busy} data-testid="publish-remove">
              Unpublish
            </button>
          ) : (
            <button type="button" className="ui-btn ui-btn--secondary" onClick={onClose} disabled={busy}>
              Cancel
            </button>
          )}
          <button
            type="button"
            className="ui-btn ui-btn--primary"
            onClick={() => void run(() => onPublish(name))}
            disabled={busy || !name}
            data-testid="publish-confirm"
          >
            {published ? 'Save changes' : 'Save and publish'}
          </button>
        </>
      }
    >
      <div className="ui-field">
        <label className="ui-label" htmlFor="publish-title">
          Title in the gallery
        </label>
        <input
          id="publish-title"
          className="ui-input"
          value={title}
          maxLength={80}
          onChange={(e) => setTitle(e.target.value)}
          data-testid="publish-title"
        />
      </div>
    </Modal>
  );
}
