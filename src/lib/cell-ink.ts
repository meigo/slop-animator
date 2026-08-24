import type { Project, LayerGroup } from "../anim/document";
import { resolveKeyframeIndex } from "../anim/document";

// Cheap "does this keyframe have any ink?" test for the timeline display.
// A full-resolution scan per cell would be far too expensive to run every render, so we
// downscale the keyframe to a small probe and check it for any non-transparent pixel.
//
// The downscale MUST area-average (imageSmoothingQuality "high"). A single extreme downscale
// of a high-DPR cell canvas (e.g. ~1500px wide → 24px) with the default sparse sampling skips
// thin strokes entirely, so an inked keyframe reads as empty — the canvas composites it but the
// timeline shows no ◆/— marker. A moderate probe size keeps the ratio sane so area-averaging
// reliably preserves thin lines. (A genuinely cleared keyframe still reads empty, as intended.)

const MAX_PROBE = 64; // longest probe side in px (aspect preserved)
let probe: HTMLCanvasElement | null = null;

/** True if `canvas` has no visible ink (every pixel fully transparent in the downscaled probe). */
function probeEmpty(canvas: HTMLCanvasElement): boolean {
  if (canvas.width === 0 || canvas.height === 0) return true;
  const scale = Math.min(1, MAX_PROBE / Math.max(canvas.width, canvas.height));
  const pw = Math.max(1, Math.round(canvas.width * scale));
  const ph = Math.max(1, Math.round(canvas.height * scale));
  if (!probe) probe = document.createElement("canvas");
  if (probe.width !== pw) probe.width = pw;
  if (probe.height !== ph) probe.height = ph;
  const ctx = probe.getContext("2d", { willReadFrequently: true })!;
  ctx.clearRect(0, 0, pw, ph);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high"; // area-average so thin strokes survive the downscale
  ctx.drawImage(canvas, 0, 0, pw, ph);
  const { data } = ctx.getImageData(0, 0, pw, ph);
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 0) return false;
  }
  return true;
}

const cache = new WeakMap<HTMLCanvasElement, { version: number; empty: boolean }>();

/** Memoized emptiness check; pass the current document version so the cache invalidates on any edit. */
export function isCellEmpty(canvas: HTMLCanvasElement, version: number): boolean {
  const hit = cache.get(canvas);
  if (hit && hit.version === version) return hit.empty;
  const empty = probeEmpty(canvas);
  cache.set(canvas, { version, empty });
  return empty;
}

const boundsCache = new WeakMap<
  HTMLCanvasElement,
  { version: number; bounds: { x: number; y: number; w: number; h: number } | null }
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

/** Tight non-transparent bounds in DEVICE px, or null if empty. Memoized by document version —
 *  so it is only safe on a canvas whose identity means one thing over time (a CELL canvas). A
 *  reused scratch canvas wants `boundsOfPixels` above. */
export function contentBounds(
  canvas: HTMLCanvasElement,
  version: number,
): { x: number; y: number; w: number; h: number } | null {
  const hit = boundsCache.get(canvas);
  if (hit && hit.version === version) return hit.bounds;
  let bounds: { x: number; y: number; w: number; h: number } | null = null;
  if (canvas.width > 0 && canvas.height > 0) {
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    bounds = boundsOfPixels(data, width, height);
  }
  boundsCache.set(canvas, { version, bounds });
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
    const ki = resolveKeyframeIndex(layer.cells, frame);
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
