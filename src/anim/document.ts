export type Cell =
  | {
      kind: "key";
      canvas: HTMLCanvasElement;
      transform?: RefTransform;
      transformBox?: { x: number; y: number; w: number; h: number } | null;
    }
  | { kind: "hold" };

/** Line-boil settings, persisted per project. */
export interface BoilConfig {
  enabled: boolean;
  amount: number; // displacement px
  cols: number; // noise detail (frequency across the canvas)
  rate: number; // cycle length (on twos/threes)
  weight: number; // line-weight breathing (0..1, in-shader alpha dilate/erode)
  holdsOnly: boolean;
}
export function defaultBoilConfig(): BoilConfig {
  return { enabled: false, amount: 1, cols: 20, rate: 3, weight: 0.4, holdsOnly: true };
}

export interface LayerGroup {
  id: number;
  name: string;
  collapsed: boolean;
  visible: boolean;
  transform?: RefTransform;
  transformBox?: { x: number; y: number; w: number; h: number } | null;
}

export interface DrawingLayer {
  kind: "draw";
  id: number;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number; // 0..100
  boilStrength: number; // per-layer multiplier on boil amount/weight (1 = full, 0 = none)
  groupId: number | null;
  cells: Cell[]; // independent per-layer length; document length = the longest layer
  transform: RefTransform;
}

export type ReferenceMedia =
  | { type: "image"; el: HTMLImageElement }
  | { type: "video"; el: HTMLVideoElement }
  | { type: "missing"; was: "image" | "video"; name: string };

export interface RefTransform {
  dx: number; // translate from fit-center, document logical px
  dy: number;
  scale: number; // uniform multiplier on the fit size (1 = fit)
  rotation: number; // radians, clockwise, about the center
}

export interface ReferenceLayer {
  kind: "ref";
  id: number;
  name: string;
  visible: boolean;
  opacity: number; // 0..100
  offsetFrames: number; // video time offset in frames; ignored for images
  groupId: number | null;
  media: ReferenceMedia;
  transform: RefTransform;
}

export type Layer = DrawingLayer | ReferenceLayer;

export const IDENTITY_TRANSFORM: RefTransform = { dx: 0, dy: 0, scale: 1, rotation: 0 };

export function isIdentityTransform(t: RefTransform): boolean {
  return t.dx === 0 && t.dy === 0 && t.scale === 1 && t.rotation === 0;
}

/** Logical base rect for a layer's transform: the full document for a draw layer; the media
 *  contain-fit rect for a ref (null when the ref's media isn't loaded). */
export function transformBaseRect(
  layer: Layer,
  docW: number,
  docH: number,
): { x: number; y: number; w: number; h: number } | null {
  if (layer.kind === "draw") return { x: 0, y: 0, w: docW, h: docH };
  const size = mediaIntrinsicSize(layer.media);
  if (size.w === 0 || size.h === 0) return null;
  return containRect(size.w, size.h, docW, docH);
}

export interface AudioTrack {
  name: string; // file name (display)
  bytes: Uint8Array; // original encoded file -> persisted
  buffer: AudioBuffer; // decoded PCM -> session-only, rebuilt on load
  offsetFrames: number; // start frame (Phase 1: always 0)
  muted: boolean; // Phase 1: always false
}

export function isDrawingLayer(l: Layer): l is DrawingLayer {
  return l.kind === "draw";
}

export interface Project {
  width: number;
  height: number;
  fps: number;
  bgColor: string;
  /** When true, the document has NO opaque background: the editor shows a checkerboard and PNG export
   *  carries alpha. Video export still flattens onto `bgColor`. Absent/undefined = opaque (default). */
  transparentBg?: boolean;
  frameCount: number;
  boil: BoilConfig;
  groups: LayerGroup[];
  layers: Layer[]; // layers[0] = bottom of the stack
  audio: AudioTrack | null;
}

/**
 * Index of the keyframe shown at `frame` on this cell track: the nearest "key" cell at
 * or before `frame`. Returns null when `frame` is past this track's end (blank after end)
 * or no key precedes it.
 */
export function resolveKeyframeIndex(cells: Cell[], frame: number): number | null {
  if (frame < 0 || frame >= cells.length) return null;
  for (let i = frame; i >= 0; i--) {
    if (cells[i].kind === "key") return i;
  }
  return null;
}

