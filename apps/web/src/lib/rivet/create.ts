import type { RivetDataSource } from "./data-source";
import { FixtureSource, type FixtureSourceOptions } from "./fixture-source";
import { HttpSource, type HttpSourceOptions } from "./http-source";

export const DEFAULT_API_URL = "http://localhost:8000";

export interface CreateDataSourceConfig {
  /** Defaults to `NEXT_PUBLIC_RIVET_USE_FIXTURES`; anything other than "false" selects fixtures. */
  useFixtures?: boolean;
  /** Defaults to `NEXT_PUBLIC_RIVET_API_URL`, then http://localhost:8000. */
  apiUrl?: string;
  http?: Omit<HttpSourceOptions, "baseUrl">;
  fixture?: FixtureSourceOptions;
}

export function createRivetDataSource(config: CreateDataSourceConfig = {}): RivetDataSource {
  // Literal `process.env.NEXT_PUBLIC_*` access so Next.js can inline the values client-side.
  const envUseFixtures = process.env.NEXT_PUBLIC_RIVET_USE_FIXTURES;
  const envApiUrl = process.env.NEXT_PUBLIC_RIVET_API_URL;
  const useFixtures = config.useFixtures ?? envUseFixtures !== "false";
  if (useFixtures) return new FixtureSource(config.fixture);
  return new HttpSource({ baseUrl: config.apiUrl ?? envApiUrl ?? DEFAULT_API_URL, ...config.http });
}
