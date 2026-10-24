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
  JobResponse,
  RevisionSummary,
  SavedExampleSummary,
  StageEvent,
  UploadedImageAsset,
} from "./types";
import type { RivetError } from "./errors";

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
  generate(input: GenerateRequest, options?: RequestOptions): Promise<GenerateResponse>;
  edit(buildId: string, request: EditRequest, options?: RequestOptions): Promise<EditResponse>;
  getJob(jobId: string, options?: RequestOptions): Promise<JobResponse>;
  /** Streams only events the backend actually emitted; never synthesizes progress. */
  subscribeToJob(jobId: string, onEvent: (event: StageEvent) => void, options?: JobSubscriptionOptions): JobSubscription;
  uploadImage?(file: File, options?: RequestOptions): Promise<UploadedImageAsset>;
  listExamples?(options?: RequestOptions): Promise<SavedExampleSummary[]>;
  listRevisions?(buildId: string, options?: RequestOptions): Promise<RevisionSummary[]>;
  getEstelleStatus?(options?: RequestOptions): Promise<EstelleStatusResponse>;
  groundSymbol?(request: EstelleGroundRequest, options?: RequestOptions): Promise<EstelleGroundResponse>;
  getExportUrl?(buildId: string, kind: ExportArtifactKind, revision?: number): string | null;
}
