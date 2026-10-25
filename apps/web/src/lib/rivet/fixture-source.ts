/**
 * Offline data source serving checked-in, clearly labelled SYNTHETIC fixtures
 * (implementation.md Appendix A). It only returns saved responses: it never
 * animates or fabricates live agent progress and never validates edits.
 */
import type {
  ExportArtifactKind,
  JobSubscription,
  JobSubscriptionOptions,
  RequestOptions,
  RivetDataSource,
} from "./data-source";
import { RivetError } from "./errors";
import { SAVED_SYNTHETIC_EXAMPLE_LABEL, isConceptPlan } from "./honesty";
import { assertPlanIntegrity } from "./integrity";
import type {
  BuildPlan,
  CatalogComponent,
  EditRequest,
  EditResponse,
  EstelleGroundRequest,
  EstelleGroundResponse,
  EstelleStatusResponse,
  GenerateRequest,
  GenerateResponse,
  InterpretResponse,
  IntentSpec,
  JobResponse,
  RevisionSummary,
  SavedExampleSummary,
  StageEvent,
  UploadedImageAsset,
} from "./types";
import { assertValidRequest, editRequestCheck, generateRequestCheck, parseBuildPlan, parseCatalogComponents } from "./validate";
import syntheticCatalog from "./fixtures/synthetic-seed-components.json";
import syntheticIntent from "./fixtures/synthetic-intent-rover-obstacle-v1.json";
import syntheticRoverPlan from "./fixtures/synthetic-rover-obstacle-v1.json";

export const SYNTHETIC_ROVER_BUILD_ID = "rivet-synthetic-rover-fixture";

const SAVED_JOB_PREFIX = "saved-fixture:";

export interface FixtureSourceOptions {
  /** Raw catalog JSON (array of CatalogComponent). Defaults to the synthetic seed catalog. */
  catalog?: unknown;
  /** Raw saved BuildPlan JSON documents. Defaults to the synthetic rover plan. */
  plans?: unknown[];
  /** Build served by `generate()`; defaults to the first plan. */
  defaultBuildId?: string;
  label?: string;
}

interface LoadedFixtures {
  catalog: CatalogComponent[];
  plans: BuildPlan[];
  defaultPlan: BuildPlan;
}

const clone = <T>(value: T): T => structuredClone(value);

function throwIfAborted(options?: RequestOptions) {
  if (options?.signal?.aborted) {
    throw new RivetError({ kind: "aborted", code: "ABORTED", message: "Request was aborted" });
  }
}

export class FixtureSource implements RivetDataSource {
  readonly mode = "fixture" as const;
  /** Banner text the UI must show while this source is active. */
  readonly label: string;
  private readonly options: FixtureSourceOptions;
  private loaded: LoadedFixtures | null = null;

  constructor(options: FixtureSourceOptions = {}) {
    this.options = options;
    this.label = options.label ?? SAVED_SYNTHETIC_EXAMPLE_LABEL;
  }

  /** Parses and integrity-checks fixtures once; fails closed on any contract violation. */
  private load(): LoadedFixtures {
    if (this.loaded) return this.loaded;
    const catalog = parseCatalogComponents(this.options.catalog ?? syntheticCatalog);
    const plans = (this.options.plans ?? [syntheticRoverPlan]).map((raw) => {
      const plan = parseBuildPlan(raw);
      assertPlanIntegrity(plan, plan.concept_catalog ? [...catalog, ...plan.concept_catalog] : catalog);
      return plan;
    });
    if (plans.length === 0) {
      throw new RivetError({ kind: "fixture_unavailable", code: "NO_FIXTURE_PLANS", message: "FixtureSource has no saved plans" });
    }
    const defaultId = this.options.defaultBuildId ?? plans[0].build_id;
    const defaultPlan = this.latest(plans, defaultId);
    if (!defaultPlan) {
      throw new RivetError({ kind: "not_found", code: "BUILD_NOT_FOUND", message: `No saved fixture plan "${defaultId}"` });
    }
    this.loaded = { catalog, plans, defaultPlan };
    return this.loaded;
  }

  private latest(plans: BuildPlan[], buildId: string): BuildPlan | undefined {
    return plans.filter((p) => p.build_id === buildId).sort((a, b) => b.revision - a.revision)[0];
  }

