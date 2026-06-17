import { createProject, createCellCanvas, cloneCanvas, isDrawingLayer, createDrawingLayer, resolveLayerName, refreshLength, resizeCells, type Project, type Layer, type Cell, type AudioTrack } from "../anim/document";
import { audioEngine } from "../audio/engine";
import { History } from "../anim/history";
import type { BrushSettings } from "../core/brush";
import type { BrushType } from "../core/brush-textures";
import { PressureCurve } from "../core/pressure-curve";

/** Brush selection: smooth (perfect-freehand), ink (incremental marker), or a textured stamp type. */
export type BrushKind = "smooth" | "ink" | BrushType;
import { planMergeDown, type CanvasOps } from "../anim/timeline";
import { placeContent, type ResizeMode, type Anchor } from "../anim/resize";
import type { Selection } from "../core/selection";
import type { OnionConfig } from "../anim/onion";
import { Playback, effectiveRange, withRangeIn, withRangeOut } from "../anim/playback";
import type { Preferences } from "../persist/preferences";

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
  /** Bumped when the pressure curve is edited (it's an imperative widget, not reactive state). */
  curveVersion: number;
  exportOpen: boolean;
  sizeDialog: { open: boolean; mode: "new" | "resize" };
  theme: "dark" | "light";
  onion: OnionConfig;
  playback: { isPlaying: boolean; loop: boolean; range: { in: number; out: number } | null };
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
  curveVersion: 0,
  exportOpen: false,
  sizeDialog: { open: false, mode: "new" },
  theme: "dark",
  onion: {
    enabled: false,
    prev: 1,
    next: 1,
    allLayers: false,
    tintPrev: "#e0526a", // warm red
    tintNext: "#3f7fd0", // cool blue
  },
  playback: { isPlaying: false, loop: true, range: null },
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

/**
 * Snapshot of the document STRUCTURE (not pixels): the layer stack, each drawing layer's
 * cell track, plus frame count and cursor. Canvas references are SHARED — structural edits
 * never touch pixels, so undo only needs to restore which cells/layers exist where.
 */
export interface StructSnapshot {
  layers: Layer[];
  frameCount: number;
  width: number;
  height: number;
  activeLayerId: number;
  playhead: number;
}
function cloneLayers(layers: Layer[]): Layer[] {
  // Shallow per-layer clone with a fresh cells array (same cell + canvas refs), so later
  // in-place mutations (splice/replace) can't corrupt a stored snapshot.
  return layers.map((l) => (l.kind === "draw" ? { ...l, cells: l.cells.slice() } : { ...l }));
}
function snapshotStructure(): StructSnapshot {
  return {
    layers: cloneLayers(state.project.layers),
    frameCount: state.project.frameCount,
    width: state.project.width,
    height: state.project.height,
    activeLayerId: state.activeLayerId,
    playhead: state.playhead,
  };
}
function restoreStructure(s: StructSnapshot) {
  // Restore the layer set/order and each drawing layer's cells, but keep view-props
  // (visible/opacity/locked/name) from the LIVE layer when it still exists — those are
  // deliberately not part of undo, so an unrelated structural undo must not revert them.
  const liveById = new Map(state.project.layers.map((l) => [l.id, l]));
  state.project.layers = s.layers.map((snap) => {
    const live = liveById.get(snap.id);
    if (live) {
      if (live.kind === "draw" && snap.kind === "draw") live.cells = snap.cells.slice();
      return live;
    }
    // Layer was removed since the snapshot → bring back the snapshot's clone wholesale.
    return snap.kind === "draw" ? { ...snap, cells: snap.cells.slice() } : { ...snap };
  });
  state.project.frameCount = s.frameCount;
  state.project.width = s.width;
  state.project.height = s.height;
  state.activeLayerId = s.activeLayerId;
  state.playhead = s.playhead;
  state.version++;
}

/** Begin a multi-event structural edit (e.g. a drag): capture the before-state. */
export function beginStructuralEdit(): StructSnapshot {
  return snapshotStructure();
}

/** Finish a structural edit started with beginStructuralEdit: push one undo command. */
export function commitStructuralEdit(before: StructSnapshot): void {
  const after = snapshotStructure();
  history.push({
    undo: () => restoreStructure(before),
    redo: () => restoreStructure(after),
  });
}

/**
 * Run a synchronous structural mutation and make it undoable by snapshotting the document
 * structure before and after. Use for layer- and frame-level edits; pixel edits keep their
 * own getImageData/putImageData commands. Structural and pixel commands share the same undo
 * stack and interleave correctly because snapshots keep the same canvas references.
 */
