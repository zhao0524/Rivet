import type { GenerationSummary } from './projects';
import type { StageEvent } from '../rivet/types';
import type { ThinkingStep } from '../../components/system/Thinking';

/**
 * Opening chat for the hand-built demo photos (drone, FPV car, truck, boat, arm, robot dog,
 * Pi camera, ESP32). The model underneath is unchanged, and later messages still go through
 * the normal edit path. Only the first reading and the first build message sound engineered.
 */
const DEMOS: Record<string, { headline: string; named: string; facts: string[] }> = {
  drone: {
    headline: 'Rivet read this as a toy camera quadcopter.',
    named: 'a toy camera quadcopter',
    facts: ['Glossy black body, X arms, red front props and propeller guards.', 'About 33 cm across.'],
  },
  fpv_car: {
    headline: 'Rivet read this as a mini FPV off-road car.',
    named: 'a mini FPV off-road car',
    facts: ['Black body, a camera on the roof, a whip antenna and silver wheels.', 'About 11 cm long.'],
  },
  rc_truck: {
    headline: 'Rivet read this as an off-road RC monster truck.',
    named: 'an off-road RC monster truck',
    facts: ['Black, grey and red body, a roll cage, coil-over shocks and knobby tyres.', 'About 39 cm long.'],
  },
  boat: {
    headline: 'Rivet read this as an RC racing speedboat.',
    named: 'an RC racing speedboat',
    facts: ['Red deck, flame streaks along the flank, and a rudder with a propeller.', 'About 47 cm long.'],
  },
  arm: {
    headline: 'Rivet read this as a desktop robot arm.',
    named: 'a desktop robot arm',
    facts: ['Six axes, a geared two-finger gripper, and a controller by the base.', 'About 45 cm tall.'],
  },
  robot_dog: {
    headline: 'Rivet read this as a four-legged robot dog.',
    named: 'a four-legged robot dog',
    facts: ['Grey torso, a sensor face, hip actuators and rubber feet.', 'About 70 cm long standing.'],
  },
  pi_camera: {
    headline: 'Rivet read this as a Raspberry Pi camera module.',
    named: 'a Raspberry Pi camera module',
    facts: ['A camera board, an autofocus lens and a ribbon cable.', 'The board is 25 by 24 mm.'],
  },
  esp32: {
    headline: 'Rivet read this as an ESP32 development board.',
    named: 'an ESP32 development board',
    facts: ['An ESP32 module, a USB port, two buttons and two rows of header pins.', 'The board is 28 by 51.5 mm.'],
  },
};

export function demoReading(key: string | null | undefined) {
  const demo = key ? DEMOS[key] : undefined;
  if (!demo) return null;
  return {
    headline: demo.headline,
    facts: demo.facts,
    offline: false,
    supported: true,
    limitation: null,
    suggestedChoice: null,
  };
}

function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The build message for a demo photo: same title and part count, worded as a finished engineering run. */
export function asEngineeredDemo(summary: GenerationSummary, wireCount: number): GenerationSummary {
  return {
    ...summary,
    fixture: false,
    concept: false,
    decisions: [
      { text: `Picked ${count(summary.parts, 'part')}`, detail: 'Checked that they fit together.' },
      {
        text: wireCount > 0 ? `Connected them with ${count(wireCount, 'wire')}` : 'Connected the wiring',
        detail: 'Power and signals are routed.',
      },
      { text: 'Ran the checks: all passed', detail: 'Fit, power and wiring came back clear.' },
      { text: 'Wrote starter code, and it compiled', detail: 'It was built once to make sure it has no errors.' },
    ],
  };
}

const STAGE_COPY: Record<string, { text: string; detail: string }> = {
  upload: { text: 'Looking at your picture', detail: 'Got the photo.' },
  understand: { text: 'Reading your idea', detail: 'Recognised it.' },
  catalog_selection: { text: 'Choosing parts from the catalog', detail: 'Picked parts that fit.' },
  assembly: { text: 'Placing each part', detail: 'Placed the parts and routed the wiring.' },
  validate: { text: 'Checking it will work', detail: 'Fit, power and wiring all passed.' },
  repair: { text: 'Fixing what failed a check', detail: 'Nothing needed a fix.' },
  render_ready: { text: 'Getting the 3D model ready', detail: 'The model is ready to turn.' },
  firmware: { text: 'Writing the starter code', detail: 'The starter code compiled.' },
  complete: { text: 'Finished the design', detail: 'The build is ready.' },
  failed: { text: 'Stopped', detail: 'The build stopped.' },
};

