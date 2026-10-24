'use client';

import Link from 'next/link';
import { useState } from 'react';

const SAMPLE_PROMPTS = [
  'Build a small rover that avoids obstacles',
  'A two-wheel ESP32 robot that stops 40 cm from a wall',
  'A cheap indoor rover with a distance sensor on the front',
  'An obstacle-avoiding robot I can build on my desk this weekend',
] as const;

/**
 * Landing page prompt. Generating hands the description to the studio intake
 * as a plain GET form (`/studio?start=describe&prompt=`), where it is interpreted and confirmed before any build.
 */
export function HeroPrompt() {
  const [prompt, setPrompt] = useState('');
  const [sample, setSample] = useState(0);

  function shuffle() {
    const next = (sample + 1) % SAMPLE_PROMPTS.length;
    setSample(next);
    setPrompt(SAMPLE_PROMPTS[next]);
  }

  return (
    <div className="mk-prompt">
      <div className="mk-prompt__chips">
        <button type="button" className="mk-chip mk-chip--accent" onClick={shuffle}>
          <span aria-hidden="true">✦</span> Shuffle
        </button>
        <span className="mk-chip">19 sourced catalog parts</span>
        <Link href="/studio?start=upload" className="mk-chip mk-chip--link" data-testid="home-start-upload">
          Upload an image instead
        </Link>
      </div>

      <form className="mk-prompt__field" action="/studio" method="get" aria-label="Describe a build">
        <input type="hidden" name="start" value="describe" />
        <label htmlFor="mk-prompt-input" className="mk-sr-only">
          Describe a robot in a sentence or two
        </label>
        <input
          id="mk-prompt-input"
          name="prompt"
          className="mk-prompt__input"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Describe a robot in a sentence or two…"
          maxLength={2000}
          autoComplete="off"
        />
        <button type="submit" className="mk-btn mk-btn--accent mk-prompt__go" data-testid="home-start-describe">
          <span aria-hidden="true">✦</span> Generate
        </button>
      </form>

      <p className="mk-prompt__hint">
        Take it for a spin with an{' '}
        <button type="button" className="mk-textlink" onClick={() => setPrompt(SAMPLE_PROMPTS[0])}>
          example
        </button>
        . Images are interpreted into a supported build, not reverse-engineered with certainty.
      </p>
    </div>
  );
}
