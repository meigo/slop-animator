export type Cell =
  | { kind: "key"; canvas: HTMLCanvasElement }
  | { kind: "hold" };

export interface DrawingLayer {
  kind: "draw";
  id: number;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number; // 0..100
  cells: Cell[];    // length === project.frameCount
}

export type Layer = DrawingLayer; // reference layers arrive in a later plan

export interface Project {
  width: number;
  height: number;
  fps: number;
  bgColor: string;
  frameCount: number;
  layers: Layer[]; // layers[0] = bottom of the stack
}

/**
 * Index of the keyframe that is shown at `frame` on this cell track:
 * the nearest "key" cell at or before `frame`. Returns null if none precedes it.
 * A frame index past the end clamps to the last cell.
 */
export function resolveKeyframeIndex(cells: Cell[], frame: number): number | null {
  const start = Math.min(frame, cells.length - 1);
  for (let i = start; i >= 0; i--) {
    if (cells[i].kind === "key") return i;
  }
  return null;
}

export interface DrawOp {
  layerId: number;
  keyframeIndex: number;
  opacity: number;
}

/** Ordered list (bottom→top) of which keyframe each visible layer contributes at `frame`. */
export function buildFrameDrawList(project: Project, frame: number): DrawOp[] {
  const ops: DrawOp[] = [];
  for (const layer of project.layers) {
    if (!layer.visible) continue;
    const ki = resolveKeyframeIndex(layer.cells, frame);
    if (ki === null) continue;
    ops.push({ layerId: layer.id, keyframeIndex: ki, opacity: layer.opacity });
  }
  return ops;
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
    cells: Array.from({ length: frameCount }, () => ({ kind: "hold" }) as Cell),
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
    layers: [layer],
  };
}
