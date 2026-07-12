import {
  createProject,
  createCellCanvas,
  cloneCanvas,
  isDrawingLayer,
  createDrawingLayer,
  createReferenceLayer,
  resolveLayerName,
  refreshLength,
  resizeCells,
  nextId,
  nonEmptyGroups,
  mediaIntrinsicSize,
  isIdentityTransform,
  IDENTITY_TRANSFORM,
  resolvedKeyCell,
  type RefTransform,
  type Project,
  type Layer,
  type DrawingLayer,
  type Cell,
  type AudioTrack,
  type ReferenceLayer,
  type ReferenceMedia,
  type LayerGroup,
} from "../anim/document";
import {
  copyBlock,
  pasteBlockOverwrite,
  pasteBlockInsert,
  deleteBlock,
  moveBlockFrames,
  type CellBlock,
} from "../anim/timeline-block";
import {
  resolveSelectionRect,
  type SelectionEndpoint,
  type TimelineSelection,
} from "../anim/timeline-selection";
import { loadImageMedia, releaseReferenceMedia } from "../anim/reference";
import { drawReferenceMedia, drawCellComposed } from "../anim/render";
import { audioEngine } from "../audio/engine";
import { History } from "../anim/history";
import type { BrushSettings } from "../core/brush";
import type { BrushType } from "../core/brush-textures";
import { PressureCurve } from "../core/pressure-curve";

/** Brush selection: smooth (perfect-freehand), ink (incremental marker), or a textured stamp type. */
export type BrushKind = "smooth" | "ink" | BrushType;

/** Per-tool stroke settings (brush and eraser each hold one). `isEraser` is NOT stored — it's
 *  derived from the active tool at draw time. */
export type ToolSettings = Omit<BrushSettings, "isEraser"> & {
  sizeRange: number;
  streamline: number;
  brushType: BrushKind;
};
import { planMergeDown, type CanvasOps } from "../anim/timeline";
import { placeContent, type ResizeMode, type Anchor } from "../anim/resize";
import type { Selection } from "../core/selection";
import type { OnionConfig } from "../anim/onion";
import { Playback, effectiveRange, withRangeIn, withRangeOut } from "../anim/playback";
import type { Preferences } from "../persist/preferences";
import { clampTimelineHeight, DEFAULT_TIMELINE_HEIGHT } from "../anim/timeline-layout";

export type Tool =
  | "brush"
  | "eraser"
  | "fill"
  | "select"
  | "lasso"
  | "transform"
  | "eyedropper"
  | "deform"
  | "pose";

interface AnimState {
  project: Project;
  playhead: number; // current frame index
  activeLayerId: number;
  tool: Tool;
  transformScope: "frame" | "layer" | "group";
  brush: ToolSettings;
  eraser: ToolSettings;
  fill: { tolerance: number; expand: number };
  /** Bumped whenever the document changes so the canvas recomposites. */
  version: number;
  /** Bumped when the pressure curve is edited (it's an imperative widget, not reactive state). */
  curveVersion: number;
  exportOpen: boolean;
  settingsOpen: boolean;
  sizeDialog: { open: boolean; mode: "new" | "resize" };
  theme: "dark" | "light";
  onion: OnionConfig;
  playback: { isPlaying: boolean; loop: boolean; range: { in: number; out: number } | null };
  statusHint: string; // description of the hovered/pressed control (from its title=); "" when idle
  timelineHeight: number; // px height of the resizable timeline panel
  timelineSelection: TimelineSelection | null;
  cellClipboard: CellBlock | null;
  selectionActive: boolean; // a committed canvas marquee exists (drives ToolOptions Copy/Cut/Delete)
  hasPixelClipboard: boolean; // the pixel selection clipboard has content (drives ToolOptions Paste)
}

const project = createProject();

