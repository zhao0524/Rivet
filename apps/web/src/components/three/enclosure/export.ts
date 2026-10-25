import * as THREE from 'three';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import type { EnclosureMeshes } from './geometry';

/**
 * Print files for a printed body. Parts are laid out on a build plate the way they print best:
 * millimetres, Z up, sitting on Z = 0. The shell lies roof-down so its open side faces up and needs
 * no supports; the standoffs stand upright in a row beside it.
 */
export type PrintFormat = 'obj' | 'stl';

const GAP_MM = 10;

/** One mesh per printed part, posed on the plate. */
export function printPlate(meshes: EnclosureMeshes): THREE.Group {
  const plate = new THREE.Group();
  plate.name = 'print-plate';

  // Plan space is Y up; slicers are Z up. Tip the shell onto its roof as well.
  const shell = meshes.shell.solid.clone();
  shell.rotateX(-Math.PI / 2);
  shell.computeBoundingBox();
  const sb = shell.boundingBox!;
  shell.translate(-(sb.min.x + sb.max.x) / 2, -(sb.min.y + sb.max.y) / 2, -sb.min.z);
  shell.computeBoundingBox();
  const shellMesh = new THREE.Mesh(shell);
  shellMesh.name = meshes.shell.name;
  plate.add(shellMesh);

  let x = shell.boundingBox!.max.x + GAP_MM;
  let y = shell.boundingBox!.min.y;
  for (const post of meshes.posts) {
    const g = post.solid.clone();
    g.rotateX(Math.PI / 2);
    g.computeBoundingBox();
    const b = g.boundingBox!;
    const w = b.max.x - b.min.x;
    g.translate(x - b.min.x, y - b.min.y, -b.min.z);
    const mesh = new THREE.Mesh(g);
    mesh.name = post.name;
    plate.add(mesh);
    y += b.max.y - b.min.y + GAP_MM / 2;
    if (y > shell.boundingBox!.max.y) {
      y = shell.boundingBox!.min.y;
      x += w + GAP_MM / 2;
    }
  }
  plate.updateMatrixWorld(true);
  return plate;
}

/** The plate as print file contents: OBJ text with one named object per part, or binary STL bytes. */
export function printFileContents(meshes: EnclosureMeshes, format: PrintFormat, title: string): string | ArrayBuffer {
  const plate = printPlate(meshes);
  if (format === 'stl') return (new STLExporter().parse(plate, { binary: true }) as DataView).buffer as ArrayBuffer;
  const header = [
    `# ${title}: printed body from Rivet`,
    '# Units: millimetres. Z is up; every part sits on Z = 0, laid out for one build plate.',
    `# Parts: ${[meshes.shell.name, ...meshes.posts.map((p) => p.name)].join(', ')}`,
    '',
  ].join('\n');
  return header + new OBJExporter().parse(plate);
}

export function exportPrintFile(meshes: EnclosureMeshes, format: PrintFormat, title: string): Blob {
  return new Blob([printFileContents(meshes, format, title)], { type: format === 'stl' ? 'model/stl' : 'model/obj' });
}

export function printFileName(buildId: string, revision: number, format: PrintFormat): string {
  return `${buildId}-r${revision}-printed-body.${format}`;
}

/** Saves a blob as a file: a Blob URL on a temporary anchor, revoked after the click. */
export function downloadBlob(filename: string, blob: Blob): void {
  if (typeof document === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
