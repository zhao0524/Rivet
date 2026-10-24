'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { HalfFloatType, Vector2, WebGLRenderTarget, type Object3D } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';

export interface OutlineStyle {
  /** Edge color where the part is in front. */
  readonly visibleColor: string;
  /** Edge color where other geometry occludes the part (dim, so depth reads correctly). */
  readonly hiddenColor: string;
  readonly strength: number;
  /** Screen-space blur radius in half-resolution pixels (constant under zoom). */
  readonly thickness: number;
}

export const SELECTED_OUTLINE: OutlineStyle = { visibleColor: '#4fb0ff', hiddenColor: '#1c4a73', strength: 6, thickness: 1 };
export const HOVER_OUTLINE: OutlineStyle = { visibleColor: '#a9d2ff', hiddenColor: '#000000', strength: 2.5, thickness: 1 };
export const HIGHLIGHT_OUTLINE: OutlineStyle = { visibleColor: '#fbbf24', hiddenColor: '#5c4310', strength: 4, thickness: 1 };

/** The PartNode group (`part:<instance_id>`) rendering one BuildPlan component, if mounted. */
export function findPartNode(root: Object3D, instanceId: string): Object3D | null {
  const node = root.getObjectByName(`part:${instanceId}`);
  return node && node.userData?.partNode === true ? node : null;
}

/**
 * PartNodes for `instanceIds`, de-duplicated, in input order. Each node is a whole
 * logical component: the outline pass traverses it, so every mesh of a multi-mesh
 * part (tire + hub, PCB + headers) contributes to one silhouette.
 */
export function resolveOutlineTargets(root: Object3D, instanceIds: Iterable<string>): Object3D[] {
  const out: Object3D[] = [];
  const seen = new Set<string>();
  for (const id of instanceIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const node = findPartNode(root, id);
    if (node) out.push(node);
  }
  return out;
}

function applyStyle(pass: OutlinePass, style: OutlineStyle) {
  pass.visibleEdgeColor.set(style.visibleColor);
  pass.hiddenEdgeColor.set(style.hiddenColor);
  pass.edgeStrength = style.strength;
  pass.edgeThickness = style.thickness;
  pass.edgeGlow = 0;
  pass.pulsePeriod = 0;
}

export interface SelectionOutlineProps {
  selectedInstanceId?: string | null;
  hoveredInstanceId?: string | null;
  /** Step-timeline / wiring highlights. */
  highlightedInstanceIds?: Iterable<string> | null;
}

/**
 * Screen-space silhouette outlines for the selected, hovered and highlighted parts.
 * Takes over the frame render (priority 1); with nothing outlined it renders the
 * scene directly, so idle cost is unchanged. Materials are never modified.
 */
export function SelectionOutline({
  selectedInstanceId = null,
  hoveredInstanceId = null,
  highlightedInstanceIds = null,
}: SelectionOutlineProps) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const dpr = useThree((s) => s.viewport.dpr);
  const invalidate = useThree((s) => s.invalidate);

  const pipeline = useMemo(() => {
    // Multisampled target keeps the canvas antialiasing that the composer would otherwise lose.
    const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 4 });
    const composer = new EffectComposer(gl, target);
    composer.addPass(new RenderPass(scene, camera));
    const outline = (style: OutlineStyle) => {
      const pass = new OutlinePass(new Vector2(1, 1), scene, camera);
      applyStyle(pass, style);
      pass.enabled = false;
      composer.addPass(pass);
      return pass;
    };
    // Selected is composited last so it reads on top of hover/highlight edges.
    const highlight = outline(HIGHLIGHT_OUTLINE);
    const hover = outline(HOVER_OUTLINE);
    const selected = outline(SELECTED_OUTLINE);
    composer.addPass(new OutputPass());
    return { composer, highlight, hover, selected };
  }, [gl, scene, camera]);

  useEffect(
    () => () => {
      for (const pass of pipeline.composer.passes) pass.dispose();
      pipeline.composer.dispose();
    },
    [pipeline],
  );

  useEffect(() => {
    pipeline.composer.setPixelRatio(dpr);
    pipeline.composer.setSize(width, height);
    invalidate();
  }, [pipeline, width, height, dpr, invalidate]);

  const highlighted = useMemo(() => [...(highlightedInstanceIds ?? [])], [highlightedInstanceIds]);
  const ids = useRef({ selectedInstanceId, hoveredInstanceId, highlighted });
  ids.current = { selectedInstanceId, hoveredInstanceId, highlighted };
  const highlightKey = highlighted.join('|');
  useEffect(() => {
    invalidate();
  }, [selectedInstanceId, hoveredInstanceId, highlightKey, invalidate]);

  useFrame(() => {
    const { selectedInstanceId: sel, hoveredInstanceId: hov, highlighted: hl } = ids.current;
    const { composer, selected, hover, highlight } = pipeline;
    // Resolved per frame (a name lookup per id) so remounted PartNodes are always current.
    selected.selectedObjects = sel ? resolveOutlineTargets(scene, [sel]) : [];
    hover.selectedObjects = hov && hov !== sel ? resolveOutlineTargets(scene, [hov]) : [];
    highlight.selectedObjects = resolveOutlineTargets(
      scene,
      hl.filter((id) => id !== sel && id !== hov),
    );
    let any = false;
    for (const pass of [selected, hover, highlight]) {
      pass.enabled = pass.selectedObjects.length > 0;
      any ||= pass.enabled;
    }
    if (any) composer.render();
    else gl.render(scene, camera);
  }, 1);

  return null;
}