export const state: AnimState = $state({
  project,
  playhead: 0,
  activeLayerId: project.layers[0].id,
  tool: "brush",
  transformScope: "frame",
  brush: {
    size: 4,
    color: "#1a1a1a",
    opacity: 100,
    smoothing: 50,
    drawBehind: false,
    alphaLock: false,
    taper: false,
    sizeRange: 3.0, // full pen pressure → 3× the base width (light pressure → base)
    streamline: 50,
    brushType: "smooth",
  },
  eraser: {
    size: 8,
    color: "#000000", // unused (eraser composites destination-out)
    opacity: 100,
    smoothing: 50,
    drawBehind: false,
    alphaLock: false,
    taper: false,
    sizeRange: 3.0,
    streamline: 50,
    brushType: "smooth",
  },
  fill: { tolerance: 32, expand: 2 },
  version: 0,
  curveVersion: 0,
  exportOpen: false,
  settingsOpen: false,
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
  statusHint: "",
  timelineHeight: DEFAULT_TIMELINE_HEIGHT,
  timelineSelection: null,
  cellClipboard: null,
  selectionActive: false,
  hasPixelClipboard: false,
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

/** The stroke settings for the active drawing tool (eraser has its own; everything else uses brush). */
export function activeStroke(): ToolSettings {
  return state.tool === "eraser" ? state.eraser : state.brush;
}

/**
 * Snapshot of the document STRUCTURE (not pixels): the layer stack, each drawing layer's
 * cell track, plus frame count and cursor. Canvas references are SHARED — structural edits
 * never touch pixels, so undo only needs to restore which cells/layers exist where.
 */
export interface StructSnapshot {
  layers: Layer[];
  groups: LayerGroup[];
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
    groups: state.project.groups.map((g) => ({
      ...g,
      transform: g.transform ? { ...g.transform } : undefined,
      transformBox: g.transformBox ? { ...g.transformBox } : g.transformBox,
    })),
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
    if (live && live.kind === snap.kind) {
      live.groupId = snap.groupId; // group membership is structural (reorder/regroup), undoable — not a view-prop
      if (live.kind === "draw" && snap.kind === "draw") {
        live.cells = snap.cells.slice();
        live.transform = { ...snap.transform }; // transform is undoable (Apply/Reset change it with cells)
      }
      return live;
    }
    // Layer was removed, OR its kind changed since the snapshot (e.g. rasterize ref→draw, same id) →
    // bring back the snapshot's clone wholesale so undo restores the original layer.
    return snap.kind === "draw" ? { ...snap, cells: snap.cells.slice() } : { ...snap };
  });
  const liveGroupsById = new Map(state.project.groups.map((g) => [g.id, g]));
  state.project.groups = s.groups.map((snap) => {
    const live = liveGroupsById.get(snap.id);
    if (live) {
      live.transform = snap.transform ? { ...snap.transform } : undefined;
      live.transformBox = snap.transformBox ? { ...snap.transformBox } : snap.transformBox;
      // name/collapsed/visible are view-props — keep `live` values (mirror layer pattern).
      return live;
    }
    return {
      ...snap,
      transform: snap.transform ? { ...snap.transform } : undefined,
      transformBox: snap.transformBox ? { ...snap.transformBox } : snap.transformBox,
    };
  });
  state.project.frameCount = s.frameCount;
  if (s.width !== state.project.width || s.height !== state.project.height)
    state.cellClipboard = null; // clipboard canvases belong to the old document size; drop on a size-changing undo/redo
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
  state.timelineSelection = null; // any structural edit can invalidate stored endpoints
  commitStructuralEdit(before);
}

/** Append a layer (drawing or reference) on top and make it active. */
export function addLayerToProject(layer: Layer) {
  commitStructural(() => {
    const active = state.project.layers.find((l) => l.id === state.activeLayerId);
    if (active && active.groupId != null) {
      // Active layer is in a group → the new layer joins that group, inserted just above the active
      // one (keeps the group's contiguous run intact).
      layer.groupId = active.groupId;
      state.project.layers.splice(state.project.layers.indexOf(active) + 1, 0, layer);
    } else {
      state.project.layers.push(layer); // ungrouped → top of the stack (existing behavior)
    }
    setActiveLayer(layer.id);
  });
}

