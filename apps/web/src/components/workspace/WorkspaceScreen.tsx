'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { handleFromAccount } from '../../lib/flow/community';
import { formatMoney } from '../../lib/flow/derive';
import { readAccount } from '../../lib/flow/projects';
import { isConceptPlan, summarizeBom } from '../../lib/rivet/honesty';
import { useProjectContext } from '../flow/ProjectShell';
import { Icon } from '../system/Icon';
import { usePartSelection } from '../three/interactions';
import { Chat } from './Chat';
import { LeftPanel, type LeftTab } from './LeftPanel';
import { PublishModal } from './PublishModal';
import { SaveIndicator } from './SaveIndicator';
import { useWorkspaceSession } from './session';
import { useAutosave } from './useAutosave';
import { DEFAULT_VIEW, Stage, type StageView } from './Stage';
import '../../styles/workspace.css';

type Pane = 'files' | 'model' | 'chat';

/**
 * The generated prototype's home: the build guide and parts on the left, the model in 3D in the middle,
 * Rivet's chat on the right. A new prompt lands here straight away; the model shows a loading state
 * until the first build is in. Dark first (light comes later), so the page sets its own theme.
 */
export function WorkspaceScreen() {
  const { project, update, build } = useProjectContext();
  const session = useWorkspaceSession();
  const store = build.store;
  // A demo photo's model stays hidden until the chat has finished the engineering pass.
  const plan = build.ready && session.paceStartedAt == null ? store.plan : null;
  const [view, setView] = useState<StageView>(DEFAULT_VIEW);
  const [pane, setPane] = useState<Pane>('model');
  const [tab, setTab] = useState<LeftTab>('build');
  const viewRef = useRef(view);
  viewRef.current = view;
  // In the exploded view, clicking a part opens it in the Parts tab (which picks and scrolls to it).
  const selection = usePartSelection(plan, {
    escapeToClear: true,
    onSelectionChange: (e) => {
      if (e.reason === 'pointer' && e.instance_id && viewRef.current.mode === 'exploded') setTab('parts');
    },
  });
  const fixture = store.dataSource.mode === 'fixture';
  const events = session.liveRun !== null ? store.jobEvents : [];
  const concept = plan ? isConceptPlan(plan) : false;
  const autosave = useAutosave(project);
  const [publishing, setPublishing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const ready = session.status === 'ready';

  // Only what changes what you can do: building, stopped, or a model that is appearance only.
  const badge = useMemo(() => {
    if (session.status === 'reading' || session.status === 'generating') return { text: 'Building', tone: 'busy' };
    if (session.status === 'failed') return { text: 'Stopped', tone: 'danger' };
    if (session.status === 'loading') return { text: 'Opening', tone: 'busy' };
    if (concept && !(project.demoKey && project.imageAssetId && !fixture)) return { text: 'Concept model', tone: 'quiet' };
    return null;
  }, [session.status, concept, project.demoKey, project.imageAssetId, fixture]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(t);
  }, [toast]);

  return (
    <div className="ws" data-pane={pane} data-testid="workspace">
      <header className="ws-bar">
        <div className="ws-bar__left">
          <Link href="/" className="ws-logo" aria-label="Rivet home">
            <span className="logo__mark" aria-hidden="true" />
          </Link>
          <nav className="ws-crumbs" aria-label="Breadcrumb">
            <Link href="/projects" className="ws-crumbs__link" data-testid="nav-projects">
              Projects
            </Link>
            <span className="ws-crumbs__sep" aria-hidden="true">
              /
            </span>
            <span className="ws-crumbs__here" data-testid="project-title">
              {project.title}
            </span>
          </nav>
          {badge ? (
            <span className="ws-pill" data-tone={badge.tone} data-testid="workspace-status">
              {badge.tone === 'busy' ? <span className="ws-pill__dot" aria-hidden="true" /> : null}
              {badge.text}
            </span>
          ) : null}
        </div>
        <div className="ws-bar__right">
          <SaveIndicator saving={autosave.saving} savedAt={autosave.savedAt} />
          <Link href="/new" className="ws-btn ws-btn--ghost ws-btn--sm" data-testid="workspace-new" aria-label="New project">
            <Icon name="plus" size={14} />
          </Link>
          <button
            type="button"
            className="ws-btn ws-btn--sm"
            onClick={() => {
              void autosave.save();
              setToast('Build saved.');
            }}
            disabled={autosave.saving}
            data-testid="workspace-save"
          >
            Save build
          </button>
          <button
            type="button"
            className="ws-btn ws-btn--primary ws-btn--sm"
            onClick={() => setPublishing(true)}
            disabled={!ready}
            data-testid="workspace-publish"
          >
            <span className="ws-hide-sm">{project.publishedAt ? 'Published' : 'Save and publish'}</span>
            <span className="ws-show-sm">Publish</span>
          </button>
        </div>
      </header>

      <div className="ws-body">
        <aside className="ws-col ws-col--left" aria-label="Build guide and parts">
          <LeftPanel
            tab={tab}
            onTab={setTab}
            project={project}
            update={update}
            plan={plan}
            catalog={store.catalog}
            status={session.status}
            selection={selection}
            onStep={(step) => {
              setView((v) => ({ ...v, mode: 'step', step }));
              setPane('model');
            }}
          />
        </aside>
        <section className="ws-col ws-col--stage" aria-label="3D model">
          <Stage
            plan={plan}
            catalog={store.catalog}
            status={session.status}
            stageText={session.stageText}
            errorMessage={session.errorMessage}
            selection={selection}
            view={view}
            onView={setView}
            onRetry={session.retry}
            retryLabel={session.reread ? 'Read it again' : 'Try again'}
          />
        </section>
        <aside className="ws-col ws-col--right" aria-label="Chat with Rivet">
          <Chat project={project} session={session} plan={plan} events={events} fixture={fixture} />
        </aside>
      </div>

      <nav className="ws-tabs" aria-label="Workspace panels">
        {(
          [
            ['files', 'Guide', 'folder'],
            ['model', 'Model', 'cube'],
            ['chat', 'Chat', 'sparkle'],
          ] as const
        ).map(([id, label, icon]) => (
          <button key={id} type="button" className="ws-tabs__item" aria-pressed={pane === id} onClick={() => setPane(id)} data-testid={`workspace-tab-${id}`}>
            <Icon name={icon} size={16} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <div className="ws-toast-slot" role="status" aria-live="polite">
        {toast ? (
          <div className="ws-toast" data-testid="workspace-toast">
            <Icon name="check" size={14} />
            <span>{toast}</span>
          </div>
        ) : null}
      </div>

      <PublishModal
        open={publishing}
        project={project}
        onClose={() => setPublishing(false)}
        onPublish={async (title) => {
          // The gallery shows what it costs and who made it, as of publishing.
          const bom = plan ? summarizeBom(plan) : null;
          const subtotal = bom?.knownSubtotal != null ? Number(bom.knownSubtotal) : NaN;
          await autosave.save({
            title,
            publishedAt: project.publishedAt ?? new Date().toISOString(),
            publishedPrice: bom && Number.isFinite(subtotal) ? formatMoney(subtotal, bom.currency) : null,
            publishedBy: handleFromAccount(readAccount()?.email),
          });
          setPublishing(false);
          setToast('Saved and published to the community gallery.');
        }}
        onUnpublish={async () => {
          await autosave.save({ publishedAt: null });
          setPublishing(false);
          setToast('Removed from the community gallery. Your build is still saved.');
        }}
      />
    </div>
  );
}
