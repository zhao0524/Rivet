import { isFiniteVec3, resolveAnchor } from './anchors';
import { DEFAULT_SIGNAL_COLOR, DEFAULT_SIGNAL_PALETTE } from './constants';
import type {
  Vec3,
  WireAnchor,
  WireRoute,
  WiringCatalogComponent,
  WiringComponentInstance,
  WiringConnection,
  WiringLayout,
  WiringPalette,
  WiringPlanInput,
  WiringWarning,
} from './types';

export interface WiringLayoutOptions {
  palette?: WiringPalette;
  /** Vertical lift of the first lane, as a fraction of wire length. */
  liftFraction?: number;
  minLiftMm?: number;
  maxLiftMm?: number;
  /** Extra lift and sideways spread for each additional wire between the same two parts. */
  laneSpacingMm?: number;
}

const DEFAULTS = {
  liftFraction: 0.25,
  minLiftMm: 8,
  maxLiftMm: 40,
  laneSpacingMm: 4,
} as const;

const compareIds = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function wireColor(signal: string, palette?: WiringPalette): string {
  return palette?.[signal] ?? DEFAULT_SIGNAL_PALETTE[signal] ?? DEFAULT_SIGNAL_COLOR;
}

export function signalLabel(from: string, to: string): string {
  return from === to ? from : `${from} → ${to}`;
}

type EndpointResult = { anchor: WireAnchor; warnings: WiringWarning[] } | { anchor: null; warnings: WiringWarning[] };

function warning(
  partial: Omit<WiringWarning, 'wire_drawn' | 'severity'> & Partial<Pick<WiringWarning, 'severity' | 'wire_drawn'>>,
): WiringWarning {
  return { severity: 'blocking', wire_drawn: false, ...partial };
}

function resolveEndpoint(
  connection: WiringConnection,
  endpoint: 'from' | 'to',
  instances: Map<string, WiringComponentInstance[]>,
  catalog: Map<string, WiringCatalogComponent>,
): EndpointResult {
  const ref = connection[endpoint];
  const base = {
    connection_id: connection.connection_id,
    endpoint,
    instance_id: ref?.instance_id ?? null,
    port_id: ref?.port_id ?? null,
    catalog_id: null,
  };
  const matches = ref ? instances.get(ref.instance_id) ?? [] : [];
  if (matches.length === 0) {
    return {
      anchor: null,
      warnings: [warning({ ...base, code: 'UNKNOWN_INSTANCE', message: `Connection ${connection.connection_id} references instance "${base.instance_id}", which is not in this build.` })],
    };
  }
  if (matches.length > 1) {
    return {
      anchor: null,
      warnings: [warning({ ...base, code: 'AMBIGUOUS_INSTANCE', message: `Instance "${base.instance_id}" appears ${matches.length} times in this build; wire endpoint is ambiguous.` })],
    };
  }
  const instance = matches[0]!;
  const component = catalog.get(instance.catalog_id);
  const withCatalog = { ...base, catalog_id: instance.catalog_id };
  if (!component) {
    return {
      anchor: null,
      warnings: [warning({ ...withCatalog, code: 'UNKNOWN_CATALOG_COMPONENT', message: `Instance "${instance.instance_id}" uses catalog item "${instance.catalog_id}", which is missing from the catalog.` })],
    };
  }
  const port = component.ports.find((p) => p.port_id === ref!.port_id);
  if (!port) {
    return {
      anchor: null,
      warnings: [warning({ ...withCatalog, code: 'UNKNOWN_PORT', message: `Port "${ref!.port_id}" does not exist on catalog item "${component.catalog_id}" (instance "${instance.instance_id}").` })],
    };
  }
  if (!isFiniteVec3(instance.pose?.position_mm) || !isFiniteVec3(instance.pose?.rotation_deg)) {
    return {
      anchor: null,
      warnings: [warning({ ...withCatalog, code: 'INVALID_POSE', message: `Instance "${instance.instance_id}" has no valid pose; cannot place a wire endpoint.` })],
    };
  }
  const anchor = resolveAnchor(instance, component, port);
  const warnings: WiringWarning[] = [];
  if (anchor.source === 'pose_origin') {
    warnings.push(
      warning({ ...withCatalog, code: 'UNKNOWN_BOUNDS', severity: 'advisory', wire_drawn: true, message: `Catalog item "${component.catalog_id}" has unknown dimensions; endpoint is drawn at the instance origin.` }),
    );
  }
  return { anchor, warnings };
}

function routeControlPoints(
  from: Vec3,
  to: Vec3,
  lane: number,
  laneCount: number,
  opts: Required<Omit<WiringLayoutOptions, 'palette'>>,
): [Vec3, Vec3, Vec3, Vec3] {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const length = Math.hypot(dx, dy, dz);
  const lift =
    Math.min(opts.maxLiftMm, Math.max(opts.minLiftMm, length * opts.liftFraction)) +
    lane * opts.laneSpacingMm;

  // Spread parallel wires sideways, perpendicular to the wire in the horizontal plane.
  const horizontal = Math.hypot(dx, dz);
  const [sx, sz] = horizontal > 1e-6 ? [-dz / horizontal, dx / horizontal] : [1, 0];
  const spread = (lane - (laneCount - 1) / 2) * opts.laneSpacingMm;

  const c1: Vec3 = [from[0] + dx / 3 + sx * spread, from[1] + lift, from[2] + dz / 3 + sz * spread];
  const c2: Vec3 = [from[0] + (2 * dx) / 3 + sx * spread, to[1] + lift, from[2] + (2 * dz) / 3 + sz * spread];
  return [from, c1, c2, to];
}

