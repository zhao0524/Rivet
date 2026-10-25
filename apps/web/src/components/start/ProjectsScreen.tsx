'use client';

import Link from 'next/link';
import { useAppRouter } from '../system/Navigation';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  createProjectRecord,
  deleteProject,
  duplicateProject,
  saveProject,
  updateProject,
  useProjects,
  type ProjectRecord,
} from '../../lib/flow/projects';
import { projectPath } from '../../lib/flow/steps';
import { AppHeader } from '../flow/AppHeader';
import { Icon } from '../system/Icon';
import { Modal } from '../system/Modal';
import { OverflowMenu } from '../system/OverflowMenu';
import { CardSkeletons, ProjectCard } from './gallery/ProjectCards';
import { EXAMPLE_PROJECT } from './shared';
import '../../styles/start.css';
import '../../styles/gallery.css';

/**
 * A0 Projects: every project saved in this browser, newest first, as the same Edge-light cards the
 * /new gallery uses. One primary CTA (New project); per card the only decisions are opening it and
 * its overflow (Rename, Duplicate, Delete).
 */
export function ProjectsScreen() {
  const router = useAppRouter();
  const projects = useProjects();
  const [mounted, setMounted] = useState(false);
  const [renaming, setRenaming] = useState<ProjectRecord | null>(null);
  const [deleting, setDeleting] = useState<ProjectRecord | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const sorted = useMemo(() => [...projects].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)), [projects]);

  // useSyncExternalStore returns the empty list on the server and the first client pass;
  // don't show the empty state until the stored list has been read.
  useEffect(() => {
    setMounted(true);
    setNow(Date.now());
  }, []);

  function openExample() {
    const record = saveProject(
      createProjectRecord({
        prompt: EXAMPLE_PROJECT.prompt,
        title: EXAMPLE_PROJECT.title,
        exampleId: EXAMPLE_PROJECT.exampleId,
        buildId: EXAMPLE_PROJECT.buildId,
        phase: 'ready',
        furthestStep: 'review',
      }),
    );
    router.push(projectPath(record.id));
  }

  return (
    <>
      <AppHeader />
      <main className="app-main" data-testid="projects-screen">
        <div className="start-head">
          <div className="start-head__text">
            <h1 className="ui-h1">Projects</h1>
            <p className="ui-lede">Saved in this browser. Open one to pick up where you left off.</p>
          </div>
          <Link href="/new" className="ui-btn ui-btn--primary ui-btn--lg" data-testid="projects-new">
            <Icon name="plus" />
            New project
          </Link>
        </div>

        {!mounted ? (
          <div className="gal__clip">
            <ul className="gal-grid" aria-busy="true" aria-label="Loading projects">
              <CardSkeletons count={4} />
            </ul>
          </div>
        ) : projects.length === 0 ? (
          <ul className="start-grid">
            <li className="ui-card pc pc--empty" data-testid="projects-empty">
              <span className="pc__art" aria-hidden="true">
                <Icon name="cube" size={24} />
              </span>
              <h2 className="ui-h2">No projects yet</h2>
              <p className="ui-muted" style={{ margin: 0, maxWidth: 400 }}>
                Describe a robot and Rivet designs it from real catalog parts, then walks you through buying and building it.
              </p>
              <Link href="/new" className="ui-btn ui-btn--primary ui-btn--lg" data-testid="projects-empty-new">
                New project
              </Link>
              <button type="button" className="ui-btn ui-btn--link" onClick={openExample} data-testid="projects-example">
                See an example
              </button>
            </li>
          </ul>
        ) : (
          <div className="gal__clip">
            <ul className="gal-grid" data-testid="projects-list">
              {sorted.map((p, i) => (
                <li key={p.id}>
                  <ProjectCard
                    project={p}
                    now={now}
                    index={i}
                    menu={
                      <OverflowMenu
                        label={`More actions for ${p.title}`}
                        testId={`projects-menu-${p.id}`}
                        items={[
                          { id: 'rename', label: 'Rename', onSelect: () => setRenaming(p), testId: 'projects-rename' },
                          { id: 'duplicate', label: 'Duplicate', onSelect: () => duplicateProject(p.id), testId: 'projects-duplicate' },
                          { id: 'delete', label: 'Delete', danger: true, onSelect: () => setDeleting(p), testId: 'projects-delete' },
                        ]}
                      />
                    }
                  />
                </li>
              ))}
            </ul>
          </div>
        )}
      </main>

      <RenameModal project={renaming} onClose={() => setRenaming(null)} />

      <Modal
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Delete this project?"
        description={deleting ? `“${deleting.title}” is removed from this browser. This can't be undone.` : undefined}
        testId="projects-delete-modal"
        initialFocus="[data-testid='projects-delete-cancel']"
        footer={
          <>
            <button type="button" className="ui-btn ui-btn--ghost" onClick={() => setDeleting(null)} data-testid="projects-delete-cancel">
              Cancel
            </button>
            <button
              type="button"
              className="ui-btn ui-btn--secondary start-danger-btn"
              data-testid="projects-delete-confirm"
              onClick={() => {
                if (deleting) deleteProject(deleting.id);
                setDeleting(null);
              }}
            >
              Delete
            </button>
          </>
        }
      />
    </>
  );
}

function RenameModal({ project, onClose }: { project: ProjectRecord | null; onClose: () => void }) {
  const [title, setTitle] = useState('');
  useEffect(() => {
    if (project) setTitle(project.title);
  }, [project]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const next = title.trim();
    if (project && next) updateProject(project.id, { title: next });
    onClose();
  }

  return (
    <Modal
      open={project !== null}
      onClose={onClose}
      title="Rename project"
      testId="projects-rename-modal"
      footer={
        <>
          <button type="button" className="ui-btn ui-btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="projects-rename-form" className="ui-btn ui-btn--primary" disabled={!title.trim()} data-testid="projects-rename-save">
            Save
          </button>
        </>
      }
    >
      <form id="projects-rename-form" onSubmit={submit} className="ui-field">
        <label htmlFor="projects-rename-input" className="ui-label">
          Title
        </label>
        <input
          id="projects-rename-input"
          className="ui-input"
          value={title}
          maxLength={120}
          onChange={(e) => setTitle(e.target.value)}
          data-testid="projects-rename-input"
        />
      </form>
    </Modal>
  );
}
