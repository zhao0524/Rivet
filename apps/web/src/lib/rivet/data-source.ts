import type { DataSourceMode } from "./honesty";
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
  JobResponse,
  RevisionSummary,
  SavedExampleSummary,
  StageEvent,
  UploadedImageAsset,
} from "./types";
import type { RivetError } from "./errors";
import type { OfferListParams, OfferSearchRequest, OfferSet } from "../offers/types";
import type { Resolution, ResolveJob, ResolveRequest, ResolveStartResponse } from "../resolve/types";

export interface RequestOptions {
  signal?: AbortSignal;
  /** Overrides the source's default timeout for this call. */
  timeoutMs?: number;
}

export type JobTransport = "sse" | "polling" | "fixture" | "closed";

export interface JobSubscriptionOptions {
  /** Latest job snapshot (from polling, or a final fetch after a terminal SSE event). */
  onJob?: (job: JobResponse) => void;
  onError?: (error: RivetError) => void;
  onTransportChange?: (transport: JobTransport) => void;
  signal?: AbortSignal;
}

export interface JobSubscription {
  readonly transport: JobTransport;
  close(): void;
}

export type ExportArtifactKind = "bom.csv" | "build.json" | "firmware.zip";

export interface RivetDataSource {
  readonly mode: DataSourceMode;
  getCatalog(options?: RequestOptions): Promise<CatalogComponent[]>;
  getBuild(buildId: string, revision?: number, options?: RequestOptions): Promise<BuildPlan>;
  interpret?(input: GenerateRequest, options?: RequestOptions): Promise<InterpretResponse>;
  generate(input: GenerateRequest, options?: RequestOptions): Promise<GenerateResponse>;
  edit(buildId: string, request: EditRequest, options?: RequestOptions): Promise<EditResponse>;
  getJob(jobId: string, options?: RequestOptions): Promise<JobResponse>;
  /** Streams only events the backend actually emitted; never synthesizes progress. */
  subscribeToJob(jobId: string, onEvent: (event: StageEvent) => void, options?: JobSubscriptionOptions): JobSubscription;
  uploadImage?(file: File, options?: RequestOptions): Promise<UploadedImageAsset>;
  listExamples?(options?: RequestOptions): Promise<SavedExampleSummary[]>;
  listRevisions?(buildId: string, options?: RequestOptions): Promise<RevisionSummary[]>;
  /** Resolves for every state the API reports (disabled, unavailable, available); rejects only without a valid answer. */
  getEstelleStatus?(options?: RequestOptions): Promise<EstelleStatusResponse>;
  groundSymbol?(request: EstelleGroundRequest, options?: RequestOptions): Promise<EstelleGroundResponse>;
  getExportUrl?(buildId: string, kind: ExportArtifactKind, revision?: number): string | null;
  /**
   * Offers (contracts/api.md "Offers"). `GET /api/parts/{catalog_id}/offers`: where a
   * catalog part can be bought, sorted and filtered server-side. A `demo.*` part rejects
   * with a 422 `EXPORT_REFUSED_SYNTHETIC` RivetError (kind `unsupported`); nothing is
   * searched for synthetic placeholders. Results are validated with `parseOfferSet`.
   */
  getPartOffers?(catalogId: string, params?: OfferListParams, options?: RequestOptions): Promise<OfferSet>;
  /** `POST /api/offers/search`; resolves after any 202 job has finished and the set was fetched. */
  searchOffers?(request: OfferSearchRequest, options?: RequestOptions): Promise<OfferSet>;
  /** `GET /api/offers/{offer_set_id}`. */
  getOfferSet?(offerSetId: string, options?: RequestOptions): Promise<OfferSet>;
  /** `POST /api/resolve`: identify a product and trace its parts. Poll the job for `resolution_id`. */
  resolveProduct?(request: ResolveRequest, options?: RequestOptions): Promise<ResolveStartResponse>;
  /** `GET /api/jobs/{id}` for a resolve job (its stages are not the generate pipeline's). */
  getResolveJob?(jobId: string, options?: RequestOptions): Promise<ResolveJob>;
  /** `GET /api/resolutions/{id}`, validated before it is returned. */
  getResolution?(resolutionId: string, options?: RequestOptions): Promise<Resolution>;
}