/**
 * Pure, deterministic layout of every electrical connection in a plan. Output depends
 * only on content (connections are processed in `connection_id` order), never on array
 * order, so repeated renders and shuffled inputs produce identical geometry.
 */
export function buildWiringLayout(
  plan: WiringPlanInput,
  catalog: readonly WiringCatalogComponent[],
  options: WiringLayoutOptions = {},
): WiringLayout {
  const opts = {
    liftFraction: options.liftFraction ?? DEFAULTS.liftFraction,
    minLiftMm: options.minLiftMm ?? DEFAULTS.minLiftMm,
    maxLiftMm: options.maxLiftMm ?? DEFAULTS.maxLiftMm,
    laneSpacingMm: options.laneSpacingMm ?? DEFAULTS.laneSpacingMm,
  };

  const instances = new Map<string, WiringComponentInstance[]>();
  for (const c of plan.components ?? []) {
    const list = instances.get(c.instance_id) ?? [];
    list.push(c);
    instances.set(c.instance_id, list);
  }
  const catalogById = new Map(catalog.map((c) => [c.catalog_id, c] as const));

  const all = plan.connections ?? [];
  const electrical = all
    .filter((c) => c.kind === 'electrical')
    .slice()
    .sort((a, b) => compareIds(a.connection_id, b.connection_id));

  const idCounts = new Map<string, number>();
  for (const c of electrical) idCounts.set(c.connection_id, (idCounts.get(c.connection_id) ?? 0) + 1);

  const warnings: WiringWarning[] = [];
  const resolved: { connection: WiringConnection; from: WireAnchor; to: WireAnchor }[] = [];
  const reportedDuplicates = new Set<string>();

  for (const connection of electrical) {
    if ((idCounts.get(connection.connection_id) ?? 0) > 1) {
      if (!reportedDuplicates.has(connection.connection_id)) {
        reportedDuplicates.add(connection.connection_id);
        warnings.push(
          warning({
            code: 'DUPLICATE_CONNECTION_ID',
            connection_id: connection.connection_id,
            endpoint: null,
            instance_id: null,
            port_id: null,
            catalog_id: null,
            message: `connection_id "${connection.connection_id}" is used ${idCounts.get(connection.connection_id)} times; none of these wires are drawn.`,
          }),
        );
      }
      continue;
    }
    const from = resolveEndpoint(connection, 'from', instances, catalogById);
    const to = resolveEndpoint(connection, 'to', instances, catalogById);
    if (!from.anchor || !to.anchor) {
      // An endpoint failed, so any advisory warning on the other end is moot.
      warnings.push(...[...from.warnings, ...to.warnings].filter((w) => w.severity === 'blocking'));
      continue;
    }
    if (from.anchor.instance_id === to.anchor.instance_id && from.anchor.port_id === to.anchor.port_id) {
      warnings.push(
        warning({
          code: 'SELF_CONNECTION',
          connection_id: connection.connection_id,
          endpoint: null,
          instance_id: from.anchor.instance_id,
          port_id: from.anchor.port_id,
          catalog_id: from.anchor.catalog_id,
          message: `Connection ${connection.connection_id} joins port "${from.anchor.port_id}" to itself.`,
        }),
      );
      continue;
    }
    warnings.push(...from.warnings, ...to.warnings);
    resolved.push({ connection, from: from.anchor, to: to.anchor });
  }

  const pairKey = (a: string, b: string) => (a <= b ? `${a}\u0000${b}` : `${b}\u0000${a}`);
  const lanesByPair = new Map<string, number>();
  for (const r of resolved) {
    const key = pairKey(r.from.instance_id, r.to.instance_id);
    lanesByPair.set(key, (lanesByPair.get(key) ?? 0) + 1);
  }
  const nextLane = new Map<string, number>();

  const wires: WireRoute[] = resolved.map(({ connection, from, to }) => {
    const key = pairKey(from.instance_id, to.instance_id);
    const lane = nextLane.get(key) ?? 0;
    nextLane.set(key, lane + 1);
    return {
      connection_id: connection.connection_id,
      net_name: connection.net_name ?? null,
      notes: connection.notes ?? null,
      from,
      to,
      signal_label: signalLabel(from.signal, to.signal),
      color: wireColor(from.signal, options.palette),
      control_points_mm: routeControlPoints(from.position_mm, to.position_mm, lane, lanesByPair.get(key)!, opts),
      lane,
      approximate: from.approximate || to.approximate,
    };
  });

  const rejected = new Set(warnings.filter((w) => !w.wire_drawn).map((w) => w.connection_id)).size;

  return {
    build_id: plan.build_id ?? null,
    revision: plan.revision ?? null,
    wires,
    warnings,
    approximate: wires.some((w) => w.approximate),
    counts: {
      electrical_connections: electrical.length,
      drawn: wires.length,
      rejected,
      non_electrical_skipped: all.length - electrical.length,
    },
  };
}

