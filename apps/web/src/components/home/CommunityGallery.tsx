'use client';

import { useEffect, useMemo, useState } from 'react';
import { publishedProjects, useProjects } from '../../lib/flow/projects';
import { SAMPLE_PROJECTS, type SampleProject } from '../../lib/flow/samples';
import { ProjectCard } from '../start/gallery/ProjectCards';
import { EDGE_GLOWS, EdgeLightCard } from '../start/gallery/EdgeLightCard';
import { useAppRouter } from '../system/Navigation';
import { Icon } from '../system/Icon';

/** Featured builds: the gallery's samples the "Build today" showcase above doesn't already show. */
const FEATURED_IDS = ['robot-arm', 'line-follower', 'balancing-robot', 'plant-waterer', 'weather-station', 'camera-turret'] as const;
/** At most two rows of three. */
const LIMIT = 6;

/**
 * Community section of the landing page: builds people published with "Save and publish", newest
 * first, then featured samples to fill the grid. Published builds live in this browser until
 * accounts are live, so a first visit shows the featured ones.
 */
export function CommunityGallery() {
  const router = useAppRouter();
  const projects = useProjects();
  const [mounted, setMounted] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setMounted(true);
    setNow(Date.now());
  }, []);

  const published = useMemo(() => (mounted ? publishedProjects(projects).slice(0, LIMIT) : []), [mounted, projects]);
  const featured = FEATURED_IDS.map((id) => SAMPLE_PROJECTS.find((s) => s.id === id))
    .filter((s): s is SampleProject => Boolean(s))
    .slice(0, Math.max(0, LIMIT - published.length));

  return (
    <ul className="mk-community__grid" data-testid="home-community-list">
      {published.map((p, i) => (
        <li key={p.id} data-kind="published">
          <ProjectCard project={p} now={now} index={i} testPrefix="home-community" meta="Published by you" />
        </li>
      ))}
      {featured.map((sample, i) => (
        <li key={sample.id} data-kind="featured" data-testid={`home-community-${sample.id}`}>
          <EdgeLightCard
            title={sample.title}
            meta={sample.description}
            note={
              <>
                <Icon name="info" size={14} aria-hidden="true" />
                <span>{sample.note}</span>
              </>
            }
            image={sample.thumbnail}
            tag="Featured"
            label={`Build your own: ${sample.title}`}
            onPress={() => router.push(`/new?prompt=${encodeURIComponent(sample.prompt)}`)}
            glow={EDGE_GLOWS[(published.length + i) % EDGE_GLOWS.length]}
            dataSample={sample.id}
          />
        </li>
      ))}
    </ul>
  );
}