/** A key cell's own transform (identity when absent / not a key). */
export function cellTransform(cell: Cell): RefTransform {
  return cell.kind === "key" && cell.transform ? cell.transform : IDENTITY_TRANSFORM;
}

/** A group's own transform (identity when absent / undefined group). */
export function groupTransform(group: LayerGroup | null | undefined): RefTransform {
  return group && group.transform ? group.transform : IDENTITY_TRANSFORM;
}

/** The resolved key cell shown at `frame` (follows holds), or null. */
export function resolvedKeyCell(
  layer: DrawingLayer,
  frame: number,
): { cell: Extract<Cell, { kind: "key" }>; index: number } | null {
  const ki = resolveKeyframeIndex(layer.cells, frame);
  if (ki === null) return null;
  const cell = layer.cells[ki];
  return cell.kind === "key" ? { cell, index: ki } : null;
}

/** With holds-only boil, a frame that IS its own keyframe renders crisp (un-boiled). */
export function isCrispFrame(cells: Cell[], frame: number, holdsOnly: boolean): boolean {
  return holdsOnly && cells[frame]?.kind === "key";
}

export type FrameOp =
  | { kind: "draw"; layerId: number; keyframeIndex: number; opacity: number }
  | { kind: "ref"; layerId: number; opacity: number };

/**
 * Ordered (bottom→top) list of what each visible layer contributes at `frame`.
 * Reference layers are omitted when `includeReference` is false (used by export and onion).
 */
export function buildFrameDrawList(
  project: Project,
  frame: number,
  includeReference = true,
): FrameOp[] {
  const ops: FrameOp[] = [];
  for (const layer of project.layers) {
    if (!isLayerVisible(layer, project.groups)) continue;
    if (layer.kind === "draw") {
      const ki = resolveKeyframeIndex(layer.cells, frame);
      if (ki === null) continue;
      ops.push({ kind: "draw", layerId: layer.id, keyframeIndex: ki, opacity: layer.opacity });
    } else {
      if (!includeReference) continue;
      ops.push({ kind: "ref", layerId: layer.id, opacity: layer.opacity });
    }
  }
  return ops;
}

/** The group a layer belongs to, or null when ungrouped or its groupId is dangling. */
export function groupOf(layer: Layer, groups: LayerGroup[]): LayerGroup | null {
  if (layer.groupId == null) return null;
  return groups.find((g) => g.id === layer.groupId) ?? null;
}

/** A layer renders only when itself visible and its group (if any) is visible. */
export function isLayerVisible(layer: Layer, groups: LayerGroup[]): boolean {
  if (!layer.visible) return false;
  const g = groupOf(layer, groups);
  return !g || g.visible;
}

/** Groups that have at least one member layer (drops empties for the panel). */
export function nonEmptyGroups(groups: LayerGroup[], layers: Layer[]): LayerGroup[] {
  const used = new Set(layers.map((l) => l.groupId).filter((id): id is number => id != null));
  return groups.filter((g) => used.has(g.id));
}

/** Document length = the longest drawing layer's cell count (reference layers ignored), floor 1. */
export function documentLength(project: Project): number {
  let max = 1;
  for (const layer of project.layers) {
    if (layer.kind === "draw") max = Math.max(max, layer.cells.length);
  }
  return max;
}

/** Recompute and store the document length into `project.frameCount`. */
export function refreshLength(project: Project): void {
  project.frameCount = documentLength(project);
}

/** Resize a cells array to exactly `n`: pad with holds when growing, slice when shrinking. */
export function resizeCells(cells: Cell[], n: number): Cell[] {
  if (n <= cells.length) return cells.slice(0, n);
  const pad: Cell[] = Array.from({ length: n - cells.length }, () => ({ kind: "hold" }));
  return cells.concat(pad);
}

/** Count keyframes at index >= n across all drawing layers (those a shorten-to-n would drop). */
export function countKeyframesPastLength(project: Project, n: number): number {
  let count = 0;
  for (const layer of project.layers) {
    if (layer.kind !== "draw") continue;
    for (let i = n; i < layer.cells.length; i++) {
      if (layer.cells[i].kind === "key") count++;
    }
  }
  return count;
}

