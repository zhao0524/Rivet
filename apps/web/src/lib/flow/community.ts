/**
 * The landing page's community gallery. Until accounts exist there is no shared gallery, so the
 * featured entries are demo content built on the sample projects: the creator handles and the
 * estimated parts costs below are illustrative, and the gallery tags these cards "Featured
 * sample". Builds the user publishes carry their own real price and name (see `publishedPrice`).
 */

export interface FeaturedBuild {
  /** A `SAMPLE_PROJECTS` id. */
  sampleId: string;
  /** Demo creator handle. */
  creator: string;
  /** Rough parts cost in USD, for the demo. */
  estimatedCost: number;
}

export const FEATURED_BUILDS: readonly FeaturedBuild[] = [
  { sampleId: 'robot-arm', creator: 'maya.builds', estimatedCost: 96 },
  { sampleId: 'line-follower', creator: 'tinkerjun', estimatedCost: 38 },
  { sampleId: 'balancing-robot', creator: 'ohm_sweet_ohm', estimatedCost: 72 },
  { sampleId: 'plant-waterer', creator: 'greenthumb.dev', estimatedCost: 29 },
  { sampleId: 'weather-station', creator: 'cloudnine', estimatedCost: 54 },
  { sampleId: 'camera-turret', creator: 'pan.and.tilt', estimatedCost: 61 },
];

/** "becca" from "becca@umich.edu"; the account label otherwise. */
export function handleFromAccount(email: string | null | undefined): string {
  if (!email) return 'you';
  const at = email.indexOf('@');
  return (at > 0 ? email.slice(0, at) : email).trim().toLowerCase().replace(/\s+/g, '.') || 'you';
}
