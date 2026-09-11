import type { Project, LayerGroup } from "../anim/document";
import { resolveDisplayKey } from "../anim/document";

// Cheap "does this keyframe have any ink?" test for the timeline display.
// A full-resolution scan per cell would be far too expensive to run every render, so we
// downscale the keyframe to a small probe and check it for any non-transparent pixel.
//
// The downscale must never shrink by more than 2x in one draw. One big downscale (the old single
// 1280px → 64px draw) does not area-average in Chrome even at imageSmoothingQuality "high": it
// SAMPLES source rows, so a thin stroke lying between sample rows read as empty and an inked key
// drew as a hollow ◇ — measured 2026-09-11: the same 5px-tall stroke was found at 3 of 10 vertical
// offsets. Halving repeatedly with bilinear filtering cannot skip a row: at <= 2x each destination
// pixel's footprint covers every source row it spans. (A lone single pixel of ink can still average
// away to 0 over five halvings, as it could before — the probe is for strokes, not specks.)
// (A genuinely cleared keyframe still reads empty, as intended.)

const MAX_PROBE = 64; // longest probe side in px (aspect preserved)
let probe: HTMLCanvasElement | null = null;
const scratch: HTMLCanvasElement[] = []; // intermediate halving steps, reused across calls

/** Sizes of the successive draws that take a `w`×`h` canvas down to at most `max` px on its longest
 *  side, each step at most 2x smaller on either axis (sizes round UP, so an odd side never shrinks
 *  more than 2x). A canvas already that small gets one 1:1 copy. Pure; exported for tests. */
export function probeSteps(w: number, h: number, max: number): { w: number; h: number }[] {
  const out: { w: number; h: number }[] = [];
  let cw = w,
    ch = h;
  while (Math.max(cw, ch) > max) {
    cw = Math.max(1, Math.ceil(cw / 2));
    ch = Math.max(1, Math.ceil(ch / 2));
    out.push({ w: cw, h: ch });
  }
  return out.length ? out : [{ w: cw, h: ch }];
}

/** Read `c` back and report whether every pixel is fully transparent. */
function allTransparent(c: HTMLCanvasElement): boolean {
  const { data } = c
    .getContext("2d", { willReadFrequently: true })!
    .getImageData(0, 0, c.width, c.height);
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 0) return false;
  }
  return true;
}

let quick: HTMLCanvasElement | null = null;

/**
 * True if `canvas` has no visible ink. Two passes, because the robust one is ~12x the cost
 * (0.30–0.37 ms against 0.027 ms per 1280×720 cell, desktop Chrome, measured 2026-09-11) and every
 * version bump re-probes every key:
 *  1. One direct draw to the probe size. It SAMPLES, so it can miss a thin stroke — but it can never
 *     invent ink: a non-zero pixel here means the cell really is inked. That settles almost every
 *     inked key at the old cost.
 *  2. Only when pass 1 sees nothing: the halving probe (`probeSteps`), which cannot skip a row. It
 *     confirms a genuinely blank key, or finds the thin stroke pass 1 fell between.
 */
function probeEmpty(canvas: HTMLCanvasElement): boolean {
  if (canvas.width === 0 || canvas.height === 0) return true;

  // Pass 1 — exactly the pre-2026-09-11 probe (same size, same single draw), so an inked key costs
  // what it always did.
  const scale = Math.min(1, MAX_PROBE / Math.max(canvas.width, canvas.height));
  const pw = Math.max(1, Math.round(canvas.width * scale));
  const ph = Math.max(1, Math.round(canvas.height * scale));
  if (!quick) quick = document.createElement("canvas");
  if (quick.width !== pw) quick.width = pw;
  if (quick.height !== ph) quick.height = ph;
  const qctx = quick.getContext("2d", { willReadFrequently: true })!;
  qctx.clearRect(0, 0, pw, ph);
  qctx.imageSmoothingEnabled = true;
  qctx.imageSmoothingQuality = "high";
  qctx.drawImage(canvas, 0, 0, pw, ph);
  if (!allTransparent(quick)) return false;

  const steps = probeSteps(canvas.width, canvas.height, MAX_PROBE);
  let src: HTMLCanvasElement = canvas;
  for (let k = 0; k < steps.length; k++) {
    const last = k === steps.length - 1;
    // The final step is the one read back, so it alone asks for a CPU-friendly context.
    if (last && !probe) probe = document.createElement("canvas");
    const dst = last ? probe! : (scratch[k] ??= document.createElement("canvas"));
    const { w, h } = steps[k];
    if (dst.width !== w) dst.width = w;
    if (dst.height !== h) dst.height = h;
    const ctx = dst.getContext("2d", last ? { willReadFrequently: true } : undefined)!;
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "low"; // plain bilinear: at <= 2x that is an exact 2x2 average
    ctx.drawImage(src, 0, 0, w, h);
    src = dst;
  }
  return allTransparent(probe!);
}