/** Paste a clipboard image blob as a new, fully-opaque image reference layer (auto-selected). */
export async function pasteImageReference(blob: Blob): Promise<void> {
  // loadImageMedia reads file.name only for its error message — wrap the blob in a File.
  const file = new File([blob], "Pasted image", { type: blob.type || "image/png" });
  const media = await loadImageMedia(file);
  const layer = createReferenceLayer(media, "Pasted image");
  layer.opacity = 100; // content, not a dimmed trace underlay (ref default is 60)
  addLayerToProject(layer);
}

/** Replace an image reference layer in place with a drawing layer baked at its current transform. */
export function rasterizeReference(layerId: number): void {
  commitStructural(() => {
    const layers = state.project.layers;
    const idx = layers.findIndex((l) => l.id === layerId);
    const ref = layers[idx];
    if (!ref || ref.kind !== "ref" || ref.media.type !== "image") return; // image refs only
    if (mediaIntrinsicSize(ref.media).w === 0) return; // media not loaded

    const cell = createCellCanvas(state.project.width, state.project.height, DPR);
    const ctx = cell.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0); // helper draws in device pixels
    drawReferenceMedia(ctx, ref, state.project.width, state.project.height, DPR);

    // Replace in place: keep id/name/group/opacity/visibility; one keyframe at frame 0 (holds after)
    // so the image shows on every frame. Off-canvas pixels are clipped (the accepted commit trade).
    const dl = createDrawingLayer(state.project.frameCount, ref.name);
    dl.id = ref.id;
    dl.groupId = ref.groupId;
    dl.opacity = ref.opacity;
    dl.visible = ref.visible;
    dl.cells[0] = { kind: "key", canvas: cell };
    layers[idx] = dl;
    setActiveLayer(dl.id);
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
      if (firstDrawing) setActiveLayer(firstDrawing.id);
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
    dup.boilStrength = src.boilStrength; // match the source's line-boil strength
    dup.groupId = src.groupId; // keep the copy in the source's group (inserted adjacent → run stays contiguous)
    dup.transform = { ...src.transform }; // copy renders at the same placement as the source
    dup.cells = src.cells.map(
      (c): Cell =>
        c.kind === "key"
          ? {
              kind: "key",
              canvas: cloneCanvas(c.canvas),
              transform: c.transform ? { ...c.transform } : undefined, // keep per-cell transforms
              transformBox: c.transformBox ? { ...c.transformBox } : c.transformBox,
            }
          : { kind: "hold" },
    );
    layers.splice(idx + 1, 0, dup);
    setActiveLayer(dup.id);
  });
}

/** Flatten a key cell through (layerT ∘ its own cellT) into fresh pixels at identity. */
function bakeCell(
  cell: Extract<Cell, { kind: "key" }>,
  layerT: RefTransform,
): Extract<Cell, { kind: "key" }> {
  const W = state.project.width,
    H = state.project.height;
  const cellT = cell.transform ?? IDENTITY_TRANSFORM;
  if (isIdentityTransform(layerT) && isIdentityTransform(cellT)) return cell;
  const canvas = createCellCanvas(W, H, DPR);
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const boxDev = isIdentityTransform(cellT)
    ? { x: 0, y: 0, w: W * DPR, h: H * DPR }
    : {
        x: cell.transformBox!.x * DPR,
        y: cell.transformBox!.y * DPR,
        w: cell.transformBox!.w * DPR,
        h: cell.transformBox!.h * DPR,
      };
  drawCellComposed(ctx, cell.canvas, W * DPR, H * DPR, layerT, cellT, boxDev, DPR);
  return { kind: "key", canvas };
}

/** Bake a draw layer's transform into its cells and reset to identity. No commit (caller wraps it). */
function bakeLayerTransform(layer: DrawingLayer): void {
  layer.cells = layer.cells.map((c) => (c.kind === "key" ? bakeCell(c, layer.transform) : c));
  layer.transform = { ...IDENTITY_TRANSFORM };
}

