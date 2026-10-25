/** Raw JSON documents keyed by file name (`<name>.json`), before validation. */
export interface RawFixtureFiles {
  products: Record<string, unknown>;
  offers: Record<string, unknown>;
}