// Both caches below are keyed on a per-CANVAS ink revision, not the document version. They used to be
// keyed on `appState.version`, which every edit bumps — so after any stroke the timeline re-probed
// every key in the project, although a stroke changes one drawing. Now a cached answer stands until
// that canvas is marked (`markInkChanged`, called by every pixel write: `pixelCommand` covers the
// undoable ones on apply/undo/redo, the lift/cancel/abort paths mark directly) or until the global
// epoch moves (`invalidateInk`, on load/undo/redo — the safety net for a write that forgot to mark).
// Fresh canvases (new keys, loads, resize, merge, clones) are simply not in the cache yet.
const inkRev = new WeakMap<HTMLCanvasElement, number>();
let inkEpoch = 0;

/** Record that `canvas`'s pixels changed, so its cached emptiness/bounds are re-measured. */
export function markInkChanged(canvas: HTMLCanvasElement): void {
  inkRev.set(canvas, (inkRev.get(canvas) ?? 0) + 1);
}

/** How many times `canvas` has been marked changed (0 if never). */
export function inkRevision(canvas: HTMLCanvasElement): number {
  return inkRev.get(canvas) ?? 0;
}

/** Drop every cached ink answer at once. The safety net for a pixel write that did not mark. */
export function invalidateInk(): void {
  inkEpoch++;
}

type Stamp = { epoch: number; rev: number };
const stampOf = (canvas: HTMLCanvasElement): Stamp => ({
  epoch: inkEpoch,
  rev: inkRevision(canvas),
});
const fresh = (hit: Stamp | undefined, now: Stamp) =>
  !!hit && hit.epoch === now.epoch && hit.rev === now.rev;

const cache = new WeakMap<HTMLCanvasElement, Stamp & { empty: boolean }>();

/** Memoized emptiness check. `_version` is not the cache key (see above); callers pass the document
 *  version because reading it is what makes THEIR derived state re-run after an edit. */
export function isCellEmpty(canvas: HTMLCanvasElement, _version: number): boolean {
  const now = stampOf(canvas);
  const hit = cache.get(canvas);
  if (hit && fresh(hit, now)) return hit.empty;
  const empty = probeEmpty(canvas);
  cache.set(canvas, { ...now, empty });
  return empty;
}

const boundsCache = new WeakMap<
  HTMLCanvasElement,
  Stamp & { bounds: { x: number; y: number; w: number; h: number } | null }
>();

/**
 * Tight non-transparent bounds within an RGBA buffer, or null when every pixel is transparent.
 *
 * The unmemoised core of `contentBounds`, split out for the callers memoising would be WRONG for:
 * anything measuring a reused SCRATCH canvas, where the cache is keyed by canvas identity and
 * every measurement would collide with the last (the PSD export renders each layer through the
 * same scratch, so it would have read layer 1's rect for every layer). Being pure also makes the
 * tight-rect behaviour node-testable, which it never was through the canvas wrapper.
 */
