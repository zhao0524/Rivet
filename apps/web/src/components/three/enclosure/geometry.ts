import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Manifold, ManifoldToplevel } from 'manifold-3d';
import type { Box, EnclosureSlope, EnclosureSpec } from './layout';

/**
 * Meshes for a printed body, in plan millimetres. Built with Manifold (mesh booleans that always
 * return a closed, watertight solid), so the same meshes that are drawn can go straight to a slicer.
 */
export interface EnclosurePrintPart {
  id: string;
  /** Name in exported files. */
  name: string;
  /** Welded, watertight triangles: what the print files contain. */
  solid: THREE.BufferGeometry;
  /** The same shape with creased normals, for drawing. */
  display: THREE.BufferGeometry;
  /** For standoffs: the part they hold up. */
  forInstanceId?: string;
}

export interface EnclosureMeshes {
  shell: EnclosurePrintPart;
  posts: EnclosurePrintPart[];
}

/** Served from /public so the browser bundle never sees the runtime's Node-only branches. */
export const MANIFOLD_VERSION = '3.5.3';
const RUNTIME = `/wasm/manifold-${MANIFOLD_VERSION}`;

let runtime: Promise<ManifoldToplevel> | null = null;

export function loadManifold(): Promise<ManifoldToplevel> {
  runtime ??= (async () => {
    const browser = typeof window !== 'undefined' && !process.env.VITEST;
    const mod = browser
      ? await import(/* webpackIgnore: true */ `${RUNTIME}/manifold.js`)
      : await import(/* webpackIgnore: true */ 'manifold-3d');
    const wasm: ManifoldToplevel = await mod.default(browser ? { locateFile: () => `${RUNTIME}/manifold.wasm` } : undefined);
    wasm.setup();
    return wasm;
  })();
  runtime.catch(() => {
    runtime = null;
  });
  return runtime;
}

const SEGMENTS = 24;

function toGeometry(m: Manifold, name: string): Pick<EnclosurePrintPart, 'solid' | 'display'> {
  const mesh = m.getMesh();
  const positions = new Float32Array(mesh.numVert * 3);
  for (let v = 0; v < mesh.numVert; v++) {
    for (let k = 0; k < 3; k++) positions[v * 3 + k] = mesh.vertProperties[v * mesh.numProp + k]!;
  }
  const solid = new THREE.BufferGeometry();
  solid.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  solid.setIndex(new THREE.BufferAttribute(new Uint32Array(mesh.triVerts), 1));
  solid.computeVertexNormals();
  solid.name = name;
  const display = toCreasedNormals(solid, Math.PI / 6);
  display.name = name;
  return { solid, display };
}

/**
 * The shell and standoffs for `spec`. Every intermediate solid lives in WebAssembly memory, so each
 * is freed as soon as the next one is made from it.
 */
export function buildEnclosureMeshes(wasm: ManifoldToplevel, spec: EnclosureSpec): EnclosureMeshes {
  const { Manifold } = wasm;
  const temp: Manifold[] = [];
  const keep = <T extends Manifold>(m: T): T => (temp.push(m), m);

  const cube = (b: Box) =>
    keep(
      Manifold.cube([b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]], true).translate([
        (b.min[0] + b.max[0]) / 2,
        (b.min[1] + b.max[1]) / 2,
        (b.min[2] + b.max[2]) / 2,
      ]),
    );
  /** Rounded box as the hull of eight corner spheres. */
  const roundedBox = (b: Box, r: number) => {
    const corners: Manifold[] = [];
    for (const x of [b.min[0] + r, b.max[0] - r])
      for (const y of [b.min[1] + r, b.max[1] - r])
        for (const z of [b.min[2] + r, b.max[2] - r]) corners.push(keep(Manifold.sphere(r, SEGMENTS).translate([x, y, z])));
    return keep(Manifold.hull(corners));
  };
  /** Vertical cylinder (along y) centred on (x, z), from y0 to y1. */
  const column = (x: number, z: number, y0: number, y1: number, r0: number, r1 = r0) =>
    keep(Manifold.cylinder(y1 - y0, r0, r1, SEGMENTS).rotate([-90, 0, 0]).translate([x, y0, z]));
  /** Everything above a slope's plane, pushed in by `inset`. */
  const slopeSlab = (slope: EnclosureSlope, inset: number) => {
    const [ze, ye] = slope.edge;
    const [zr, yr] = slope.roof;
    const len = Math.hypot(zr - ze, yr - ye);
    // Outward normal of the slope: up, and out past the end wall it cuts.
    let nz = (yr - ye) / len;
    let ny = -(zr - ze) / len;
    if (ny < 0) {
      nz = -nz;
      ny = -ny;
    }
    const size = 400;
    const cx = (spec.shell.min[0] + spec.shell.max[0]) / 2;
    const width = spec.shell.max[0] - spec.shell.min[0] + 20;
    return keep(
      Manifold.cube([width, size, size * 2], true)
        .rotate([(Math.atan2(nz, ny) * 180) / Math.PI, 0, 0])
        .translate([cx, (ye + yr) / 2 + ny * (size / 2 - inset), (ze + zr) / 2 + nz * (size / 2 - inset)]),
    );
  };

  try {
    const { shell, wall, radius } = spec;
    // Both skins run past the bottom and are cut flat there, so the rim is square, not rounded.
    const drop = radius + 2;
    let outer = roundedBox({ min: [shell.min[0], shell.min[1] - drop, shell.min[2]], max: shell.max }, radius);
    let inner = roundedBox(
      {
        min: [shell.min[0] + wall, shell.min[1] - drop - 2, shell.min[2] + wall],
        max: [shell.max[0] - wall, shell.max[1] - wall, shell.max[2] - wall],
      },
      Math.max(0.6, radius - wall),
    );
    for (const slope of spec.slopes) {
      outer = keep(outer.subtract(slopeSlab(slope, 0)));
      inner = keep(inner.subtract(slopeSlab(slope, wall)));
    }
    let body = keep(outer.subtract(inner));
    body = keep(body.subtract(cube({ min: [shell.min[0] - 20, shell.min[1] - 100, shell.min[2] - 20], max: [shell.max[0] + 20, shell.min[1], shell.max[2] + 20] })));
    for (const tab of spec.tabs) {
      body = keep(body.add(cube(tab)));
      body = keep(body.subtract(column((tab.min[0] + tab.max[0]) / 2, (tab.min[2] + tab.max[2]) / 2, tab.min[1] - 1, tab.max[1] + 1, tab.holeRadius)));
    }
    for (const cut of spec.cutouts) body = keep(body.subtract(cube(cut)));

    const shellPart: EnclosurePrintPart = { id: 'shell', name: 'body_shell', ...toGeometry(body, 'body_shell') };
    const posts = spec.posts.map((p) => {
      const solid = column(p.x, p.z, p.yBottom, p.yTop, p.radius * 1.25, p.radius);
      const name = p.id.replace(/-/g, '_');
      return { id: p.id, name, forInstanceId: p.forInstanceId, ...toGeometry(solid, name) };
    });
    return { shell: shellPart, posts };
  } finally {
    for (const m of temp) m.delete();
  }
}

const cache = new Map<string, Promise<EnclosureMeshes>>();

/** Shell and standoff meshes for `spec`, built once per layout. */
export function enclosureMeshes(spec: EnclosureSpec): Promise<EnclosureMeshes> {
  let hit = cache.get(spec.key);
  if (!hit) {
    hit = loadManifold().then((wasm) => buildEnclosureMeshes(wasm, spec));
    hit.catch(() => cache.delete(spec.key));
    cache.set(spec.key, hit);
  }
  return hit;
}
