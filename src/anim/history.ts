import { markInkChanged } from "../lib/cell-ink";
/** A reversible edit. The caller performs the action, then pushes the command. */
export interface Command {
  undo(): void;
  redo(): void;
  label?: string;
  /** Retained RAM for this command (e.g. two ImageData copies). Used to evict old pixel undos. */
  bytes?: number;
}

/** Default pixel-undo budget. Pixel steps keep only the tiles they changed (`changedTiles`); whole
 *  canvases were 16.6 MB a step at 1920×1080 (DPR 1), so only 16 steps fit. */
export const DEFAULT_HISTORY_BYTES = 256 * 1024 * 1024;

export interface PixelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Undo keeps pixels in square tiles this many canvas px a side. */
export const UNDO_TILE = 64;

/** The `tile`-px tiles (clipped at the edges) where two same-size RGBA buffers (`width` ×
 *  `height`) differ, in row order; empty when they are identical. Compares whole pixels 32 bits at
 *  a time — this runs on every step's full-canvas snapshots. Tiles, not one bounding box: a thin
 *  stroke across the page has a bounding box as big as the page. (From slop-paint `610d67d`.) */
export function changedTiles(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
  width: number,
  height: number,
  tile = UNDO_TILE,
): PixelRect[] {
  const n = width * height;
  const A = new Uint32Array(a.buffer, a.byteOffset, n);
  const B = new Uint32Array(b.buffer, b.byteOffset, n);
  const out: PixelRect[] = [];
  for (let ty = 0; ty < height; ty += tile) {
    const th = Math.min(tile, height - ty);
    for (let tx = 0; tx < width; tx += tile) {
      const tw = Math.min(tile, width - tx);
      scan: for (let y = ty; y < ty + th; y++) {
        const row = y * width;
        for (let x = row + tx, end = row + tx + tw; x < end; x++) {
          if (A[x] !== B[x]) {
            out.push({ x: tx, y: ty, w: tw, h: th });
            break scan;
          }
        }
      }
    }
  }
  return out;
}

/** `r`'s pixels out of a `width`-wide RGBA buffer, as a tightly packed buffer. */
export function cropPixels(
  data: Uint8ClampedArray,
  width: number,
  r: PixelRect,
): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(r.w * r.h * 4);
  for (let y = 0; y < r.h; y++) {
    const from = ((r.y + y) * width + r.x) * 4;
    out.set(data.subarray(from, from + r.w * 4), y * r.w * 4);
  }
  return out;
}

/** One side of a pixel step: packed pixels to write back at `r`. */
interface PixelPatch {
  r: PixelRect;
  data: Uint8ClampedArray<ArrayBuffer>;
}

/**
 * An undoable pixel write on `ctx`'s canvas, given the canvas's pixels from before and after it.
 * Only the `UNDO_TILE` tiles that differ are kept, both sides, so a step costs roughly the area it
 * touched rather than the whole canvas twice over; `before` and `after` are not retained. The
 * caller's `undo` / `redo` get a `put` that writes their side back — call it exactly where the
 * pixels must land relative to the other restores (redo puts the cell back in its track first).
 * The callbacks must not capture `before` / `after` themselves, or the full snapshots stay alive.
 *
 * Also marks the canvas's ink as changed — now (the write this records has just happened) and on
 * every undo/redo — so the per-canvas emptiness/bounds caches in `cell-ink` re-measure exactly the
 * drawing that changed. Every undoable pixel write goes through here, which is what lets those
 * caches stop invalidating on every document edit.
 */
export function pixelCommand(
  ctx: CanvasRenderingContext2D,
  before: ImageData,
  after: ImageData,
  undo: (put: () => void) => void,
  redo: (put: () => void) => void,
): Command {
  const canvas = ctx.canvas;
  const w = after.width;
  let was: PixelPatch[];
  let now: PixelPatch[];
  if (before.width === w && before.height === after.height) {
    const rects = changedTiles(before.data, after.data, w, after.height);
    was = rects.map((r) => ({ r, data: cropPixels(before.data, w, r) }));
    now = rects.map((r) => ({ r, data: cropPixels(after.data, w, r) }));
  } else {
    // Not expected (both are snapshots of one canvas), but never lose pixels over it: keep both whole.
    const whole = (d: ImageData): PixelPatch => ({
      r: { x: 0, y: 0, w: d.width, h: d.height },
      data: d.data as Uint8ClampedArray<ArrayBuffer>,
    });
    was = [whole(before)];
    now = [whole(after)];
  }
  const put = (side: PixelPatch[]) => () => {
    for (const p of side) ctx.putImageData(new ImageData(p.data, p.r.w, p.r.h), p.r.x, p.r.y);
  };
  const bytes = [...was, ...now].reduce((sum, p) => sum + p.data.byteLength, 0);
  markInkChanged(canvas);
  return {
    undo: () => {
      undo(put(was));
      markInkChanged(canvas);
    },
    redo: () => {
      redo(put(now));
      markInkChanged(canvas);
    },
    bytes,
  };
}