  private savedJobId(plan: BuildPlan) {
    return `${SAVED_JOB_PREFIX}${plan.build_id}@${plan.revision}`;
  }

  /** A concept request is served by the saved concept example when there is one. */
  private planFor(input: GenerateRequest): BuildPlan {
    const { plans, defaultPlan } = this.load();
    if (input.interpretation_choice !== "concept_model") return defaultPlan;
    const concept = plans.find(isConceptPlan);
    return concept ? (this.latest(plans, concept.build_id) ?? defaultPlan) : defaultPlan;
  }

  private savedJob(jobId: string): JobResponse {
    const { plans } = this.load();
    const savedPlan = plans.find((p) => jobId === this.savedJobId(p) && this.latest(plans, p.build_id) === p);
    if (!savedPlan) {
      throw new RivetError({
        kind: "not_found",
        code: "JOB_NOT_FOUND",
        message: `Job "${jobId}" does not exist in fixture mode`,
        hint: "Fixture mode only knows its saved example job; switch to the live API for real generation jobs.",
      });
    }
    return {
      job_id: jobId,
      status: "complete",
      stage: "complete",
      progress: null,
      error: null,
      build_id: savedPlan.build_id,
      revision: savedPlan.revision,
    };
  }

  async getCatalog(options?: RequestOptions): Promise<CatalogComponent[]> {
    throwIfAborted(options);
    return clone(this.load().catalog);
  }

  async getBuild(buildId: string, revision?: number, options?: RequestOptions): Promise<BuildPlan> {
    throwIfAborted(options);
    const { plans } = this.load();
    const matching = plans.filter((p) => p.build_id === buildId);
    if (matching.length === 0) {
      throw new RivetError({
        kind: "not_found",
        code: "BUILD_NOT_FOUND",
        message: `No saved fixture build "${buildId}"`,
        details: { available_build_ids: [...new Set(plans.map((p) => p.build_id))] },
      });
    }
    const plan = revision === undefined ? this.latest(plans, buildId) : matching.find((p) => p.revision === revision);
    if (!plan) {
      throw new RivetError({
        kind: "not_found",
        code: "REVISION_NOT_FOUND",
        message: `Saved fixture build "${buildId}" has no revision ${revision}`,
        details: { available_revisions: matching.map((p) => p.revision) },
      });
    }
    return clone(plan);
  }

  async interpret(input: GenerateRequest, options?: RequestOptions): Promise<InterpretResponse> {
    throwIfAborted(options);
    assertValidRequest(generateRequestCheck, input, "InterpretRequest");
    const intent = clone(syntheticIntent) as IntentSpec;
    intent.input = { ...input.input, user_text: input.input.user_text ?? "", image_interpretation_is_approximate: true };
    intent.assumptions = ["Saved example only: the image and description are not read in offline mode.", ...intent.assumptions];
    return { intent_id: intent.intent_id, intent, supported: true, limitation: null, vision_mode: "fixture" };
  }

  /** Returns the saved example as an already-complete job; no generation is simulated. */
  async generate(input: GenerateRequest, options?: RequestOptions): Promise<GenerateResponse> {
    throwIfAborted(options);
    assertValidRequest(generateRequestCheck, input, "GenerateRequest");
    const plan = this.planFor(input);
    return { job_id: this.savedJobId(plan), status: "complete", build_id: plan.build_id };
  }

  async getJob(jobId: string, options?: RequestOptions): Promise<JobResponse> {
    throwIfAborted(options);
    return this.savedJob(jobId);
  }

  /** Edits are never validated locally; the request is checked then explicitly not accepted. */
  async edit(buildId: string, request: EditRequest, options?: RequestOptions): Promise<EditResponse> {
    throwIfAborted(options);
    assertValidRequest(editRequestCheck, request, "EditRequest");
    const latest = await this.getBuild(buildId, undefined, options);
    if (request.base_revision !== latest.revision) {
      throw new RivetError({
        kind: "conflict",
        status: 409,
        code: "STALE_REVISION",
        message: `base_revision ${request.base_revision} is stale; latest saved revision is ${latest.revision}`,
        details: { latest_revision: latest.revision },
      });
    }
    return {
      accepted: false,
      build_id: latest.build_id,
      revision: null,
      job_id: null,
      finding: {
        rule_id: "fixture.edits_require_live_engine",
        result: "UNKNOWN",
        severity: "advisory",
        affected_instance_ids: [],
        message: `${this.label}: edits cannot be validated in fixture mode. Connect the live API to apply "${request.instruction}".`,
        evidence_urls: [],
      },
    };
  }