export function commitStructural(mutate: () => void): void {
  const before = beginStructuralEdit();
  mutate();
  bump(); // refresh document length + clamp playhead, then bump version
  commitStructuralEdit(before);
}

/** Append a layer (drawing or reference) on top and make it active. */
export function addLayerToProject(layer: Layer) {
  commitStructural(() => {
    state.project.layers.push(layer);
    state.activeLayerId = layer.id;
  });
}

/** Remove a layer by id, keeping at least one drawing layer. */
export function removeLayer(id: number) {
  const layers = state.project.layers;
  const idx = layers.findIndex((l) => l.id === id);
  if (idx === -1) return;
  const drawingCount = layers.filter(isDrawingLayer).length;
  if (isDrawingLayer(layers[idx]) && drawingCount <= 1) return; // keep one drawing layer
  commitStructural(() => {
    layers.splice(idx, 1);
    if (state.activeLayerId === id) {
      const firstDrawing = layers.find(isDrawingLayer);
      if (firstDrawing) state.activeLayerId = firstDrawing.id;
    }
  });
}

/** Reorder the layer stack to exactly `ordered` (bottom→top) and repaint. */
export function reorderLayers(ordered: Layer[]) {
  commitStructural(() => {
    state.project.layers = ordered;
  });
}

/** Duplicate a drawing layer (cloning every key cell's canvas) above it, and make it active. */
export function duplicateLayer(id: number) {
  const layers = state.project.layers;
  const idx = layers.findIndex((l) => l.id === id);
  if (idx === -1) return;
  const src = layers[idx];
  if (!isDrawingLayer(src)) return; // only drawing layers duplicate (clone pixels)
  commitStructural(() => {
    const dup = createDrawingLayer(state.project.frameCount, `${src.name} copy`);
    dup.visible = src.visible;
    dup.locked = src.locked;
    dup.opacity = src.opacity;
    dup.cells = src.cells.map((c): Cell =>
      c.kind === "key" ? { kind: "key", canvas: cloneCanvas(c.canvas) } : { kind: "hold" }
    );
    layers.splice(idx + 1, 0, dup);
    state.activeLayerId = dup.id;
  });
}

/** Merge the drawing layer `id` down onto the drawing layer directly below it, then remove it. */
export function mergeDown(id: number) {
  const layers = state.project.layers;
  const idx = layers.findIndex((l) => l.id === id);
  if (idx <= 0) return; // nothing below
  const upper = layers[idx];
  const below = layers[idx - 1];
  if (!isDrawingLayer(upper) || !isDrawingLayer(below)) return;

  commitStructural(() => {
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
  });
}

/** Rename a layer in place. Not undoable (name is a view-prop, like visible/opacity). */
export function renameLayer(id: number, input: string) {
  const layer = state.project.layers.find((l) => l.id === id);
  if (!layer) return;
  layer.name = resolveLayerName(layer.name, input);
  bump();
}

/** Set/replace the project audio track (not undoable; persisted with the project). */
export function setAudioTrack(track: AudioTrack) {
  state.project.audio = track;
  audioEngine.setTrack(track);
  bump();
}
/** Remove the audio track. */
export function removeAudioTrack() {
  state.project.audio = null;
  audioEngine.setTrack(null);
  bump();
}

/** Set the animation's total length to `n` frames (clamped 1..9999). Extends layers by holding the
 *  last frame; shortens by trimming trailing cells. Undoable. */
export function setAnimationLength(n: number) {
  const target = Math.max(1, Math.min(9999, Math.floor(n)));
  if (target === state.project.frameCount) return;
  commitStructural(() => {
    for (const layer of state.project.layers) {
      if (layer.kind === "draw") layer.cells = resizeCells(layer.cells, target);
    }
  });
}

/**
 * Resize the document to `newW×newH`. Re-creates every keyframe canvas: `scale` fits the old art
 * (aspect-preserving), `crop` keeps its pixel size; the anchor positions it. One undo step.
 */
export function resizeProject(newW: number, newH: number, mode: ResizeMode, anchor: Anchor) {
  const w = Math.max(16, Math.min(8192, Math.round(newW)));
  const h = Math.max(16, Math.min(8192, Math.round(newH)));
  if (w === state.project.width && h === state.project.height) return;
  const rect = placeContent(state.project.width * DPR, state.project.height * DPR, w * DPR, h * DPR, mode, anchor);
  commitStructural(() => {
    for (const layer of state.project.layers) {
      if (layer.kind !== "draw") continue;
      // Replace cells (don't mutate cell.canvas) so the undo before-snapshot keeps the old canvases.
      layer.cells = layer.cells.map((c): Cell => {
        if (c.kind !== "key") return c;
        const nc = createCellCanvas(w, h, DPR);
        const ctx = nc.getContext("2d")!;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(c.canvas, rect.x, rect.y, rect.w, rect.h);
        return { kind: "key", canvas: nc };
      });
    }
    state.project.width = w;
    state.project.height = h;
  });
}