/** The parts of a structural snapshot that hold memory: cell canvases and the audio track. */
export interface SnapshotMemory {
  layers: readonly {
    kind: string;
    cells?: readonly { kind: string; canvas?: { width: number; height: number } }[];
  }[];
  audio?: {
    buffer?: { length: number; numberOfChannels: number };
    bytes?: { byteLength: number };
  } | null;
}

function canvasesOf(s: SnapshotMemory): Set<{ width: number; height: number }> {
  const out = new Set<{ width: number; height: number }>();
  for (const l of s.layers) for (const c of l.cells ?? []) if (c.canvas) out.add(c.canvas);
  return out;
}

function audioBytes(a: SnapshotMemory["audio"]): number {
  if (!a) return 0;
  return (
    (a.buffer ? a.buffer.length * a.buffer.numberOfChannels * 4 : 0) + (a.bytes?.byteLength ?? 0)
  );
}

/**
 * What a structural step keeps alive that the document does not: the canvases (w·h·4 each) only
 * one side of it holds, and the audio track when the two sides differ. At any moment only one side
 * is off the document (before, while the step is on the undo stack; after, once undone), so it
 * counts the larger. Structural steps used to count 0, so deleting a layer or resizing the canvas
 * kept every old canvas alive outside the 256 MB budget, limited only by the 50-step count
 * (2026-09-30 review, roadmap 14c; slop-paint's `detachedLayerBytes`).
 */
export function detachedBytes(before: SnapshotMemory, after: SnapshotMemory): number {
  const a = canvasesOf(before);
  const b = canvasesOf(after);
  let onlyBefore = 0;
  let onlyAfter = 0;
  for (const c of a) if (!b.has(c)) onlyBefore += c.width * c.height * 4;
  for (const c of b) if (!a.has(c)) onlyAfter += c.width * c.height * 4;
  if (before.audio !== after.audio) {
    onlyBefore += audioBytes(before.audio);
    onlyAfter += audioBytes(after.audio);
  }
  return Math.max(onlyBefore, onlyAfter);
}

export class History {
  /** Fired after any change to either stack. The UI mirrors `canUndo`/`canRedo` into `$state`
   *  through this: a plain class getter is not a reactive dependency, so a button bound directly
   *  to `history.canUndo` would never re-render. One hook here beats notifying at every push site. */
  onChange?: () => void;
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private bytes = 0;
  private maxSize: number;
  private maxBytes: number;
  constructor(maxSize = 50, maxBytes = DEFAULT_HISTORY_BYTES) {
    this.maxSize = maxSize;
    this.maxBytes = maxBytes;
  }

  push(cmd: Command): void {
    for (const c of this.redoStack) this.bytes -= c.bytes ?? 0;
    this.redoStack = [];
    this.undoStack.push(cmd);
    this.bytes += cmd.bytes ?? 0;
    this.trim();
    this.onChange?.();
  }

  private trim(): void {
    while (
      this.undoStack.length > this.maxSize ||
      (this.bytes > this.maxBytes && this.undoStack.length > 1)
    ) {
      const old = this.undoStack.shift();
      if (!old) break;
      this.bytes -= old.bytes ?? 0;
    }
    if (this.bytes < 0) this.bytes = 0;
  }

  undo(): void {
    const cmd = this.undoStack.pop();
    if (!cmd) return;
    cmd.undo();
    this.redoStack.push(cmd);
    this.onChange?.();
  }

  redo(): void {
    const cmd = this.redoStack.pop();
    if (!cmd) return;
    cmd.redo();
    this.undoStack.push(cmd);
    this.onChange?.();
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.bytes = 0;
    this.onChange?.();
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
}