export function applyLayerTransform(layerId: number): void {
  const layer = state.project.layers.find((l) => l.id === layerId);
  if (!layer || layer.kind !== "draw" || isIdentityTransform(layer.transform)) return;
  commitStructural(() => bakeLayerTransform(layer));
}

export function resetLayerTransform(layerId: number): void {
  const layer = state.project.layers.find((l) => l.id === layerId);
  if (!layer || layer.kind !== "draw" || isIdentityTransform(layer.transform)) return;
  commitStructural(() => {
    layer.transform = { ...IDENTITY_TRANSFORM };
  });
}

export function applyCellTransform(layerId: number, frame: number): void {
  const layer = state.project.layers.find((l) => l.id === layerId);
  if (!layer || layer.kind !== "draw") return;
  const rk = resolvedKeyCell(layer, frame);
  if (!rk || !rk.cell.transform || isIdentityTransform(rk.cell.transform)) return;
  commitStructural(() => {
    layer.cells[rk.index] = bakeCell(rk.cell, { ...IDENTITY_TRANSFORM });
  });
}

export function resetCellTransform(layerId: number, frame: number): void {
  const layer = state.project.layers.find((l) => l.id === layerId);
  if (!layer || layer.kind !== "draw") return;
  const rk = resolvedKeyCell(layer, frame);
  if (!rk) return;
  commitStructural(() => {
    // Replace the cell (don't mutate it in place): snapshots share cell object refs, so an in-place
    // edit would corrupt the before-snapshot and make undo a no-op. Drop the transform, keep the canvas.
    layer.cells[rk.index] = { kind: "key", canvas: rk.cell.canvas };
  });
}

export function resetGroupTransform(groupId: number): void {
  const g = state.project.groups.find((x) => x.id === groupId);
  if (!g || !g.transform || isIdentityTransform(g.transform)) return;
  commitStructural(() => {
    g.transform = { ...IDENTITY_TRANSFORM };
    g.transformBox = null;
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
    bakeLayerTransform(upper);
    bakeLayerTransform(below);
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
    setActiveLayer(below.id);
  });
}

/** Rename a layer in place. Not undoable (name is a view-prop, like visible/opacity). */
export function renameLayer(id: number, input: string) {
  const layer = state.project.layers.find((l) => l.id === id);
  if (!layer) return;
  layer.name = resolveLayerName(layer.name, input);
  bump();
}

/** Create a group from the active layer (a run of one); removes it from any prior group. */
export function groupActiveLayer() {
  const layer = state.project.layers.find((l) => l.id === state.activeLayerId);
  if (!layer) return;
  const g: LayerGroup = {
    id: nextId(),
    name: `Group ${state.project.groups.length + 1}`,
    collapsed: false,
    visible: true,
  };
  state.project.groups.push(g);
  layer.groupId = g.id;
  state.project.groups = nonEmptyGroups(state.project.groups, state.project.layers); // drop the layer's prior group if now empty
  bump();
}
/** Ungroup: clear members' groupId, remove the group. */
export function ungroup(groupId: number) {
  for (const l of state.project.layers) if (l.groupId === groupId) l.groupId = null;
  state.project.groups = state.project.groups.filter((g) => g.id !== groupId);
  // Don't leave the Transform tool in Group scope with no group (mirror setActiveLayer's guard).
  const al = state.project.layers.find((l) => l.id === state.activeLayerId);
  if (state.transformScope === "group" && (!al || al.groupId == null)) {
    state.transformScope = "frame";
  }
  bump();
}
export function toggleGroupCollapsed(groupId: number) {
  const g = state.project.groups.find((x) => x.id === groupId);
  if (g) {
    g.collapsed = !g.collapsed;
    bump();
  }
}
export function toggleGroupVisible(groupId: number) {
  const g = state.project.groups.find((x) => x.id === groupId);
  if (g) {
    g.visible = !g.visible;
    bump();
  }
}
export function renameGroup(groupId: number, name: string) {
  const g = state.project.groups.find((x) => x.id === groupId);
  const n = name.trim();
  if (g && n) {
    g.name = n;
    bump();
  }
}
/** Apply a dragged display→data order with per-layer groupId, as one undoable step; prune empty groups. */
export function reorderLayersWithGroups(order: { id: number; groupId: number | null }[]) {
  // No-op guard: a cross-list drag fires SortableJS onEnd on both source and destination, so the
  // rebuild can run twice with the same final order — skip when nothing actually changed (also
  // avoids a redundant undo step).
  const cur = state.project.layers;
  if (
    order.length === cur.length &&
    order.every((e, i) => cur[i].id === e.id && cur[i].groupId === e.groupId)
  )
    return;
  const before = beginStructuralEdit();
  const byId = new Map(state.project.layers.map((l) => [l.id, l]));
  const next: Layer[] = [];
  for (const e of order) {
    const l = byId.get(e.id);
    if (l) {
      l.groupId = e.groupId;
      next.push(l);
    }
  }
  state.project.layers = next;
  state.project.groups = nonEmptyGroups(state.project.groups, state.project.layers);
  bump();
  commitStructuralEdit(before);
}

