/**
 * Sample projects shown in the "Recent projects" gallery on /new. They are illustrations for the
 * demo, not the user's work: every card wears a "Sample" tag. Only the rover can be built today,
 * so it opens Rivet's real saved example; every other sample only fills the prompt box, and its
 * card says plainly that Rivet will build the closest rover instead. No build data is invented.
 */

/** What a sample is a picture of. Only `rover` is a family Rivet builds today. */
export type SampleFamily =
  | 'rover'
  | 'drone'
  | 'rc_car'
  | 'robot_arm'
  | 'balancing_robot'
  | 'plant_care'
  | 'line_follower'
  | 'weather_station'
  | 'camera_turret';

/** What pressing the card does. */
export type SampleAction =
  /** Open Rivet's saved example as a ready project (no generation, no fake data). */
  | { kind: 'example'; exampleId: string; buildId: string; projectTitle: string }
  /** Fill the prompt box with `prompt` and focus it. */
  | { kind: 'prefill' };

export interface SampleProject {
  /** Stable slug; also the thumbnail file name. */
  id: string;
  title: string;
  /** One plain line about what it does. */
  description: string;
  /** The prompt this project "came from"; used for prefill. */
  prompt: string;
  family: SampleFamily;
  /** How long ago it was "last opened", in hours; turned into a relative time from now. */
  openedHoursAgo: number;
  /** Thumbnail under /public, rendered with three.js. */
  thumbnail: string;
  action: SampleAction;
  /** Plain note on the card about what will happen. */
  note: string;
}

/** The saved example every rover sample opens (`src/lib/fixtures.ts`). */
export const SAMPLE_EXAMPLE_ID = 'rivet-intent-rover-001';

const CLOSEST_ROVER = 'Rivet will build the closest rover.';

export const SAMPLE_PROJECTS: readonly SampleProject[] = [
  {
    id: 'obstacle-rover',
    title: 'Obstacle-avoiding rover',
    description: 'A two-wheel rover that stops before it bumps into walls.',
    prompt: 'Build a small rover that avoids obstacles',
    family: 'rover',
    openedHoursAgo: 3,
    thumbnail: '/projects/obstacle-rover.webp',
    action: { kind: 'example', exampleId: SAMPLE_EXAMPLE_ID, buildId: SAMPLE_EXAMPLE_ID, projectTitle: 'Indoor obstacle rover (example)' },
    note: 'Opens a finished example you can explore.',
  },
  {
    id: 'quadcopter',
    title: 'Quadcopter drone',
    description: 'A small four-rotor drone with a front camera.',
    prompt: 'A small quadcopter drone with a camera on the front',
    family: 'drone',
    openedHoursAgo: 26,
    thumbnail: '/projects/quadcopter.webp',
    action: { kind: 'prefill' },
    note: `Drones are coming later. ${CLOSEST_ROVER}`,
  },
  {
    id: 'electric-car',
    title: 'Little electric car',
    description: 'A four-wheel toy car with working headlights.',
    prompt: 'A little four-wheel electric car with headlights that I can drive around the house',
    family: 'rc_car',
    openedHoursAgo: 52,
    thumbnail: '/projects/electric-car.webp',
    action: { kind: 'prefill' },
    note: `Mini cars are planned, not ready yet. ${CLOSEST_ROVER}`,
  },
  {
    id: 'robot-arm',
    title: 'Desk robot arm',
    description: 'A four-joint arm that picks up small blocks.',
    prompt: 'A desk robot arm with a gripper that can pick up small blocks',
    family: 'robot_arm',
    openedHoursAgo: 75,
    thumbnail: '/projects/robot-arm.webp',
    action: { kind: 'prefill' },
    note: `Robot arms are coming later. ${CLOSEST_ROVER}`,
  },
  {
    id: 'line-follower',
    title: 'Line-following robot',
    description: 'A small robot that follows a strip of black tape.',
    prompt: 'A small robot that follows a black tape line on the floor',
    family: 'line_follower',
    openedHoursAgo: 98,
    thumbnail: '/projects/line-follower.webp',
    action: { kind: 'prefill' },
    note: `Line following is coming later. ${CLOSEST_ROVER}`,
  },
  {
    id: 'balancing-robot',
    title: 'Self-balancing robot',
    description: 'A two-wheel robot that stays upright on its own.',
    prompt: 'A two-wheel self-balancing robot that stays upright on its own',
    family: 'balancing_robot',
    openedHoursAgo: 140,
    thumbnail: '/projects/balancing-robot.webp',
    action: { kind: 'prefill' },
    note: `Balancing robots are coming later. ${CLOSEST_ROVER}`,
  },
  {
    id: 'plant-waterer',
    title: 'Plant-watering helper',
    description: 'Checks the soil and waters the plant when it gets dry.',
    prompt: 'A helper that checks the soil and waters my plant when it gets dry',
    family: 'plant_care',
    openedHoursAgo: 220,
    thumbnail: '/projects/plant-waterer.webp',
    action: { kind: 'prefill' },
    note: `Plant helpers are coming later. ${CLOSEST_ROVER}`,
  },
  {
    id: 'weather-station',
    title: 'Desk weather station',
    description: 'Shows the temperature and wind speed on a small screen.',
    prompt: 'A desk weather station that shows temperature and wind speed on a small screen',
    family: 'weather_station',
    openedHoursAgo: 310,
    thumbnail: '/projects/weather-station.webp',
    action: { kind: 'prefill' },
    note: `Weather stations are coming later. ${CLOSEST_ROVER}`,
  },
  {
    id: 'camera-turret',
    title: 'Pan-tilt camera',
    description: 'A camera on two motors that turns to look around.',
    prompt: 'A camera on a pan-tilt mount that can turn to look around the room',
    family: 'camera_turret',
    openedHoursAgo: 430,
    thumbnail: '/projects/camera-turret.webp',
    action: { kind: 'prefill' },
    note: `Camera mounts are coming later. ${CLOSEST_ROVER}`,
  },
];