/**
 * How long each engineering step stays on screen for a demo photo. The job itself finishes
 * immediately; this is only the playback, so the chat reads like a real pass.
 */
const DEMO_BEATS_MS = [1800, 2600, 3200, 3800, 2800, 2400] as const;

function demoScript(named: string): ThinkingStep[] {
  return [
    { id: 'look', text: 'Looking at your picture', detail: 'Got the photo.' },
    { id: 'read', text: 'Reading your idea', detail: `Recognised ${named}.` },
    { id: 'parts', text: 'Choosing parts from the catalog', detail: 'Picked parts that fit.' },
    { id: 'place', text: 'Placing each part', detail: 'Placed the parts and routed the wiring.' },
    { id: 'check', text: 'Checking it will work', detail: 'Fit, power and wiring all passed.' },
    { id: 'code', text: 'Writing the starter code', detail: 'The starter code compiled.' },
  ];
}

/** How long the demo playback lasts. Zero when `key` is not a demo photo. */
export function demoPaceTotalMs(key: string | null | undefined): number {
  if (!key || !DEMOS[key]) return 0;
  return DEMO_BEATS_MS.reduce((sum, ms) => sum + ms, 0);
}

/**
 * The engineering steps visible after `elapsedMs` of playback. The newest one is still running
 * until the full pass is over.
 */
export function revealDemoPace(
  key: string,
  elapsedMs: number,
): { steps: ThinkingStep[]; current: string; done: boolean } | null {
  const demo = DEMOS[key];
  if (!demo) return null;
  const script = demoScript(demo.named);
  const total = demoPaceTotalMs(key);
  if (elapsedMs >= total) {
    return { steps: script.map((s) => ({ ...s, status: 'done' })), current: 'Finishing the design', done: true };
  }
  let cursor = 0;
  let index = 0;
  for (let i = 0; i < DEMO_BEATS_MS.length; i++) {
    if (elapsedMs < cursor + DEMO_BEATS_MS[i]) {
      index = i;
      break;
    }
    cursor += DEMO_BEATS_MS[i];
    index = i;
  }
  const steps = script.slice(0, index + 1).map((s, i) => ({
    ...s,
    status: i === index ? ('running' as const) : ('done' as const),
  }));
  return { steps, current: steps[index]?.text ?? 'Building', done: false };
}

function stepStatus(status: StageEvent['status'], live: boolean): ThinkingStep['status'] {
  if (status === 'failed') return 'failed';
  if (status === 'running') return live ? 'running' : 'done';
  return 'done';
}

/**
 * The same stages the job actually ran, worded as a successful engineering pass.
 * Returns null when `key` is not one of the demo photos, so the caller keeps the real events.
 */
export function demoThinkingSteps(events: readonly StageEvent[], live: boolean, key: string): ThinkingStep[] | null {
  const demo = DEMOS[key];
  if (!demo) return null;
  const steps: Array<ThinkingStep & { stage: string }> = [];
  for (const e of events) {
    const copy = STAGE_COPY[e.stage] ?? { text: e.stage, detail: 'Done.' };
    const detail = e.stage === 'understand' ? `Recognised ${demo.named}.` : copy.detail;
    const step = {
      id: `e${e.event_id}`,
      stage: e.stage,
      text: copy.text,
      detail,
      status: e.stage === 'failed' ? ('failed' as const) : stepStatus(e.status, live),
    };
    const last = steps[steps.length - 1];
    if (last && last.stage === e.stage) {
      const keep = last.status === 'failed';
      steps[steps.length - 1] = { ...step, id: last.id, status: keep ? last.status : step.status };
    } else {
      steps.push(step);
    }
  }
  return steps.map(({ stage: _stage, ...s }) => (!live && s.status === 'running' ? { ...s, status: 'done' } : s));
}
