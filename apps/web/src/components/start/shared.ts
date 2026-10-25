import type { ProjectRecord } from '../../lib/flow/projects';
import { STEPS } from '../../lib/flow/steps';
import type { InputKind, IntentSpec, JobResponse } from '../../lib/rivet/types';

/** Example project opened by "See an example" on the empty Projects screen. */
export const EXAMPLE_PROJECT = {
  exampleId: 'rivet-intent-rover-001',
  buildId: 'rivet-intent-rover-001',
  title: 'Indoor obstacle rover (example)',
  prompt: 'Build a small rover that avoids obstacles',
} as const;

/** Where a project is, in words: "Clarifying", "Generating", "Step 3 of 5 · Wiring & firmware", "Done". */
export function whereIs(project: ProjectRecord): string {
  if (project.phase === 'draft') return 'Draft';
  if (project.phase === 'clarify') return 'Clarifying';
  if (project.phase === 'generating') return 'Generating';
  if (project.furthestStep === 'done') return 'Done';
  const step = STEPS.find((s) => s.id === project.furthestStep);
  return step ? `Step ${step.n} of ${STEPS.length} · ${step.label}` : 'Ready';
}

/** Relative time for "last updated", falling back to a date for anything older than a week. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return 'at an unknown time';
  const sec = Math.max(0, Math.round((now - then) / 1000));
  if (sec < 45) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return hr === 1 ? '1 hour ago' : `${hr} hours ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return day === 1 ? 'yesterday' : `${day} days ago`;
  return new Date(then).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** The wire `input.kind` for a project: text, image, or both. */
export function inputKind(project: Pick<ProjectRecord, 'prompt' | 'imageAssetId'>): InputKind {
  const hasText = project.prompt.trim().length > 0;
  if (project.imageAssetId && hasText) return 'image_and_text';
  if (project.imageAssetId) return 'image';
  return 'text';
}

/** `input` block of an interpret or generate request for a project. */
export function requestInput(project: Pick<ProjectRecord, 'prompt' | 'imageAssetId'>) {
  const kind = inputKind(project);
  return {
    kind,
    image_asset_id: project.imageAssetId,
    user_text: kind === 'image' ? null : project.prompt.trim(),
  };
}

/* ── Human wording for an IntentSpec (no raw ids on screen) ── */

const FAMILY: Record<string, string> = {
  rover: 'an indoor rover',
  rc_car: 'a mini RC car',
  drone: 'a drone',
  robot_arm: 'a robot arm',
  iot: 'an IoT device',
  unknown: 'a robot of an unclear kind',
};

const BEHAVIOR: Record<string, string> = {
  obstacle_avoidance: 'drives around and avoids obstacles',
  line_following: 'follows a line on the floor',
  manual_drive: 'is driven by hand',
  none: 'has no autonomous behavior',
  unknown: 'has a behavior that was not specified',
};

const CAPABILITY: Record<string, string> = {
  differential_drive: 'two independently driven wheels',
  distance_sensing: 'a forward distance sensor',
  line_sensing: 'a line sensor underneath',
  wireless_control: 'wireless control',
};

function humanize(id: string): string {
  return id.replace(/^[a-z]+\./, '').replace(/[_.-]+/g, ' ').trim();
}

export interface IntentSummary {
  /** One sentence: "Rivet read this as an indoor rover that drives around and avoids obstacles." */
  headline: string;
  /** Short, human facts: capabilities, controller, what the picture showed. */
  facts: string[];
  /** One quiet line, or null when nothing is unknown. */
  unknowns: string | null;
  confidence: string;
}

/** Turns an IntentSpec into plain sentences. Never shows catalog or capability ids. */
export function summarizeIntent(intent: IntentSpec): IntentSummary {
  const family = FAMILY[intent.project_family] ?? humanize(intent.project_family);
  const behavior = BEHAVIOR[intent.requested_behavior] ?? humanize(intent.requested_behavior);
  const facts: string[] = [];
  const caps = intent.requirements.required_capabilities.map((c) => CAPABILITY[c] ?? humanize(c));
  if (caps.length > 0) facts.push(`Needs ${listWords(caps)}.`);
  const controller = intent.requirements.preferred_controller_catalog_id;
  if (controller) {
    const name = /esp32/i.test(controller) ? 'an ESP32 dev board' : /arduino/i.test(controller) ? 'an Arduino' : `a ${humanize(controller)}`;
    facts.push(`Controller: ${name}.`);
  }
  if (intent.visual_features.length > 0) facts.push(`From the picture: ${listWords(intent.visual_features)}.`);
  if (intent.requirements.preferred_color) facts.push(`Color: ${intent.requirements.preferred_color}.`);
  const unknowns = intent.unknowns.length > 0 ? `Still unknown: ${listWords(intent.unknowns.map(lowerFirst))}.` : null;
  const confidence = `${capitalize(String(intent.confidence))} confidence`;
  return { headline: `Rivet read this as ${family} that ${behavior}.`, facts, unknowns, confidence };
}

function listWords(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/** Readable message from a job error, which may be a string or an API error body. */
export function jobErrorMessage(job: JobResponse | null): string | null {
  if (!job || job.status !== 'failed') return null;
  const err = job.error;
  if (!err) return 'Generation failed without a message.';
  if (typeof err === 'string') return err;
  return err.message || `Generation failed (${err.code}).`;
}

/** Stage ids are wire enums; label them for people. */
export const STAGE_LABEL: Record<string, string> = {
  upload: 'Upload',
  understand: 'Understand',
  catalog_selection: 'Pick parts',
  assembly: 'Assemble',
  validate: 'Check',
  repair: 'Repair',
  render_ready: 'Render',
  firmware: 'Firmware',
  complete: 'Complete',
  failed: 'Failed',
};

export function formatClock(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
