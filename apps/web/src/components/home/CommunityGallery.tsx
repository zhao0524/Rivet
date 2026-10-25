'use client';

import { useEffect, useMemo, useState } from 'react';
import { FEATURED_BUILDS, type FeaturedBuild } from '../../lib/flow/community';
import { formatMoney } from '../../lib/flow/derive';
import {
  createProjectRecord,
  duplicateProject,
  newId,
  publishedProjects,
  readAccount,
  saveAccount,
  saveProject,
  submitDraftProject,
  useProjects,
  type LocalAccount,
  type ProjectRecord,
} from '../../lib/flow/projects';
import { SAMPLE_PROJECTS, thumbnailFor, type SampleProject } from '../../lib/flow/samples';
import { projectPath } from '../../lib/flow/steps';
import { EDGE_GLOWS, EdgeLightCard } from '../start/gallery/EdgeLightCard';
import { Icon } from '../system/Icon';
import { Modal } from '../system/Modal';
import { useAppRouter } from '../system/Navigation';
import { SignInModal } from './HeroFlow';

/** At most two rows of three. */
const LIMIT = 6;

/** One card in the gallery: a build someone published here, or a featured sample. */
type Entry =
  | { kind: 'published'; id: string; title: string; image: string; creator: string; price: string | null; about: string; project: ProjectRecord }
  | { kind: 'featured'; id: string; title: string; image: string; creator: string; price: string; about: string; sample: SampleProject };

function featuredEntry(f: FeaturedBuild): Entry | null {
  const sample = SAMPLE_PROJECTS.find((s) => s.id === f.sampleId);
  if (!sample) return null;
  return {
    kind: 'featured',
    id: sample.id,
    title: sample.title,
    image: sample.thumbnail,
    creator: f.creator,
    price: `About ${formatMoney(f.estimatedCost, 'USD').replace(/\.00$/, '')}`,
    about: sample.description,
    sample,
  };
}

/**
 * Community section of the landing page: builds published with "Save and publish", newest first,
 * then featured samples to fill the grid. A card opens a preview over the page, with the build's
 * picture, price and creator, and two ways to use it.
 */
export function CommunityGallery() {
  const projects = useProjects();
  const [mounted, setMounted] = useState(false);
  const [picked, setPicked] = useState<Entry | null>(null);
  useEffect(() => setMounted(true), []);

  const entries = useMemo<Entry[]>(() => {
    const published: Entry[] = (mounted ? publishedProjects(projects) : []).slice(0, LIMIT).map((p) => ({
      kind: 'published',
      id: p.id,
      title: p.title,
      image: thumbnailFor(p),
      creator: p.publishedBy ?? 'you',
      price: p.publishedPrice ?? null,
      about: p.prompt,
      project: p,
    }));
    const featured = FEATURED_BUILDS.map(featuredEntry).filter((e): e is Entry => e !== null);
    return [...published, ...featured].slice(0, LIMIT);
  }, [mounted, projects]);

  return (
    <>
      <ul className="mk-community__grid" data-testid="home-community-list">
        {entries.map((e, i) => (
          <li key={e.id} data-kind={e.kind} data-testid={`home-community-${e.id}`}>
            <EdgeLightCard
              title={e.title}
              meta={`by @${e.creator}${e.price ? ` · ${e.price}` : ''}`}
              image={e.image}
              tag={e.kind === 'published' ? 'Published by you' : 'Featured'}
              label={`Preview ${e.title}`}
              onPress={() => setPicked(e)}
              glow={EDGE_GLOWS[i % EDGE_GLOWS.length]}
            />
          </li>
        ))}
      </ul>
      <BuildPreview entry={picked} onClose={() => setPicked(null)} />
    </>
  );
}

function BuildPreview({ entry, onClose }: { entry: Entry | null; onClose: () => void }) {
  const router = useAppRouter();
  const [saved, setSaved] = useState(false);
  const [signIn, setSignIn] = useState(false);
  const last = useLastEntry(entry);

  useEffect(() => setSaved(false), [entry?.id]);

  /** A new project of yours, started from this build. */
  function startFromTemplate() {
    if (!last) return;
    if (!readAccount()) {
      setSignIn(true);
      return;
    }
    if (last.kind === 'published') {
      const copy = duplicateProject(last.project.id);
      if (copy) router.push(projectPath(copy.id, 'workspace'));
      return;
    }
    const id = newId();
    submitDraftProject({ id, prompt: last.sample.prompt, image: { assetId: null, previewUrl: null } });
    router.push(projectPath(id, 'workspace'));
  }

  function saveForLater() {
    if (!last) return;
    if (last.kind === 'published') {
      router.push(projectPath(last.project.id, 'workspace'));
      return;
    }
    saveProject(createProjectRecord({ prompt: last.sample.prompt, title: last.title, phase: 'draft' }));
    setSaved(true);
  }

  return (
    <>
      <Modal
        open={entry !== null && !signIn}
        onClose={onClose}
        title={last?.title ?? 'Build'}
        variant="wide"
        hideHeader
        testId="community-preview"
        initialFocus="[data-testid='community-template']"
      >
        {last ? (
          <div className="mk-cm">
            <div className="mk-cm__media">
              {/* eslint-disable-next-line @next/next/no-img-element -- static thumbnail */}
              <img src={last.image} alt="" />
            </div>
            <div className="mk-cm__info">
              <span className="ui-badge">{last.kind === 'published' ? 'Published by you' : 'Featured sample'}</span>
              <h3 className="mk-cm__title" data-testid="community-preview-title">
                {last.title}
              </h3>
              <p className="mk-cm__price" data-testid="community-preview-price">
                {last.price ?? 'Price not checked yet'}
                <span>{last.kind === 'published' ? 'in parts' : 'estimated parts'}</span>
              </p>
              <p className="mk-cm__by" data-testid="community-preview-creator">
                <span className="mk-cm__avatar" aria-hidden="true">
                  {last.creator.charAt(0).toUpperCase()}
                </span>
                @{last.creator}
              </p>
              <p className="mk-cm__about">{last.about}</p>
              <div className="mk-cm__actions">
                <button type="button" className="ui-btn ui-btn--primary" onClick={startFromTemplate} data-testid="community-template">
                  Use build as template
                  <Icon name="arrowRight" />
                </button>
                {saved ? (
                  <p className="mk-cm__saved" role="status" data-testid="community-saved">
                    <Icon name="check" /> Saved to <a href="/projects">Your projects</a>
                  </p>
                ) : (
                  <button type="button" className="ui-btn ui-btn--secondary" onClick={saveForLater} data-testid="community-save">
                    {last.kind === 'published' ? 'Open build' : 'Save build for later'}
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </Modal>
      <SignInModal
        open={signIn}
        onClose={() => setSignIn(false)}
        onSave={(account: LocalAccount) => {
          saveAccount(account);
          setSignIn(false);
          startFromTemplate();
        }}
      />
    </>
  );
}

/** Keeps the last entry while the modal animates closed, so its content doesn't blank out. */
function useLastEntry(entry: Entry | null): Entry | null {
  const [last, setLast] = useState<Entry | null>(entry);
  useEffect(() => {
    if (entry) setLast(entry);
  }, [entry]);
  return entry ?? last;
}