  /**
   * Delivers exactly one `system` event stating that a saved example was loaded.
   * No intermediate stages are emitted because none ran.
   */
  subscribeToJob(jobId: string, onEvent: (event: StageEvent) => void, options: JobSubscriptionOptions = {}): JobSubscription {
    let transport: JobSubscription["transport"] = "fixture";
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      transport = "closed";
      options.onTransportChange?.("closed");
    };
    options.signal?.addEventListener("abort", close, { once: true });
    options.onTransportChange?.("fixture");
    queueMicrotask(() => {
      if (closed) return;
      try {
        const job = this.savedJob(jobId);
        const { defaultPlan } = this.load();
        onEvent({
          event_id: 1,
          job_id: jobId,
          stage: "complete",
          actor: "system",
          status: "ok",
          message: `${this.label} loaded from checked-in fixture; no live generation ran.`,
          timestamp: defaultPlan.created_at,
          references: [],
        });
        options.onJob?.(job);
      } catch (err) {
        if (err instanceof RivetError) options.onError?.(err);
        else throw err;
      }
      close();
    });
    return {
      get transport() {
        return transport;
      },
      close,
    };
  }

  async uploadImage(file: File, options?: RequestOptions): Promise<UploadedImageAsset> {
    throwIfAborted(options);
    return {
      asset_id: "asset-00000000000000000000000000000001",
      mime_type: file.type || "image/png",
      size_bytes: file.size,
      preview_url: "",
    };
  }

  async listExamples(options?: RequestOptions): Promise<SavedExampleSummary[]> {
    throwIfAborted(options);
    const { plans } = this.load();
    const seen = new Set<string>();
    const out: SavedExampleSummary[] = [];
    for (const plan of plans) {
      if (seen.has(plan.build_id)) continue;
      seen.add(plan.build_id);
      const latest = this.latest(plans, plan.build_id)!;
      out.push({
        example_id: latest.build_id,
        title: latest.title,
        project_family: latest.project_family,
        status: latest.status,
        generation_mode: latest.provenance.generation_mode,
      });
    }
    return out;
  }

  async listRevisions(buildId: string, options?: RequestOptions): Promise<RevisionSummary[]> {
    throwIfAborted(options);
    const { plans } = this.load();
    const matching = plans.filter((p) => p.build_id === buildId);
    if (matching.length === 0) {
      throw new RivetError({
        kind: "not_found",
        code: "BUILD_NOT_FOUND",
        message: `No saved fixture build "${buildId}"`,
        details: { available_build_ids: [...new Set(plans.map((p) => p.build_id))] },
      });
    }
    return matching
      .slice()
      .sort((a, b) => a.revision - b.revision)
      .map((p) => ({
        revision: p.revision,
        created_at: p.created_at,
        status: p.status,
        title: p.title,
        label: this.label,
      }));
  }

  /** Saved fixtures never run Estelle: always unavailable, with the reason. */
  async getEstelleStatus(options?: RequestOptions): Promise<EstelleStatusResponse> {
    throwIfAborted(options);
    return {
      enabled: false,
      mode: "fixture",
      available: false,
      doctor: null,
      reason: "Estelle grounding is unavailable in offline fixture mode.",
    };
  }

  async groundSymbol(request: EstelleGroundRequest, options?: RequestOptions): Promise<EstelleGroundResponse> {
    throwIfAborted(options);
    const { defaultPlan } = this.load();
    return {
      status: "unavailable",
      tool: null,
      question: `${request.kind}:${request.name}`,
      timestamp: defaultPlan.created_at,
      exit_code: null,
      citations: [],
      raw_output_tail: "",
      reason: "Estelle grounding requires the live API with RIVET_ENABLE_ESTELLE=true; no citations were fabricated.",
      evidence_file: null,
    };
  }

  getExportUrl(_buildId: string, _kind: ExportArtifactKind, _revision?: number): string | null {
    return null;
  }
}