/** Replace a reference layer's media (e.g. re-linking a persisted placeholder), keeping its
 *  name/opacity/visibility/offset/transform. Not undoable. */
export function relinkReference(id: number, media: ReferenceMedia) {
  const layer = state.project.layers.find((l) => l.id === id);
  if (layer && layer.kind === "ref") {
    releaseReferenceMedia(layer.media); // free the old media (this is not undoable)
    layer.media = media;
    bump();
  }
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
  state.timelineSelection = null;
  state.cellClipboard = null; // clipboard canvases belong to the old document size
  liftGuard.discard?.(); // a live lift's captured cell canvas is about to be replaced
  const rect = placeContent(
    state.project.width * DPR,
    state.project.height * DPR,
    w * DPR,
    h * DPR,
    mode,
    anchor,
  );
  commitStructural(() => {
    for (const layer of state.project.layers) {
      if (layer.kind !== "draw") continue;
      // Replace cells (don't mutate cell.canvas) so the undo before-snapshot keeps the old canvases.
      layer.cells = layer.cells.map((c): Cell => {
        if (c.kind !== "key") return c;
        // Bake any per-cell transform into pixels first (at the current dims) so resize preserves the
        // transformed look instead of silently dropping it. bakeCell returns c unchanged if identity.
        const src = bakeCell(c, IDENTITY_TRANSFORM).canvas;
        const nc = createCellCanvas(w, h, DPR);
        const ctx = nc.getContext("2d")!;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(src, rect.x, rect.y, rect.w, rect.h);
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

let toolBeforeEyedropper: Tool = "brush";
export function selectEyedropper() {
  if (state.tool === "eyedropper") return; // already active → no-op
  toolBeforeEyedropper = state.tool;
  state.tool = "eyedropper";
}
/** Set the brush color from a sampled pixel, then return to the pre-eyedropper tool. */
export function applyEyedropper(hex: string) {
  state.brush.color = hex;
  state.tool = toolBeforeEyedropper === "eyedropper" ? "brush" : toolBeforeEyedropper;
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
    eraser: { ...state.eraser },
    fill: { ...state.fill },
    theme: state.theme,
    loop: state.playback.loop,
    timelineHeight: state.timelineHeight,
    pressureCurve: { cp1: { ...pressureCurve.cp1 }, cp2: { ...pressureCurve.cp2 } },
  };
}

/** Apply stored preferences over the current state, field-by-field with type guards. */
export function applyPreferences(p: Partial<Preferences>): void {
  if (p.tool) state.tool = p.tool;
  if (p.brush && typeof p.brush === "object") state.brush = { ...state.brush, ...p.brush };
  if (p.eraser && typeof p.eraser === "object") state.eraser = { ...state.eraser, ...p.eraser };
  // Back-compat: older saves wrote brushType/sizeRange/streamline at the top level → onto the brush.
  if (p.brushType) state.brush.brushType = p.brushType;
  if (typeof p.sizeRange === "number") state.brush.sizeRange = p.sizeRange;
  if (typeof p.streamline === "number") state.brush.streamline = p.streamline;
  if (p.fill && typeof p.fill === "object") state.fill = { ...state.fill, ...p.fill };
  if (p.theme === "dark" || p.theme === "light") state.theme = p.theme;
  if (typeof p.loop === "boolean") state.playback.loop = p.loop;
  if (typeof p.timelineHeight === "number")
    state.timelineHeight = clampTimelineHeight(p.timelineHeight, window.innerHeight);
  if (p.pressureCurve && typeof p.pressureCurve === "object") {
    const { cp1, cp2 } = p.pressureCurve;
    if (cp1 && typeof cp1.x === "number" && typeof cp1.y === "number")
      pressureCurve.cp1 = { x: cp1.x, y: cp1.y };
    if (cp2 && typeof cp2.x === "number" && typeof cp2.y === "number")
      pressureCurve.cp2 = { x: cp2.x, y: cp2.y };
    pressureCurve.buildLUT();
  }
}

/** Replace the whole document (e.g. after Open or autosave restore). */
export function replaceProject(project: Project) {
  state.timelineSelection = null;
  state.cellClipboard = null; // clipboard canvases belong to the old document size
  liftGuard.discard?.(); // clear any in-progress lift before the old document is thrown away
  playbackController.pause();
  history.clear(); // undo history from the old document can't apply to the new one
  for (const l of state.project.layers) if (l.kind === "ref") releaseReferenceMedia(l.media);
  state.project = project;
  audioEngine.setTrack(project.audio);
  state.playhead = 0;
  const firstDrawing = project.layers.find(isDrawingLayer) ?? project.layers[0];
  setActiveLayer(firstDrawing.id);
  bump();
}

export function bump() {
  refreshLength(state.project);
  const last = state.project.frameCount - 1;
  if (state.playhead > last) state.playhead = last;
  if (state.playhead < 0) state.playhead = 0;
  state.version++;
}

/** Video ref elements in the current project. */
function videoRefEls(): HTMLVideoElement[] {
  return state.project.layers
    .filter((l): l is ReferenceLayer => l.kind === "ref" && l.media.type === "video")
    .map((l) => (l.media as { el: HTMLVideoElement }).el);
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
    if (state.playback.isPlaying && f !== state.playhead && f !== state.playhead + 1)
      audioEngine.syncTo(f, state.project.fps);
    state.playhead = f;
  },
  onPlayingChange: (p) => {
    state.playback.isPlaying = p;
    if (p) {
      audioEngine.play(state.playhead, state.project.fps);
      for (const l of state.project.layers) {
        if (l.kind !== "ref" || l.media.type !== "video") continue;
        const el = l.media.el;
        el.currentTime = (state.playhead + l.offsetFrames) / state.project.fps; // seek onto the frame, then run
        void el.play().catch(() => {});
      }
    } else {
      audioEngine.pause();
      for (const el of videoRefEls()) el.pause(); // next tick exact-seeks onto the paused frame
    }
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

/** Canvas-owned selection actions reachable from App keyboard shortcuts + the action bar. */
export const selectionActions: {
  enterWarp: ((rows: number, cols: number) => void) | null;
  copy: (() => void) | null;
  cut: (() => void) | null;
  del: (() => void) | null;
  paste: (() => boolean) | null;
} = { enterWarp: null, copy: null, cut: null, del: null, paste: null };

/** Canvas-owned Pose-tool actions for App's Enter (apply) / Escape (cancel) keys. */
export const poseActions: { active: () => boolean; apply: () => void; cancel: () => void } = {
  active: () => false,
  apply: () => {},
  cancel: () => {},
};

/** Canvas registers a discard-the-active-lift callback here. Call it BEFORE any operation that
 *  recreates/removes the active key cell's canvas or replays the history (resize, replaceProject,
 *  set-hold/delete-frame on the active cell, undo/redo) — otherwise a live selection/deform/pose lift
 *  would commit to a detached canvas or corrupt the undo baseline. */
export const liftGuard: { discard: (() => void) | null } = { discard: null };

/** Undo/redo, discarding any in-progress lift first (its captured context/baseline would be stale). */
export function undo(): void {
  liftGuard.discard?.();
  history.undo();
  state.timelineSelection = null; // a structural restore can invalidate stored endpoints
}
export function redo(): void {
  liftGuard.discard?.();
  history.redo();
  state.timelineSelection = null;
}

/** Shared pressure-response curve, remaps raw pen pressure before drawing. Imperative widget. */
export const pressureCurve = new PressureCurve();

/**
 * Set the active layer. If transformScope is "group" and the new layer is not in a group,
 * fall back to "frame" scope so the disabled Group button can't stay selected silently.
 */
export function setActiveLayer(id: number): void {
  state.activeLayerId = id;
  const l = state.project.layers.find((x) => x.id === id);
  if (state.transformScope === "group" && (!l || l.groupId == null)) {
    state.transformScope = "frame";
  }
  // In single-layer onion mode the ghosts track the active layer, so the display must recomposite.
  if (state.onion.enabled && !state.onion.allLayers) state.version++;
}

export function setTimelineSelection(anchor: SelectionEndpoint, focus: SelectionEndpoint): void {
  state.timelineSelection = { anchor, focus };
}

export function clearTimelineSelection(): void {
  state.timelineSelection = null;
}

function currentSelectionRect() {
  const sel = state.timelineSelection;
  return sel ? resolveSelectionRect(state.project.layers, sel.anchor, sel.focus) : null;
}

/** Copy the current timeline selection into the internal cell clipboard (non-undoable). */
export function copyTimelineSelection(): void {
  const rect = currentSelectionRect();
  if (!rect) return;
  state.cellClipboard = copyBlock(
    state.project,
    rect.layerIds,
    rect.startFrame,
    rect.endFrame,
    canvasOps,
  );
}

/** Replace the selected region with holds (undoable). */
export function deleteTimelineSelection(): void {
  const rect = currentSelectionRect();
  if (!rect) return;
  liftGuard.discard?.(); // may replace the active cell's canvas → discard any live lift first
  commitStructural(() => deleteBlock(state.project, rect.layerIds, rect.startFrame, rect.endFrame));
}

/** Cut = copy then delete. */
export function cutTimelineSelection(): void {
  copyTimelineSelection();
  deleteTimelineSelection();
}

/** Move the current timeline selection by `delta` frames (frames-only, overwrite). Undoable; the
 *  selection follows to the moved range. No-op if there's no selection or the clamped delta is 0. */
export function moveTimelineSelection(delta: number): void {
  const rect = currentSelectionRect();
  if (!rect) return;
  const applied = Math.max(delta, -rect.startFrame); // clamp before committing so a no-op doesn't push undo
  if (applied === 0) return;
  liftGuard.discard?.(); // may replace the active cell's canvas → discard any live lift first
  commitStructural(() =>
    moveBlockFrames(
      state.project,
      rect.layerIds,
      rect.startFrame,
      rect.endFrame,
      applied,
      canvasOps,
    ),
  );
  // commitStructural cleared the selection — re-set it to the moved range (same layers).
  state.timelineSelection = {
    anchor: { layerId: rect.layerIds[0], frame: rect.startFrame + applied },
    focus: { layerId: rect.layerIds[rect.layerIds.length - 1], frame: rect.endFrame + applied },
  };
}

/** Paste the clipboard block with its top-left at (active layer, playhead). Overwrite by default;
 *  `insert = true` ripples the pasted layers right. Undoable. */
export function pasteCells(insert = false): void {
  const block = state.cellClipboard;
  if (!block) return;
  const active = state.project.layers.find((l) => l.id === state.activeLayerId);
  if (!active || active.kind !== "draw") return; // paste anchors on a drawing layer only
  liftGuard.discard?.(); // may replace the active cell's canvas → discard any live lift first
  commitStructural(() => {
    if (insert)
      pasteBlockInsert(state.project, block, state.activeLayerId, state.playhead, canvasOps);
    else pasteBlockOverwrite(state.project, block, state.activeLayerId, state.playhead, canvasOps);
  });
}
