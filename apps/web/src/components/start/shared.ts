import type { ProjectRecord } from '../../lib/flow/projects';
import { blockers, buyLines, groupParts, isBlocking, partRows, type PartGroup, type PartRow } from '../../lib/flow/derive';
import type {
  BuildPlan,
  CatalogComponent,
  InputKind,
  IntentSpec,
  JobResponse,
  JobStage,
  StageEvent,
  VerificationFinding,
} from '../../lib/rivet/types';
import type { ThinkingStep } from '../system/Thinking';
import type { TreeStatus } from '../system/TreeView';

/** Example project opened by "See an example" on the empty Projects screen. */
export const EXAMPLE_PROJECT = {
  exampleId: 'rivet-intent-rover-001',
  buildId: 'rivet-intent-rover-001',
  title: 'Indoor obstacle rover (example)',
  prompt: 'Build a small rover that avoids obstacles',
} as const;

/** Where a project is, in words: "Reading your idea", "Building", "Step 1 of 2 · Buy", "Done". */
export function whereIs(project: ProjectRecord): string {
  if (project.phase === 'draft') return 'Draft';
  if (project.phase === 'clarify') return 'Reading your idea';
  if (project.phase === 'generating') return 'Building';
  if (project.furthestStep === 'done') return 'Done';
  // The workspace guide is two steps, Buy then Build; anything before Build counts as buying.
  return project.furthestStep === 'build' ? 'Step 2 of 2 · Build' : 'Step 1 of 2 · Buy';
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
  iot: 'a connected gadget',
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

const CONFIDENCE: Record<string, string> = {
  high: 'Rivet is confident about this',
  medium: 'Rivet is fairly sure about this',
  low: 'Rivet is partly guessing here',
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
    const name = /esp32/i.test(controller)
      ? 'the controller board (ESP32)'
      : /arduino/i.test(controller)
        ? 'an Arduino controller board'
        : `a ${humanize(controller)} controller board`;
    facts.push(`Its brain: ${name}.`);
  }
  if (intent.visual_features.length > 0) facts.push(`From the picture: ${listWords(intent.visual_features)}.`);
  if (intent.requirements.preferred_color) facts.push(`Color: ${intent.requirements.preferred_color}.`);
  const unknowns = intent.unknowns.length > 0 ? `Still unknown: ${listWords(intent.unknowns.map(lowerFirst))}.` : null;
  const confidence = CONFIDENCE[String(intent.confidence)] ?? `${capitalize(String(intent.confidence))} confidence`;
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


/* ── Generation in plain words (Generate screen) ───────── */

/** What each engine stage is doing, said the way a person would. */
export const STAGE_PHRASE: Record<JobStage, string> = {
  upload: 'Looking at your picture',
  understand: 'Reading your idea',
  catalog_selection: 'Choosing parts from the catalog',
  assembly: 'Placing each part',
  validate: 'Checking it will work',
  repair: 'Fixing what failed a check',
  render_ready: 'Getting the 3D model ready',
  firmware: 'Writing the starter code',
  complete: 'Finished the design',
  failed: 'Stopped',
};

/** Stage phrase for any stage id, including ones this build doesn't know yet. */
export function stagePhrase(stage: string): string {
  return (STAGE_PHRASE as Record<string, string>)[stage] ?? capitalize(humanize(stage));
}

/** The five parts of a build the Generate tree shows, in order. */
export const BUILD_PHASES = [
  { id: 'understand', label: 'Understanding your idea', stages: ['upload', 'understand'] },
  { id: 'parts', label: 'Choosing parts', stages: ['catalog_selection'] },
  { id: 'place', label: 'Placing parts', stages: ['assembly', 'render_ready'] },
  { id: 'check', label: 'Checking it works', stages: ['validate', 'repair'] },
  { id: 'code', label: 'Writing the code', stages: ['firmware'] },
] as const satisfies ReadonlyArray<{ id: string; label: string; stages: readonly JobStage[] }>;

export type BuildPhaseId = (typeof BUILD_PHASES)[number]['id'];

/** Plain names for the part groups (derive's labels are written for the Parts step). */
export const PLAIN_GROUP: Record<PartGroup, string> = {
  frame: 'Frame',
  drive: 'Wheels & motors',
  power: 'Power',
  control: 'Brains',
  sensing: 'Sensors',
  hardware: 'Wires & small parts',
};

/** What a part is for, by its role in the plan. */
const ROLE_PLAIN: Record<string, string> = {
  chassis: 'The body everything mounts to',
  motor: 'Turns a wheel',
  wheel: 'Touches the floor',
  caster: 'A small free wheel for balance',
  controller: 'The brain that runs your code',
  motor_driver: 'Gives the motors power when the brain says so',
  distance_sensor: 'Sees obstacles ahead',
  motor_power: 'Batteries for the motors',
  controller_power: 'Battery for the brain',
  power_supply: 'Supplies power',
  accessory: 'Helps connect things',
};

export function rolePlain(role: string): string {
  return ROLE_PLAIN[role] ?? capitalize(humanize(role));
}

/** "the controller board (ESP32)" for an ESP32, the part's own name otherwise. */
export function controllerPlain(name: string): string {
  if (/esp32/i.test(name)) return 'the controller board (ESP32)';
  if (/arduino/i.test(name)) return 'the Arduino controller board';
  return name;
}

/** instance id → part name, used to take ids out of engine messages. */
export function partNames(rows: readonly PartRow[]): Map<string, string> {
  return new Map(rows.map((r) => [r.instanceId, r.name]));
}

/**
 * An engine message without ids: known part ids become part names, anything else that looks like
 * an id (`power-motor-1.v_out`, `catalog_selection`) becomes words.
 */
export function cleanEngineMessage(message: string, names: ReadonlyMap<string, string> = new Map()): string {
  return message
    .replace(/\b([a-z][a-z0-9]*(?:-[a-z0-9]+)*-\d+)((?:\.[a-z0-9_]+)?)\b/gi, (m, id: string) => names.get(id) ?? humanize(m))
    .replace(/\b[a-z][a-z0-9]*(?:[._][a-z][a-z0-9]+)+\b/gi, (m) => humanize(m))
    .replace(/\s*->\s*/g, ' to ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function stepStatus(status: StageEvent['status'], live: boolean): ThinkingStep['status'] {
  if (status === 'failed') return 'failed';
  if (status === 'warning') return 'warning';
  if (status === 'running') return live ? 'running' : 'done';
  return 'done';
}

/**
 * Thinking steps from the real job events, one per stage in the order they ran (an event of the
 * same stage as the one before updates that step instead of adding one). Nothing is invented: no
 * events, no steps. `fixture` words the one "saved example loaded" event plainly.
 */
export function eventSteps(
  events: readonly StageEvent[],
  { live, fixture, names }: { live: boolean; fixture: boolean; names?: ReadonlyMap<string, string> },
): ThinkingStep[] {
  const steps: Array<ThinkingStep & { stage: string }> = [];
  for (const e of events) {
    if (fixture && e.stage === 'complete') {
      steps.push({
        id: `e${e.event_id}`,
        stage: e.stage,
        text: 'Opened a saved example',
        detail: "Rivet didn't design anything just now. It loaded a build that was saved earlier.",
        status: 'done',
      });
      continue;
    }
    const step = {
      id: `e${e.event_id}`,
      stage: e.stage,
      text: stagePhrase(e.stage),
      detail: e.message ? cleanEngineMessage(e.message, names) : undefined,
      status: e.stage === 'failed' ? ('failed' as const) : stepStatus(e.status, live),
    };
    const last = steps[steps.length - 1];
    if (last && last.stage === e.stage) {
      // Keep a warning or failure visible even if a later event of the stage says ok.
      const keep = last.status === 'failed' || (last.status === 'warning' && step.status === 'done');
      steps[steps.length - 1] = { ...step, id: last.id, status: keep ? last.status : step.status };
    } else {
      steps.push(step);
    }
  }
  // Once the job is over, nothing is still "running".
  return steps.map(({ stage: _stage, ...s }) => (!live && s.status === 'running' ? { ...s, status: 'done' } : s));
}

/** Real time between the first and the last event, or null with fewer than two. */
export function eventsElapsedMs(events: readonly StageEvent[]): number | null {
  if (events.length < 2) return null;
  const first = new Date(events[0]!.timestamp).getTime();
  const last = new Date(events[events.length - 1]!.timestamp).getTime();
  if (!Number.isFinite(first) || !Number.isFinite(last)) return null;
  return Math.max(0, last - first);
}

export interface PhaseState {
  status: TreeStatus | undefined;
  detail: string;
}

/** Where each of the five phases is, from the events alone. */
export function phaseStates(
  events: readonly StageEvent[],
  { live, finished, failed, fixture, names }: { live: boolean; finished: boolean; failed: boolean; fixture: boolean; names?: ReadonlyMap<string, string> },
): Record<BuildPhaseId, PhaseState> {
  const out = {} as Record<BuildPhaseId, PhaseState>;
  const phaseIndex = (stage: string) => BUILD_PHASES.findIndex((p) => (p.stages as readonly string[]).includes(stage));
  const reached = events.reduce((max, e) => Math.max(max, phaseIndex(e.stage)), -1);
  BUILD_PHASES.forEach((phase, i) => {
    const mine = events.filter((e) => (phase.stages as readonly string[]).includes(e.stage));
    const last = mine[mine.length - 1];
    if (fixture) {
      out[phase.id] = { status: undefined, detail: 'From the saved example' };
      return;
    }
    if (!last) {
      if (i < reached) out[phase.id] = { status: 'done', detail: 'No details reported' };
      else if (finished) out[phase.id] = { status: undefined, detail: 'Rivet sent no update for this part' };
      else out[phase.id] = { status: 'pending', detail: failed ? 'Not reached' : 'Not started yet' };
      return;
    }
    const detail = last.message ? cleanEngineMessage(last.message, names) : stagePhrase(last.stage);
    if (mine.some((e) => e.status === 'failed')) out[phase.id] = { status: 'failed', detail };
    else if (last.status === 'running' && live && i === reached) out[phase.id] = { status: 'running', detail };
    else if (mine.some((e) => e.status === 'warning')) out[phase.id] = { status: 'warning', detail };
    else out[phase.id] = { status: 'done', detail };
  });
  return out;
}

/* ── What the build decided (read from the loaded plan) ── */

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

const CHECK_PLAIN: Record<string, string> = {
  'mechanical.fit_evidence': "It isn't documented how some parts mount",
  'mechanical.geometry_approximated': 'Some part sizes are estimates',
  'mechanical.overlap': 'Some parts may bump into each other',
  'mechanical.ground_contact': "The wheels may not all touch the floor",
  'electrical.motor_voltage': 'The motors may get too little power',
  'electrical.supply_voltage': 'A part may get too little power',
  'electrical.supply_capacity': "It isn't documented how much the batteries can supply",
  'electrical.complete_power_netlist': "The full power wiring wasn't checked",
  'electrical.common_ground': "Not every part shares the same ground wire",
  'electrical.logic_level': "Some signals may be the wrong voltage",
  'completeness.availability': 'A part was out of stock when checked',
  'fixture.synthetic_not_sourced': 'These parts are stand-ins, not real products',
  'sourcing.link_broken': 'A shop link is broken',
  'sourcing.link_freshness': "Some shop links haven't been checked lately",
};

/** A check's title in plain words, by its rule. */
export function checkPlain(ruleId: string): string {
  if (CHECK_PLAIN[ruleId]) return CHECK_PLAIN[ruleId]!;
  const tail = ruleId.split('.').pop() ?? ruleId;
  return capitalize(humanize(tail));
}

export interface AttentionCheck {
  ruleId: string;
  title: string;
  detail: string;
  blocking: boolean;
  findings: VerificationFinding[];
}

/** Checks that didn't pass, one per rule, blocking first. */
export function attentionChecks(plan: BuildPlan, names: ReadonlyMap<string, string>): AttentionCheck[] {
  const byRule = new Map<string, VerificationFinding[]>();
  for (const f of plan.verification.findings) {
    if (f.result === 'PASS') continue;
    byRule.set(f.rule_id, [...(byRule.get(f.rule_id) ?? []), f]);
  }
  const list = Array.from(byRule, ([ruleId, findings]) => {
    const parts = Array.from(new Set(findings.flatMap((f) => f.affected_instance_ids).map((id) => names.get(id)).filter(Boolean))) as string[];
    const detail =
      findings.length > 1 && parts.length > 0
        ? `Affects ${listWords(parts.slice(0, 3))}${parts.length > 3 ? ` and ${plural(parts.length - 3, 'more part')}` : ''}.`
        : cleanEngineMessage(findings[0]!.message, names);
    return { ruleId, title: checkPlain(ruleId), detail, blocking: findings.some(isBlocking), findings };
  });
  return list.sort((a, b) => Number(b.blocking) - Number(a.blocking));
}

export interface Decision {
  id: 'parts' | 'wires' | 'checks' | 'steps' | 'code';
  text: string;
  detail?: string;
}

/** What the starter code does, from the plan's behavior settings, or null when it says nothing. */
export function behaviorPlain(plan: BuildPlan): string | null {
  const b = plan.behavior;
  if (!b) return null;
  const stop = b.parameters.obstacle_stop_distance_m;
  if (/obstacle/i.test(b.profile_id)) {
    return typeof stop === 'number'
      ? `Drives forward and turns away when something is ${stop} m ahead`
      : 'Drives forward and turns away from obstacles';
  }
  if (/line/i.test(b.profile_id)) return 'Follows a line on the floor';
  return null;
}

/** Whether the starter code exists and was compiled, in plain words. */
export function codePlain(plan: BuildPlan): { text: string; detail: string } {
  switch (plan.firmware.compile_status) {
    case 'passed':
      return { text: 'Wrote starter code, and it compiled', detail: 'It was built once to make sure it has no errors.' };
    case 'failed':
      return { text: "Wrote starter code, but it didn't compile", detail: 'It needs fixing before it can go on the board.' };
    case 'not_supported':
      return { text: 'No starter code for this build', detail: "These parts don't match a code template Rivet has tested." };
    default:
      return { text: 'Picked a starter code template', detail: "It hasn't been test-compiled yet." };
  }
}

/** The plain-language "what it decided" list, read from the loaded plan. */
export function decisionSummary(plan: BuildPlan, catalog: readonly CatalogComponent[]): Decision[] {
  const rows = partRows(plan, catalog);
  const lines = buyLines(plan, catalog);
  const vendors = new Set(lines.filter((l) => l.url).map((l) => l.vendor));
  const noSeller = lines.filter((l) => !l.url).length;
  const hidden = plan.components.length - rows.length;
  const findings = plan.verification.findings;
  const passed = findings.filter((f) => f.result === 'PASS').length;
  const attention = findings.length - passed;
  const blocking = blockers(plan).length;
  const out: Decision[] = [
    {
      id: 'parts',
      text: vendors.size > 0 ? `Picked ${plural(rows.length, 'part')} from ${plural(vendors.size, 'supplier')}` : `Picked ${plural(rows.length, 'part')}`,
      detail:
        [
          hidden > 0 ? `Plus ${plural(hidden, 'small item')} like wires and batteries that the 3D model doesn't show.` : null,
          noSeller === 0
            ? null
            : noSeller === lines.length
              ? 'Nothing on the parts list has a checked seller yet.'
              : `${plural(noSeller, 'item')} on the parts list ${noSeller === 1 ? 'has' : 'have'} no checked seller yet.`,
        ]
          .filter(Boolean)
          .join(' ') || undefined,
    },
    { id: 'wires', text: plan.connections.length > 0 ? `Connected them with ${plural(plan.connections.length, 'wire')}` : 'Planned no wires yet' },
    {
      id: 'checks',
      text:
        attention > 0
          ? `Ran ${plural(findings.length, 'check')}: ${passed} passed, ${attention} need${attention === 1 ? 's' : ''} your eyes`
          : `Ran ${plural(findings.length, 'check')}: all passed`,
      detail: blocking > 0 ? `${blocking} of them must be sorted out before you build.` : undefined,
    },
    { id: 'steps', text: `Planned ${plural(plan.assembly_steps.length, 'assembly step')}` },
  ];
  const code = codePlain(plan);
  const behavior = behaviorPlain(plan);
  const hasCode = plan.firmware.compile_status !== 'not_supported';
  out.push({ id: 'code', text: code.text, detail: behavior && hasCode ? `${behavior}. ${code.detail}` : code.detail });
  return out;
}

/** Parts grouped with plain group names, for the tree. */
export function plainPartGroups(rows: readonly PartRow[]) {
  return groupParts(rows).map((g) => ({ ...g, label: PLAIN_GROUP[g.group] }));
}