/** Toggle the eraser on/off, restoring the tool that was active before (for a quick gesture toggle). */
let toolBeforeEraser: Tool = "brush";
export function toggleEraser() {
  if (state.tool === "eraser") {
    state.tool = toolBeforeEraser === "eraser" ? "brush" : toolBeforeEraser;
  } else {
    toolBeforeEraser = state.tool;
    state.tool = "eraser";
  }
}

/** Signal that the (imperative) pressure curve changed, so the preferences save effect re-runs. */
export function bumpCurve() {
  state.curveVersion++;
}

/** Snapshot the persisted-preference fields from live state. */
export function gatherPreferences(): Preferences {
  void state.curveVersion; // track: the curve is imperative, so re-run the save effect on edits
  return {
    tool: state.tool,
    brush: { ...state.brush },
    brushType: state.brushType,
    sizeRange: state.sizeRange,
    streamline: state.streamline,
    fill: { ...state.fill },
    theme: state.theme,
    loop: state.playback.loop,
    pressureCurve: { cp1: { ...pressureCurve.cp1 }, cp2: { ...pressureCurve.cp2 } },
  };
}

/** Apply stored preferences over the current state, field-by-field with type guards. */
export function applyPreferences(p: Partial<Preferences>): void {
  if (p.tool) state.tool = p.tool;
  if (p.brush && typeof p.brush === "object") state.brush = { ...state.brush, ...p.brush };
  if (p.brushType) state.brushType = p.brushType;
  if (typeof p.sizeRange === "number") state.sizeRange = p.sizeRange;
  if (typeof p.streamline === "number") state.streamline = p.streamline;
  if (p.fill && typeof p.fill === "object") state.fill = { ...state.fill, ...p.fill };
  if (p.theme === "dark" || p.theme === "light") state.theme = p.theme;
  if (typeof p.loop === "boolean") state.playback.loop = p.loop;
  if (p.pressureCurve && typeof p.pressureCurve === "object") {
    const { cp1, cp2 } = p.pressureCurve;
    if (cp1 && typeof cp1.x === "number" && typeof cp1.y === "number") pressureCurve.cp1 = { x: cp1.x, y: cp1.y };
    if (cp2 && typeof cp2.x === "number" && typeof cp2.y === "number") pressureCurve.cp2 = { x: cp2.x, y: cp2.y };
    pressureCurve.buildLUT();
  }
}

/** Replace the whole document (e.g. after Open or autosave restore). */
export function replaceProject(project: Project) {
  playbackController.pause();
  history.clear(); // undo history from the old document can't apply to the new one
  state.project = project;
  audioEngine.setTrack(project.audio);
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
  getRangeStart: () => effectiveRange(state.playback.range, state.project.frameCount).start,
  getRangeEnd: () => effectiveRange(state.playback.range, state.project.frameCount).end,
  getLoop: () => state.playback.loop,
  getCurrent: () => state.playhead,
  setFrame: (f) => {
    if (state.playback.isPlaying && f !== state.playhead && f !== state.playhead + 1) audioEngine.syncTo(f, state.project.fps);
    state.playhead = f;
  },
  onPlayingChange: (p) => {
    state.playback.isPlaying = p;
    if (p) audioEngine.play(state.playhead, state.project.fps);
    else audioEngine.pause();
    state.version++;
  },
});

/** Set the play range's in-point to the current playhead (session-only, not undoable). */
export function setPlayRangeIn() {
  state.playback.range = withRangeIn(state.playback.range, state.playhead);
}
/** Set the play range's out-point to the current playhead (session-only, not undoable). */
export function setPlayRangeOut() {
  state.playback.range = withRangeOut(state.playback.range, state.playhead);
}
/** Clear the play range (back to full-timeline playback). */
export function clearPlayRange() {
  state.playback.range = null;
}

/**
 * Holder for the single Selection instance (created by Canvas.svelte on mount).
 * App.svelte reads it to handle Enter (commit) / Escape (cancel) globally.
 */
export const selectionRef: { current: Selection | null } = { current: null };

/** Canvas-owned selection actions reachable from App keyboard shortcuts (W/M warp). */
export const selectionActions: { enterWarp: ((rows: number, cols: number) => void) | null } = { enterWarp: null };

/** Shared pressure-response curve, remaps raw pen pressure before drawing. Imperative widget. */
export const pressureCurve = new PressureCurve();
