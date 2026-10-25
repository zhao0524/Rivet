import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import type { Size3 } from '../../components/three/parts/types';

/** Gap between parts on a print plate, and the plate row width (a common 220 mm bed, minus margins). */
const PLATE_GAP_MM = 6;
const PLATE_ROW_MM = 200;
/** Thinner walls than this do not print on a typical 0.4 mm nozzle. */
const MIN_WALL_MM = 0.8;

export interface PrintPart {
  shape: string;
  size: Size3;
  count: number;
}

/**
 * Closed solid for a concept part shape, in mm, Y up, matching ConceptPartRecipe's proportions.
 * Every shape is watertight so a slicer can print it (the renderer's open hemisphere is closed here).
 */
export function partGeometry(shape: string, raw: Size3): THREE.BufferGeometry[] {
  const x = Math.max(MIN_WALL_MM, raw.x);
  const y = Math.max(MIN_WALL_MM, raw.y);
  const z = Math.max(MIN_WALL_MM, raw.z);
  const scaled = (g: THREE.BufferGeometry, sx = x, sy = y, sz = z) => g.scale(sx, sy, sz);
  switch (shape) {
    case 'rounded_box': {
      const rad = Math.max(0.01, Math.min(Math.min(x, y, z) * 0.18, x / 2 - 0.01, y / 2 - 0.01, z / 2 - 0.01));
      return [new RoundedBoxGeometry(x, y, z, 3, rad)];
    }
    case 'cylinder':
      return [scaled(new THREE.CylinderGeometry(0.5, 0.5, 1, 48))];
    case 'tube':
      return [scaled(lathe([[0.36, -0.5], [0.5, -0.5], [0.5, 0.5], [0.36, 0.5], [0.36, -0.5]]))];
    case 'sphere':
      return [scaled(new THREE.SphereGeometry(0.5, 40, 30))];
    case 'hemisphere': {
      const arc = Array.from({ length: 13 }, (_, i): [number, number] => {
        const a = (i / 12) * (Math.PI / 2);
        return [0.5 * Math.cos(a), 0.5 * Math.sin(a)];
      });
      return [lathe([[0, 0], ...arc.slice(0, -1), [0, 0.5]]).scale(x, 2 * y, z)];
    }
    case 'cone':
      return [scaled(new THREE.ConeGeometry(0.5, 1, 48))];
    case 'capsule': {
      const radius = Math.min(x, z) / 2;
      const g = new THREE.CapsuleGeometry(radius, Math.max(0, y - 2 * radius), 8, 32);
      return [g.scale(x / (2 * radius), 1, z / (2 * radius))];
    }
    case 'torus': {
      const t = Math.min(y, x / 2) / 2;
      return [new THREE.TorusGeometry(x / 2 - t, t, 24, 64).scale(1, z / x, 1).rotateX(Math.PI / 2)];
    }
    case 'propeller': {
      // Hub plus two flat blades reaching exactly D across; no blade pitch, so it prints flat.
      const D = Math.max(x, z);
      const t = Math.max(MIN_WALL_MM, y);
      const hubR = Math.max(2, D * 0.06);
      const blades = [0, Math.PI].map((yaw) =>
        new THREE.SphereGeometry(0.5, 32, 16)
          .scale(D / 2 - hubR / 2, t, Math.max(MIN_WALL_MM, D * 0.1))
          .translate(D / 4 + hubR / 4, 0, 0)
          .rotateY(yaw),
      );
      return [new THREE.CylinderGeometry(hubR, hubR, t * 2.4, 32), ...blades];
    }
    case 'wheel': {
      // Solid disc: diameter = largest extent, width = smallest (WheelRecipe's rule), laid flat.
      const dims = [x, y, z].sort((a, b) => a - b);
      return [new THREE.CylinderGeometry(dims[2] / 2, dims[2] / 2, dims[0], 64)];
    }
    case 'box':
    default:
      return [new THREE.BoxGeometry(x, y, z)];
  }
}

function lathe(profile: Array<[number, number]>): THREE.BufferGeometry {
  return new THREE.LatheGeometry(profile.map(([r, h]) => new THREE.Vector2(r, h)), 64);
}

/** One mesh group per part copy, turned Z up (slicer convention) and resting on z = 0. */
function printable(shape: string, size: Size3): THREE.Group {
  const group = new THREE.Group();
  for (const geo of partGeometry(shape, size)) group.add(new THREE.Mesh(geo.rotateX(Math.PI / 2)));
  const box = new THREE.Box3().setFromObject(group);
  group.position.set(-box.min.x, -box.min.y, -box.min.z);
  group.updateMatrixWorld(true);
  return group;
}

/** `count` copies of each part laid out in rows on one plate, so a whole set prints in one job. */
function layoutPlate(parts: readonly PrintPart[]): THREE.Group {
  const plate = new THREE.Group();
  let cx = 0;
  let cy = 0;
  let rowDepth = 0;
  for (const part of parts) {
    for (let i = 0; i < Math.max(1, part.count); i += 1) {
      const copy = printable(part.shape, part.size);
      const box = new THREE.Box3().setFromObject(copy);
      const w = box.max.x - box.min.x;
      const d = box.max.y - box.min.y;
      if (cx > 0 && cx + w > PLATE_ROW_MM) {
        cx = 0;
        cy += rowDepth + PLATE_GAP_MM;
        rowDepth = 0;
      }
      copy.position.x += cx;
      copy.position.y += cy;
      plate.add(copy);
      cx += w + PLATE_GAP_MM;
      rowDepth = Math.max(rowDepth, d);
    }
  }
  plate.updateMatrixWorld(true);
  return plate;
}

/**
 * Binary STL with `count` copies of each part laid out in rows on one plate, so a whole set
 * prints in one job. Sizes are the concept model's estimates, in millimetres.
 */
export function printPlateStl(parts: readonly PrintPart[]): ArrayBuffer {
  const plate = layoutPlate(parts);
  const view = new STLExporter().parse(plate, { binary: true }) as DataView;
  plate.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
}

/** The same plate as Wavefront OBJ text (millimetres, Z up), for slicers and editors that prefer it. */
export function printPlateObj(parts: readonly PrintPart[]): string {
  const plate = layoutPlate(parts);
  const text = new OBJExporter().parse(plate);
  plate.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  return `# Rivet custom part, millimetres, Z up\n${text}`;
}
