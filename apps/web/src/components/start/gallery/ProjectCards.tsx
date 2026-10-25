'use client';

import type { ReactNode } from 'react';
import type { ProjectRecord } from '../../../lib/flow/projects';
import { SAMPLE_PROJECTS, sampleOpenedAt, thumbnailFor, type SampleProject } from '../../../lib/flow/samples';
import { projectPath } from '../../../lib/flow/steps';
import { Icon } from '../../system/Icon';
import { relativeTime, whereIs } from '../shared';
import { EDGE_GLOWS, EdgeLightCard } from './EdgeLightCard';

/** One of the user's own projects, as a gallery card. Opening it resumes at its furthest step. */
export function ProjectCard({
  project,
  now,
  index,
  menu,
  testPrefix = 'projects',
}: {
  project: ProjectRecord;
  now: number;
  index: number;
  menu?: ReactNode;
  /** Screen name for test ids: `<prefix>-card-<id>`. */
  testPrefix?: string;
}) {
  return (
    <EdgeLightCard
      title={project.title}
      meta={whereIs(project)}
      time={relativeTime(project.updatedAt, now)}
      image={thumbnailFor(project)}
      tag={project.publishedAt ? 'Published' : undefined}
      label={`Open ${project.title}`}
      href={projectPath(project.id)}
      menu={menu}
      glow={EDGE_GLOWS[index % EDGE_GLOWS.length]}
      testId={`${testPrefix}-card-${project.id}`}
      actionTestId={`${testPrefix}-open-${project.id}`}
    />
  );
}

/** A simulated project for the demo, tagged "Sample". */
export function SampleCard({ sample, now, index, onPress }: { sample: SampleProject; now: number; index: number; onPress: (sample: SampleProject) => void }) {
  const example = sample.action.kind === 'example';
  return (
    <EdgeLightCard
      title={sample.title}
      meta={sample.description}
      time={relativeTime(sampleOpenedAt(sample, now), now)}
      note={
        <>
          <Icon name={example ? 'play' : 'info'} size={14} aria-hidden="true" />
          <span>{sample.note}</span>
        </>
      }
      image={sample.thumbnail}
      tag="Sample"
      label={example ? `Open the sample ${sample.title}` : `Start from this idea: ${sample.title}`}
      onPress={() => onPress(sample)}
      glow={EDGE_GLOWS[index % EDGE_GLOWS.length]}
      testId={`new-sample-card-${sample.id}`}
      actionTestId={example ? 'new-sample-example' : 'new-sample'}
      dataSample={sample.id}
    />
  );
}

/** Placeholder cards while the stored list is read. */
export function CardSkeletons({ count = 3 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <li key={i} aria-hidden="true">
          <div className="elc-skel">
            <span className="ui-skeleton" />
            <span className="ui-skeleton" style={{ height: 16, width: '70%', marginLeft: 6 }} />
            <span className="ui-skeleton" style={{ height: 13, width: '45%', marginLeft: 6 }} />
          </div>
        </li>
      ))}
    </>
  );
}

export { SAMPLE_PROJECTS };
