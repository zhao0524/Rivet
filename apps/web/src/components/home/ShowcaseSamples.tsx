'use client';

import { useAppRouter } from '../system/Navigation';
import { SAMPLE_PROJECTS, type SampleProject } from '../../lib/flow/samples';
import { EDGE_GLOWS, EdgeLightCard } from '../start/gallery/EdgeLightCard';
import { Icon } from '../system/Icon';
import { createExampleProject } from './HeroFlow';

/** The three sample projects the landing page shows, from the /projects gallery. */
const SHOWCASE_IDS = ['obstacle-rover', 'quadcopter', 'electric-car'] as const;

/**
 * "What Rivet can build" cards: the gallery's own sample cards. The rover opens Rivet's saved
 * example; the others start a new project from their prompt, and say Rivet builds the closest rover.
 */
export function ShowcaseSamples() {
  const router = useAppRouter();
  const samples = SHOWCASE_IDS.map((id) => SAMPLE_PROJECTS.find((s) => s.id === id)).filter(
    (s): s is SampleProject => Boolean(s),
  );

  function open(sample: SampleProject) {
    if (sample.action.kind === 'example') router.push(createExampleProject());
    else router.push(`/new?prompt=${encodeURIComponent(sample.prompt)}`);
  }

  return (
    <ul className="mk-showcase__grid">
      {samples.map((sample, i) => {
        const example = sample.action.kind === 'example';
        return (
          <li key={sample.id} data-testid={`showcase-sample-${sample.id}`}>
            <EdgeLightCard
              title={sample.title}
              meta={sample.description}
              note={
                <>
                  <Icon name={example ? 'play' : 'info'} size={14} aria-hidden="true" />
                  <span>{sample.note}</span>
                </>
              }
              image={sample.thumbnail}
              tag="Sample"
              label={example ? `Open the sample ${sample.title}` : `Start from this idea: ${sample.title}`}
              onPress={() => open(sample)}
              glow={EDGE_GLOWS[i % EDGE_GLOWS.length]}
              dataSample={sample.id}
            />
          </li>
        );
      })}
    </ul>
  );
}
