import { createProject, createCellCanvas, cloneCanvas, isDrawingLayer, createDrawingLayer, refreshLength, type Project, type Layer, type Cell } from "../anim/document";
import { History } from "../anim/history";
import type { BrushSettings } from "../core/brush";
import type { BrushType } from "../core/brush-textures";
import { PressureCurve } from "../core/pressure-curve";

/** Brush selection: smooth (perfect-freehand), ink (incremental marker), or a textured stamp type. */
export type BrushKind = "smooth" | "ink" | BrushType;
import { planMergeDown, type CanvasOps } from "../anim/timeline";
import type { Selection } from "../core/selection";
import type { OnionConfig } from "../anim/onion";
import { Playback } from "../anim/playback";

export type Tool = "brush" | "eraser" | "fill" | "select" | "lasso";

interface AnimState {
  project: Project;
  playhead: number;       // current frame index
  activeLayerId: number;
  tool: Tool;
  brush: BrushSettings;
  sizeRange: number;
  streamline: number;
  brushType: BrushKind;
  fill: { tolerance: number; expand: number };
  /** Bumped whenever the document changes so the canvas recomposites. */
  version: number;
  exportOpen: boolean;
  theme: "dark" | "light";
  onion: OnionConfig;
  playback: { isPlaying: boolean; loop: boolean };
}

const project = createProject();

export const state: AnimState = $state({
  project,
  playhead: 0,
  activeLayerId: project.layers[0].id,
  tool: "brush",
  brush: {
    size: 4,
    color: "#1a1a1a",
    opacity: 100,
    smoothing: 50,
    isEraser: false,
    drawBehind: false,
    alphaLock: false,
    taper: false,
  },
  sizeRange: 3.0, // full pen pressure → 3× the base brush width (light pressure → base)
  streamline: 50,
  brushType: "smooth",
  fill: { tolerance: 32, expand: 2 },
  version: 0,
  exportOpen: false,
  theme: "dark",
  onion: {
    enabled: false,
    prev: 1,
    next: 1,
    allLayers: false,
    tintPrev: "#e0526a", // warm red
    tintNext: "#3f7fd0", // cool blue
  },
  playback: { isPlaying: false, loop: true },
});

export const history = new History();

/** Device pixel ratio captured once at startup; cell canvases are sized to it. */
export const DPR = Math.max(1, Math.floor(window.devicePixelRatio || 1));

/** Real canvas operations for timeline.ts, sized to the active document. */
export const canvasOps: CanvasOps = {
  create: () => createCellCanvas(state.project.width, state.project.height, DPR),
  clone: (src) => cloneCanvas(src),
};

export function activeLayer() {
  return state.project.layers.find((l) => l.id === state.activeLayerId) ?? state.project.layers[0];
}

/** Append a layer (drawing or reference) on top and make it active. */
export function addLayerToProject(layer: Layer) {
  state.project.layers.push(layer);
  state.activeLayerId = layer.id;
  bump();
}

/** Remove a layer by id, keeping at least one drawing layer. */
export function removeLayer(id: number) {
  const layers = state.project.layers;
  const idx = layers.findIndex((l) => l.id === id);
  if (idx === -1) return;
  const drawingCount = layers.filter(isDrawingLayer).length;
  if (isDrawingLayer(layers[idx]) && drawingCount <= 1) return; // keep one drawing layer
  layers.splice(idx, 1);
  if (state.activeLayerId === id) {
    const firstDrawing = layers.find(isDrawingLayer);
    if (firstDrawing) state.activeLayerId = firstDrawing.id;
  }
  bump();
}

/** Reorder the layer stack to exactly `ordered` (bottom→top) and repaint. */
export function reorderLayers(ordered: Layer[]) {
  state.project.layers = ordered;
  bump();
}

/** Duplicate a drawing layer (cloning every key cell's canvas) above it, and make it active. */
export function duplicateLayer(id: number) {
  const layers = state.project.layers;
  const idx = layers.findIndex((l) => l.id === id);
  if (idx === -1) return;
  const src = layers[idx];
  if (!isDrawingLayer(src)) return; // only drawing layers duplicate (clone pixels)
  const dup = createDrawingLayer(state.project.frameCount, `${src.name} copy`);
  dup.visible = src.visible;
  dup.locked = src.locked;
  dup.opacity = src.opacity;
  dup.cells = src.cells.map((c): Cell =>
    c.kind === "key" ? { kind: "key", canvas: cloneCanvas(c.canvas) } : { kind: "hold" }
  );
  layers.splice(idx + 1, 0, dup);
  state.activeLayerId = dup.id;
  bump();
}

/** Merge the drawing layer `id` down onto the drawing layer directly below it, then remove it. */
export function mergeDown(id: number) {
  const layers = state.project.layers;
  const idx = layers.findIndex((l) => l.id === id);
  if (idx <= 0) return; // nothing below
  const upper = layers[idx];
  const below = layers[idx - 1];
  if (!isDrawingLayer(upper) || !isDrawingLayer(below)) return;

  // Merge into a fresh cell track: keyframes only at the union of both layers' keyframes
  // (holds stay holds), compositing each layer's resolved drawing. Reads the original cells,
  // so the result is independent of mutation order.
  below.cells = planMergeDown(below.cells, upper.cells).map((p): Cell => {
    if (p.kind === "hold") return { kind: "hold" };
    const canvas = canvasOps.create();
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (p.below) ctx.drawImage(p.below, 0, 0);
    if (p.upper) {
      ctx.globalAlpha = upper.opacity / 100;
      ctx.drawImage(p.upper, 0, 0);
    }
    return { kind: "key", canvas };
  });
  layers.splice(idx, 1);
  state.activeLayerId = below.id;
  bump();
}

/** Replace the whole document (e.g. after Open or autosave restore). */
export function replaceProject(project: Project) {
  state.project = project;
  state.playhead = 0;
  const firstDrawing = project.layers.find(isDrawingLayer) ?? project.layers[0];
  state.activeLayerId = firstDrawing.id;
  bump();
}

export function bump() {
  refreshLength(state.project);
  const last = state.project.frameCount - 1;
  if (state.playhead > last) state.playhead = last;
  if (state.playhead < 0) state.playhead = 0;
  state.version++;
}

/**
 * The single playback driver. It mutates `state.playhead` each tick (the Canvas rAF poll
 * then recomposites) and reflects its running state into `state.playback.isPlaying`,
 * bumping the version so the onion overlay (hidden while playing) repaints on stop.
 */
export const playbackController = new Playback({
  getFps: () => state.project.fps,
  getFrameCount: () => state.project.frameCount,
  getLoop: () => state.playback.loop,
  getCurrent: () => state.playhead,
  setFrame: (f) => { state.playhead = f; },
  onPlayingChange: (p) => { state.playback.isPlaying = p; state.version++; },
});

/**
 * Holder for the single Selection instance (created by Canvas.svelte on mount).
 * App.svelte reads it to handle Enter (commit) / Escape (cancel) globally.
 */
export const selectionRef: { current: Selection | null } = { current: null };

/** Canvas-owned selection actions reachable from App keyboard shortcuts (W/M warp). */
export const selectionActions: { enterWarp: ((rows: number, cols: number) => void) | null } = { enterWarp: null };

/** Shared pressure-response curve, remaps raw pen pressure before drawing. Imperative widget. */
export const pressureCurve = new PressureCurve();
