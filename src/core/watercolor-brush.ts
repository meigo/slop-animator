import { outlineOfPath, widthRange, type BrushSettings } from "./brush";
import { hexToRgba } from "./fill";
import type { InputPoint } from "./input";
import { distanceToMask } from "./mask-ops";
import { lattice2, strokeSeed, wobbleAmp, wobbleOutline, wobbleScale } from "./wobble";

/*
 * Watercolour (2026-10-03, slop-paint f9fb670 + 4d24cde): a see-through wash with a darker rim where the pigment gathers as it
 * dries, the paper's grain in it, and a slightly uneven outline. The stroke is ONE filled outline
 * (Smooth's), so it stays even where it crosses itself, like one wet patch; a second stroke
 * darkens it, as a glaze, and by default mixes with it (multiply). Full redraw from the pre-stroke
 * copy, like the other outline brushes; drawn on a scratch canvas and composited once.
 *
 * The rim needs each pixel's distance from the stroke's edge (`distanceToMask`), too slow for the
 * whole stroke every frame. Only a window around the part that CHANGED since the last frame is
 * worked out again (`changedFrom`: the smoothed path's first moved point); the rest of the scratch
 * keeps last frame's pixels. A distance capped at the rim's width only needs the window grown by
 * that width to be exact (`rimWindowPad`).
 */

/** The rim's width in document px: a tenth of the widest width, 1–10 px (a real rim is thin
 *  whatever the brush). */
export function rimWidth(width: number): number {
  return Math.max(1, Math.min(10, width * 0.1));
}

/**
 * The wash's density at `dist` px inside the edge, 0–1: the middle is lighter by up to 60% at Edge
 * 100, rising to full at the edge over `rim` px (squared, so it gathers right at the edge). Edge 0
 * is an even wash. Pure.
 */
export function washAlpha(dist: number, rim: number, edge: number): number {
  const middle = 1 - 0.6 * (Math.max(0, Math.min(100, edge)) / 100);
  if (!(rim > 0) || dist >= rim) return middle;
  const t = 1 - Math.max(0, dist) / rim;
  return middle + (1 - middle) * t * t;
}

export const GRAIN_TILE = 256;

/**
 * The paper's grain, a GRAIN_TILE-square tile of values 0–1 that wraps (both octaves' lattices
 * divide the tile), the same every time. Pure.
 */
export function grainTile(): Float32Array {
  const n = GRAIN_TILE;
  const out = new Float32Array(n * n);
  const octave = (key: number, cell: number, x: number, y: number) => {
    const cells = n / cell;
    const gx = x / cell;
    const gy = y / cell;
    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    const tx = (1 - Math.cos((gx - ix) * Math.PI)) / 2;
    const ty = (1 - Math.cos((gy - iy) * Math.PI)) / 2;
    const at = (i: number, j: number) => lattice2(key, i % cells, j % cells);
    return (
      (at(ix, iy) * (1 - tx) + at(ix + 1, iy) * tx) * (1 - ty) +
      (at(ix, iy + 1) * (1 - tx) + at(ix + 1, iy + 1) * tx) * ty
    );
  };
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      out[y * n + x] = 0.6 * octave(7, 2, x, y) + 0.4 * octave(11, 8, x, y);
    }
  }
  return out;
}

/** How much of the wash the grain leaves at tile value `t` (0–1) and Grain 0–100: 1 at Grain 0,
 *  down to 0.35 on the grain's highest points at 100. */
export function grainFactor(t: number, grain: number): number {
  const g = Math.max(0, Math.min(100, grain)) / 100;
  return 1 - g * 0.65 * t * t;
}

/** The first index where two smoothed paths differ (by more than a hundredth of a px); the
 *  shorter one's length when one is the start of the other. */
export function changedFrom(prev: readonly InputPoint[], next: readonly InputPoint[]): number {
  const n = Math.min(prev.length, next.length);
  for (let i = 0; i < n; i++) {
    const a = prev[i];
    const b = next[i];
    if (Math.abs(a.x - b.x) > 0.01 || Math.abs(a.y - b.y) > 0.01 || a.pressure !== b.pressure) {
      return i;
    }
  }
  return n;
}

/** How far past the changed part's box (device px) the distance window must reach: a distance
 *  capped at the rim's width only depends on the edge within that width. */
export function rimWindowPad(rimPx: number): number {
  return Math.ceil(rimPx) + 2;
}