export function boundsOfPixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): { x: number; y: number; w: number; h: number } | null {
  let minX = width,
    minY = height,
    maxX = -1,
    maxY = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (data[(y * width + x) * 4 + 3] !== 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
  if (maxX < minX) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** Tight non-transparent bounds in DEVICE px, or null if empty. Memoized per canvas ink revision
 *  (see `markInkChanged`) — so it is only safe on a canvas whose identity means one thing over time
 *  (a CELL canvas). A reused scratch canvas wants `boundsOfPixels` above. `_version`: as for
 *  `isCellEmpty`, the caller's reactive dependency, not the key. */
export function contentBounds(
  canvas: HTMLCanvasElement,
  _version: number,
): { x: number; y: number; w: number; h: number } | null {
  const now = stampOf(canvas);
  const hit = boundsCache.get(canvas);
  if (hit && fresh(hit, now)) return hit.bounds;
  let bounds: { x: number; y: number; w: number; h: number } | null = null;
  if (canvas.width > 0 && canvas.height > 0) {
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    bounds = boundsOfPixels(data, width, height);
  }
  boundsCache.set(canvas, { ...now, bounds });
  return bounds;
}

/** The logical gizmo/pivot box for a key cell: frozen box if set, else live content bounds, else full doc. */
export function contentBoxLogical(
  canvas: HTMLCanvasElement,
  frozen: { x: number; y: number; w: number; h: number } | null | undefined,
  docW: number,
  docH: number,
  dpr: number,
  version: number,
): { x: number; y: number; w: number; h: number } {
  if (frozen) return frozen;
  const b = contentBounds(canvas, version);
  if (!b) return { x: 0, y: 0, w: docW, h: docH };
  return { x: b.x / dpr, y: b.y / dpr, w: b.w / dpr, h: b.h / dpr };
}

/** Logical bbox of a group's drawable content at `frame`: union of resolved key cells'
 *  contentBounds (device px → logical). Refs excluded. Empty → full-doc rect. */
export function groupContentBoxLogical(
  group: LayerGroup,
  project: Project,
  frame: number,
  dpr: number,
  version: number,
): { x: number; y: number; w: number; h: number } {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const layer of project.layers) {
    if (layer.kind !== "draw" || layer.groupId !== group.id) continue;
    const ki = resolveDisplayKey(layer.cells, frame);
    if (ki === null) continue;
    const cell = layer.cells[ki];
    if (cell.kind !== "key") continue;
    const b = contentBounds(cell.canvas, version);
    if (!b) continue;
    if (b.x < minX) minX = b.x;
    if (b.y < minY) minY = b.y;
    if (b.x + b.w - 1 > maxX) maxX = b.x + b.w - 1;
    if (b.y + b.h - 1 > maxY) maxY = b.y + b.h - 1;
  }
  if (maxX === -Infinity) return { x: 0, y: 0, w: project.width, h: project.height };
  return {
    x: minX / dpr,
    y: minY / dpr,
    w: (maxX - minX + 1) / dpr,
    h: (maxY - minY + 1) / dpr,
  };
}

/**
 * The active gizmo/pivot box for a group: the ANIMATION track's frozen box if the group is
 * animated, else the drag-time frozen box, else the live `groupContentBoxLogical`.
 *
 * The track's box wins because it is the pivot every key in that track was authored against — left
 * live, the pivot would drift with the drawings and interpolate BETWEEN keys, warping the motion
 * path invisibly. It is captured through this same function at `animateGroup` time, so a group that
 * already carried a drag freeze simply keeps it; the two can never disagree.
 *
 * One consumer for every caller (render, gizmo, compose steps, bounds hint), so no site can be left
 * reading the un-frozen box.
 */
export function groupBoxLogical(
  group: LayerGroup,
  project: Project,
  frame: number,
  dpr: number,
  version: number,
): { x: number; y: number; w: number; h: number } {
  const trackBox = group.tracks?.transform?.box;
  // A COPY, never the track's own object: the grab-time freeze assigns this return value to
  // `g.transformBox`, so returning it by reference left the two fields aliased — and one future
  // in-place write (`g.transformBox.x = …`) would silently relocate the pivot of every key in the
  // track. Both are only ever assigned wholesale today; this is what keeps that from mattering.
  if (trackBox) return { ...trackBox };
  if (group.transformBox) return group.transformBox;
  return groupContentBoxLogical(group, project, frame, dpr, version);
}