/** ISO time a sample was "last opened", always relative to `now` so it never goes stale. */
export function sampleOpenedAt(sample: Pick<SampleProject, 'openedHoursAgo'>, now: number = Date.now()): string {
  return new Date(now - sample.openedHoursAgo * 3_600_000).toISOString();
}

/** The rover thumbnail, used for the user's own projects (every Rivet build today is a rover). */
export const ROVER_THUMBNAIL = '/projects/obstacle-rover.webp';

const FAMILY_WORDS: [SampleFamily, RegExp][] = [
  ['drone', /\b(drone|quad ?copter|multirotor|uav)\b/i],
  ['robot_arm', /\b(robot(ic)? arm|gripper)\b/i],
  ['balancing_robot', /\b(self[- ]balancing|balancing robot|segway)\b/i],
  ['plant_care', /\b(plant|garden|water(ing|s)? (my|the) )/i],
  ['weather_station', /\bweather\b/i],
  ['camera_turret', /\b(pan[- ]tilt|turret)\b/i],
  ['line_follower', /\b(line[- ]follow(ing|er)?|follows? a (black )?(tape )?line)\b/i],
  ['rc_car', /\b(rc car|electric car|toy car)\b/i],
];

/**
 * Picture for one of the user's projects. The picture the user built from comes first, so projects
 * started from different pictures look different. Otherwise anything Rivet has built (or will build)
 * is a rover; a prompt that names another kind of project shows that kind's sample picture until it is built.
 */
export function thumbnailFor(project: {
  prompt: string;
  phase: string;
  buildId: string | null;
  exampleId: string | null;
  imageThumbnail?: string | null;
  imagePreviewUrl?: string | null;
}): string {
  const picture = project.imageThumbnail || project.imagePreviewUrl;
  if (picture) return picture;
  if (project.phase === 'ready' || project.buildId || project.exampleId) return ROVER_THUMBNAIL;
  const hit = FAMILY_WORDS.find(([, re]) => re.test(project.prompt));
  const sample = hit ? SAMPLE_PROJECTS.find((s) => s.family === hit[0]) : null;
  return sample?.thumbnail ?? ROVER_THUMBNAIL;
}