/** Aspect-preserving "contain" fit of a `srcW×srcH` source centred in a `boxW×boxH` box. */
export function containRect(
  srcW: number,
  srcH: number,
  boxW: number,
  boxH: number,
): { x: number; y: number; w: number; h: number } {
  if (srcW <= 0 || srcH <= 0) return { x: 0, y: 0, w: boxW, h: boxH };
  const scale = Math.min(boxW / srcW, boxH / srcH);
  const w = srcW * scale;
  const h = srcH * scale;
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h };
}

/** Intrinsic pixel size of reference media (0 until loaded). */
export function mediaIntrinsicSize(media: ReferenceMedia): { w: number; h: number } {
  if (media.type === "image") return { w: media.el.naturalWidth, h: media.el.naturalHeight };
  if (media.type === "video") return { w: media.el.videoWidth, h: media.el.videoHeight };
  return { w: 0, h: 0 }; // missing placeholder — skipped by every zero-size guard
}

/** Devicepixel-ratio-aware blank canvas sized to the document, with a dpr-scaled 2D context. */
export function createCellCanvas(width: number, height: number, dpr: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return canvas;
}

/**
 * Pixel-for-pixel copy of a cell canvas. NOTE: the returned canvas's 2D context is
 * left at the identity transform (not dpr-scaled like createCellCanvas). Callers that
 * draw onto it in logical coordinates must `setTransform(dpr,0,0,dpr,0,0)` first — the
 * editor's stroke path (Canvas.svelte) already does this before every drawStroke.
 */
export function cloneCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const dst = document.createElement("canvas");
  dst.width = src.width;
  dst.height = src.height;
  dst.getContext("2d")!.drawImage(src, 0, 0);
  return dst;
}

// Monotonic id source for the in-memory session. NOTE: when project save/load
// arrives (a later plan), this will need seeding from the loaded max id to avoid
// colliding with persisted layer ids.
let nextLayerId = 1;

/** Raise the layer-id counter so future ids don't collide with a loaded project's ids. */
export function setMinLayerId(n: number): void {
  if (n > nextLayerId) nextLayerId = n;
}

export function nextId(): number {
  return nextLayerId++;
}

/**
 * Create a drawing layer whose cells all start as `hold`. This is intentional:
 * a new layer is empty until the first stroke, at which point the editor promotes
 * the touched cell to a `key` (see timeline.ensureDrawableKeyframe). So a freshly
 * created project contributes nothing to `buildFrameDrawList` until something is drawn.
 */
export function createDrawingLayer(frameCount: number, name?: string): DrawingLayer {
  const id = nextLayerId++;
  return {
    kind: "draw",
    id,
    name: name ?? `Layer ${id}`,
    visible: true,
    locked: false,
    opacity: 100,
    boilStrength: 1,
    groupId: null,
    cells: Array.from({ length: frameCount }, () => ({ kind: "hold" }) as Cell),
    transform: { ...IDENTITY_TRANSFORM },
  };
}

/** A reference layer defaults to faint (60%) so the artist's ink reads over it. */
export function createReferenceLayer(media: ReferenceMedia, name?: string): ReferenceLayer {
  const id = nextLayerId++;
  return {
    kind: "ref",
    id,
    name: name ?? `Reference ${id}`,
    visible: true,
    opacity: 60,
    offsetFrames: 0,
    groupId: null,
    media,
    transform: { dx: 0, dy: 0, scale: 1, rotation: 0 },
  };
}

/** The name to apply when renaming to `input`; falls back to `current` for empty/whitespace input. */
export function resolveLayerName(current: string, input: string): string {
  return input.trim() || current;
}

export function createProject(
  opts?: Partial<Pick<Project, "width" | "height" | "fps" | "bgColor">>,
): Project {
  const frameCount = 1;
  const layer = createDrawingLayer(frameCount, "Layer 1");
  return {
    width: opts?.width ?? 1280,
    height: opts?.height ?? 720,
    fps: opts?.fps ?? 12,
    bgColor: opts?.bgColor ?? "#f4efe2",
    transparentBg: false,
    frameCount,
    boil: defaultBoilConfig(),
    groups: [],
    layers: [layer],
    audio: null,
  };
}
