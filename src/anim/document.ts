export type Cell =
  | { kind: "key"; canvas: HTMLCanvasElement }
  | { kind: "hold" };

/** Line-boil settings, persisted per project. `scale` is the prototype's uniform-scale weight
 *  (Phase 3 will rename it to a dilate/erode `weight`). */
export interface BoilConfig {
  enabled: boolean;
  amount: number;    // displacement px
  cols: number;      // grid columns
  rate: number;      // cycle length (on twos/threes)
  scale: number;     // uniform scale jitter (fraction)
  holdsOnly: boolean;
}
export function defaultBoilConfig(): BoilConfig {
  return { enabled: false, amount: 1, cols: 20, rate: 3, scale: 0.005, holdsOnly: true };
}

export interface DrawingLayer {
  kind: "draw";
  id: number;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number; // 0..100
  boilStrength: number; // per-layer multiplier on boil amount/scale (1 = full, 0 = none)
  cells: Cell[];    // independent per-layer length; document length = the longest layer
}

export type ReferenceMedia =
  | { type: "image"; el: HTMLImageElement }
  | { type: "video"; el: HTMLVideoElement };

export interface ReferenceLayer {
  kind: "ref";
  id: number;
  name: string;
  visible: boolean;
  opacity: number;       // 0..100
  offsetFrames: number;  // video time offset in frames; ignored for images
  media: ReferenceMedia;
}

export type Layer = DrawingLayer | ReferenceLayer;

export function isDrawingLayer(l: Layer): l is DrawingLayer {
  return l.kind === "draw";
}

export interface Project {
  width: number;
  height: number;
  fps: number;
  bgColor: string;
  frameCount: number;
  boil: BoilConfig;
  layers: Layer[]; // layers[0] = bottom of the stack
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
export function buildFrameDrawList(project: Project, frame: number, includeReference = true): FrameOp[] {
  const ops: FrameOp[] = [];
  for (const layer of project.layers) {
    if (!layer.visible) continue;
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

/** Aspect-preserving "contain" fit of a `srcW×srcH` source centred in a `boxW×boxH` box. */
export function containRect(srcW: number, srcH: number, boxW: number, boxH: number): { x: number; y: number; w: number; h: number } {
  if (srcW <= 0 || srcH <= 0) return { x: 0, y: 0, w: boxW, h: boxH };
  const scale = Math.min(boxW / srcW, boxH / srcH);
  const w = srcW * scale;
  const h = srcH * scale;
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h };
}

/** Intrinsic pixel size of reference media (0 until loaded). */
export function mediaIntrinsicSize(media: ReferenceMedia): { w: number; h: number } {
  if (media.type === "image") return { w: media.el.naturalWidth, h: media.el.naturalHeight };
  return { w: media.el.videoWidth, h: media.el.videoHeight };
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
    cells: Array.from({ length: frameCount }, () => ({ kind: "hold" }) as Cell),
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
    media,
  };
}

export function createProject(opts?: Partial<Pick<Project, "width" | "height" | "fps" | "bgColor">>): Project {
  const frameCount = 1;
  const layer = createDrawingLayer(frameCount, "Layer 1");
  return {
    width: opts?.width ?? 1280,
    height: opts?.height ?? 720,
    fps: opts?.fps ?? 12,
    bgColor: opts?.bgColor ?? "#f4efe2",
    frameCount,
    boil: defaultBoilConfig(),
    layers: [layer],
  };
}