type Box = { x: number; y: number; w: number; h: number };

/** Points' box (document px) under `m` (scale and translate) as whole device px, padded by `pad`
 *  device px and clamped to a `w`×`h` canvas; null when empty or outside. */
function deviceBoxOf(
  pts: readonly { x: number; y: number }[],
  m: DOMMatrix,
  pad: number,
  w: number,
  h: number,
): Box | null {
  if (pts.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    const x = m.a * p.x + m.e;
    const y = m.d * p.y + m.f;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  const left = Math.max(0, Math.floor(x0 - pad));
  const top = Math.max(0, Math.floor(y0 - pad));
  const right = Math.min(w, Math.ceil(x1 + pad));
  const bottom = Math.min(h, Math.ceil(y1 + pad));
  return right > left && bottom > top
    ? { x: left, y: top, w: right - left, h: bottom - top }
    : null;
}

function growBox(b: Box, by: number, w: number, h: number): Box {
  const x = Math.max(0, b.x - by);
  const y = Math.max(0, b.y - by);
  return {
    x,
    y,
    w: Math.min(w, b.x + b.w + by) - x,
    h: Math.min(h, b.y + b.h + by) - y,
  };
}

function unionBox(a: Box | null, b: Box | null): Box | null {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

// One stroke's state between frames. A stroke is known by its first point, which never moves.
let coverage: HTMLCanvasElement | null = null; // the outline filled opaque: its alpha is coverage
let scratch: HTMLCanvasElement | null = null; // the finished wash, composited each frame
let strokeKey = "";
let lastPath: InputPoint[] = [];
let strokeBox: Box | null = null; // every pixel this stroke has written to the scratch
let grain: Float32Array | null = null;

/** Dev builds: `window.slopWashFull = true` works out the whole stroke every frame, to compare. */
function fullEveryFrame(): boolean {
  return import.meta.env.DEV && !!(window as unknown as { slopWashFull?: boolean }).slopWashFull;
}

export function drawWatercolorStroke(
  ctx: CanvasRenderingContext2D,
  points: InputPoint[],
  settings: BrushSettings,
  sizeRange: number,
  done: boolean,
) {
  if (points.length === 0) return;
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  for (const c of [coverage, scratch]) {
    if (c && (c.width !== w || c.height !== h)) {
      coverage = scratch = null;
      strokeKey = "";
    }
  }
  if (!coverage || !scratch) {
    coverage = document.createElement("canvas");
    coverage.width = w;
    coverage.height = h;
    scratch = document.createElement("canvas");
    scratch.width = w;
    scratch.height = h;
  }
  const cctx = coverage.getContext("2d", { willReadFrequently: true })!;
  const sctx = scratch.getContext("2d")!;

  const m = ctx.getTransform();
  // Already held at rest and smoothed: Canvas.svelte does both in DOCUMENT space, as for the Smooth
  // brush (slop-paint does them here), so `points` is the smoothed path this compares frame to frame.
  const path = points;
  const maxW = widthRange(settings.size, sizeRange).max;
  const amp = wobbleAmp(maxW, settings.washWobble ?? 30);
  const seed = strokeSeed(points[0]);
  const outline = wobbleOutline(
    outlineOfPath(path, settings.size, sizeRange, done, false, true),
    seed,
    amp,
    wobbleScale(maxW),
  );
  if (outline.length < 2) return;
  const rimPx = rimWidth(maxW) * m.a;

  // A new stroke: forget the last one (its pixels are cleared below with its box).
  const key = `${points[0].x},${points[0].y},${points[0].timestamp}`;
  const fresh = strokeKey !== key;
  const reach = (maxW / 2 + amp * 1.5 + 2) * m.a; // outline past the path, device px
  const now = deviceBoxOf(
    outline.map(([x, y]) => ({ x, y })),
    m,
    2,
    w,
    h,
  );
  // perfect-freehand draws a very short stroke as a dot and its start changes as it grows past
  // that (it skips points until the path is half a width long): work the whole stroke out until
  // it is one and a half widths long (measured: its start settles after ~1.1).
  const short = (() => {
    let len = 0;
    for (let i = 1; i < path.length && len < maxW * 1.5; i++) {
      len += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
    }
    return len < maxW * 1.5;
  })();
  let dirty: Box | null;
  if (fresh || short || fullEveryFrame()) {
    dirty = fresh ? now : unionBox(strokeBox, now);
  } else {
    // Where the outline moved: the changed path (perfect-freehand's streamline and the pen's
    // pressure carry a change a few points on, so from 4 back), last frame's and this one's.
    const from = Math.max(0, changedFrom(lastPath, path) - 4);
    dirty = unionBox(
      deviceBoxOf(path.slice(from), m, reach, w, h),
      deviceBoxOf(lastPath.slice(from), m, reach, w, h),
    );
  }
  strokeKey = key;
  lastPath = path;
  if (fresh && strokeBox) sctx.clearRect(strokeBox.x, strokeBox.y, strokeBox.w, strokeBox.h);
  strokeBox = fresh ? now : unionBox(strokeBox, now);

  if (dirty) {
    // Paint that changed moves the rim of what's already there within a rim's width of it (where
    // new paint joins old, the rim between them goes): those pixels are written again too.
    const pad = rimWindowPad(rimPx);
    dirty = growBox(dirty, pad, w, h);
    // The coverage: the whole outline, opaque, in the window's reach.
    const win = {
      x: Math.max(0, dirty.x - pad),
      y: Math.max(0, dirty.y - pad),
      w: 0,
      h: 0,
    };
    win.w = Math.min(w, dirty.x + dirty.w + pad) - win.x;
    win.h = Math.min(h, dirty.y + dirty.h + pad) - win.y;
    cctx.setTransform(1, 0, 0, 1, 0, 0);
    cctx.clearRect(win.x, win.y, win.w, win.h);
    cctx.save();
    cctx.setTransform(m);
    cctx.fillStyle = "#000";
    cctx.fill(outlinePath(outline));
    cctx.restore();
    const cov = cctx.getImageData(win.x, win.y, win.w, win.h).data;

    // Distance inside the edge. Outside the canvas counts as paint, so no rim runs along the page
    // edge (the wash carries on past it).
    const outside = new Uint8Array(win.w * win.h);
    for (let i = 0; i < outside.length; i++) outside[i] = cov[i * 4 + 3] < 128 ? 1 : 0;
    const dist = distanceToMask(outside, win.w, win.h);

    grain ??= grainTile();
    const g = settings.isEraser ? 0 : (settings.washGrain ?? 40);
    const edge = settings.isEraser ? 0 : (settings.washEdge ?? 50);
    const { r, g: gr, b } = hexToRgba(settings.color, 1);
    const out = sctx.createImageData(dirty.w, dirty.h);
    const o = out.data;
    const ox = dirty.x - win.x;
    const oy = dirty.y - win.y;
    for (let y = 0; y < dirty.h; y++) {
      const wy = y + oy;
      const ty = ((dirty.y + y) % GRAIN_TILE) * GRAIN_TILE;
      for (let x = 0; x < dirty.w; x++) {
        const wi = wy * win.w + x + ox;
        const a = cov[wi * 4 + 3];
        if (a === 0) continue;
        // The distance is to the nearest outside pixel's centre: half a pixel past the edge.
        const d = Math.max(0, dist[wi] - 0.5);
        const t = grain[ty + ((dirty.x + x) % GRAIN_TILE)];
        const alpha = (a / 255) * washAlpha(d, rimPx, edge) * grainFactor(t, g);
        const oi = (y * dirty.w + x) * 4;
        o[oi] = r;
        o[oi + 1] = gr;
        o[oi + 2] = b;
        o[oi + 3] = Math.round(alpha * 255);
      }
    }
    sctx.putImageData(out, dirty.x, dirty.y);
  }

  if (!strokeBox) return;
  const box = strokeBox;
  const op: GlobalCompositeOperation = settings.isEraser
    ? "destination-out"
    : settings.alphaLock
      ? "source-atop"
      : settings.drawBehind
        ? "destination-over"
        : (settings.washMultiply ?? true)
          ? "multiply"
          : "source-over";
  ctx.save();
  try {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = op;
    ctx.globalAlpha = settings.opacity / 100;
    ctx.drawImage(scratch, box.x, box.y, box.w, box.h, box.x, box.y, box.w, box.h);
  } finally {
    ctx.restore();
  }
}

/** The outline as a closed path through the midpoints, as the Smooth brush draws it. */
function outlinePath(pts: number[][]): Path2D {
  const p = new Path2D();
  p.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    const n = pts[Math.min(i + 1, pts.length - 1)];
    p.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + n[0]) / 2, (pts[i][1] + n[1]) / 2);
  }
  p.closePath();
  return p;
}
