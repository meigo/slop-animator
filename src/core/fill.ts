/**
 * Flood fill (paint bucket): the region (`fillMask`), then its coverage (Soft / Expand).
 * Operates on raw ImageData for performance.
 */

import { dilateMask, distanceToMask, thickenMask } from "./mask-ops";
import { clampGap, enclosedRegion } from "./fill-holes";

export interface FillOptions {
  /** Color tolerance for matching the clicked pixel's color (0-255) */
  tolerance?: number;
  /** Close breaks in the lines of up to about 2× this many pixels (0 = none; see `fillMask`). */
  gap?: number;
  /** Expand fill by this many pixels to cover antialiased edges. Fill draws behind existing content. */
  expand?: number;
  /** Soft edge: the fill runs under the surrounding lines to their middle, behind them, and ends
   *  there this soft (0 = the hard pixel edge; `ridgeCoverage`). */
  softEdge?: number;
}

/** The values the Soft slider stops at (2026-10-02): quarters up to 2, where it antialiases a
 *  line, then coarser for wide feathers (with Expand, 8 fades over 16 px). Uneven so 0.5 is still
 *  easy to hit on a 96 px slider (an even 0–8 in quarters would be ~3 px a step). */
export const SOFT_STEPS = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6, 8];
/** Soft's default: antialiased (2026-10-02). 0 is the old hard edge. */
export const DEFAULT_SOFT = 1;
/** The most Soft goes to. */
export const MAX_SOFT_EDGE = SOFT_STEPS[SOFT_STEPS.length - 1];

/** The slider position (an index into `SOFT_STEPS`) for a Soft value: the nearest stop. */
export function softStepIndex(soft: number): number {
  let best = 0;
  for (let i = 1; i < SOFT_STEPS.length; i++)
    if (Math.abs(SOFT_STEPS[i] - soft) < Math.abs(SOFT_STEPS[best] - soft)) best = i;
  return best;
}

/**
 * Each pixel's distance from the tapped colour, 0–255: the largest channel difference, or the
 * alpha alone when the tap was on an empty pixel (an empty pixel's colour means nothing). The
 * line strength `ridgeCoverage` reads. Pure.
 */
export function colourDistance(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  seed: { r: number; g: number; b: number; a: number },
): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const p = i * 4;
    const da = Math.abs(data[p + 3] - seed.a);
    out[i] =
      seed.a === 0
        ? da
        : Math.max(
            Math.abs(data[p] - seed.r),
            Math.abs(data[p + 1] - seed.g),
            Math.abs(data[p + 2] - seed.b),
            da,
          );
  }
  return out;
}

/**
 * The bucket's line strength per pixel, 0–255, for `ridgeCoverage` (2026-10-04): the colour
 * distance from the tapped pixel (`colourDistance`), but (1) at most the pixel's alpha — a line is
 * INK that differs from the tapped colour, so the empty space around a tapped painted area reads
 * as empty, not as a line to fill under 32 px deep; and (2) at least `tol` for an inked pixel the
 * flood walls off (`fillMask` compares all four channels) — a faint pixel whose colour drifted with
 * the canvas's premultiplied storage (WebKit reads a faint grey back as (46, 46, 46, 11)) is a wall
 * to the flood but, by alpha alone, empty: a pocket of "beyond" at the region's very edge, which
 * cut the fill off there and left white blotches. Pure.
 */
export function bucketStrength(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  seed: { r: number; g: number; b: number; a: number },
  tol: number,
): Uint8Array {
  const out = colourDistance(data, w, h, seed);
  for (let i = 0; i < w * h; i++) {
    const p = i * 4;
    const a = data[p + 3];
    if (a < out[i]) out[i] = a;
    if (a > 0 && out[i] < tol) {
      const wall =
        Math.abs(data[p] - seed.r) > tol ||
        Math.abs(data[p + 1] - seed.g) > tol ||
        Math.abs(data[p + 2] - seed.b) > tol ||
        Math.abs(a - seed.a) > tol;
      if (wall) out[i] = tol;
    }
  }
  return out;
}

/**
 * `dist` averaged over a (2r+1)² box (separable), never below a pixel's own value: smoothing only
 * fills a line's faint grain pixels in from their neighbours, so a grain hole inside a line doesn't
 * read as the empty space beyond it (`ridgeCoverage`). Pure.
 */
function smoothDistance(dist: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const tmp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let n = 0;
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) {
        sum += dist[y * w + k];
        n++;
      }
      tmp[y * w + x] = sum / n;
    }
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let n = 0;
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) {
        sum += tmp[k * w + x];
        n++;
      }
      out[y * w + x] = Math.max(dist[y * w + x], Math.round(sum / n));
    }
  }
  return out;
}

/** Each pixel's largest value within a (2r+1)² box (separable). Pure. */
function maxFilter(a: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const tmp = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++)
        m = Math.max(m, a[y * w + k]);
      tmp[y * w + x] = m;
    }
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) {
        m = Math.max(m, tmp[k * w + x]);
      }
      out[y * w + x] = m;
    }
  }
  return out;
}

/** The larger of two coverages, per pixel (into `a`). Expand and Soft together: whichever reaches
 *  further under the line. */
function atLeast(a: Uint8ClampedArray, b: Uint8ClampedArray): Uint8ClampedArray {
  for (let i = 0; i < a.length; i++) if (b[i] > a[i]) a[i] = b[i];
  return a;
}

/** How far under a line the fill may reach, px from its region (half of the widest line it fills
 *  to the middle of). */
export const UNDER_LINE_MAX_PX = 32;

/**
 * The fill's coverage, 0–255, run under the surrounding lines to their MIDDLE (2026-10-04, port of
 * slop-paint c672ad3, the user's rule there). For each line pixel the middle is found by geometry —
 * halfway between the filled `region` and the empty space beyond the line (`distanceToMask` both
 * ways) — not by climbing the line's strength, which a grainy Pencil or Charcoal line stopped 1–3 px
 * in, leaving its inner half blotchy with paper. On the inner half the fill fades from full to
 * 1 − the line's strongest value nearby (so a light line isn't darkened much, and a solid one hides
 * it), and ends at the middle over max(1, 2 × Soft) px, antialiased. Nothing beyond the middle.
 * Drawn BEHIND the line. Soft 0: the region alone, the hard edge. `dist` is each pixel's line
 * strength (`colourDistance`; the bucket's `bucketStrength`); a pixel is empty below `tol`.
 * Worked out only around the region, so a small fill on a big layer stays fast. Pure.
 *
 * History (2026-10-02 → 04): Soft first climbed the line pixel by pixel, uphill only, coverage
 * from how faint each pixel was (`softCoverage`); fine on a smooth ink line, but grain peaks
 * stopped it short. Smoothing the grain first (1–2 px) barely helped: pencil grain also varies on
 * a larger scale.
 */
export function ridgeCoverage(
  dist: Uint8Array,
  w: number,
  h: number,
  region: Uint8Array,
  tol: number,
  soft: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h);
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!region[y * w + x]) continue;
      out[y * w + x] = 255;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (!(soft > 0) || x1 < 0) return out;

  // The window: the region and as far as the fill may reach, plus as far again, so the empty space
  // beyond a line that wide is inside it too.
  const pad = 2 * UNDER_LINE_MAX_PX;
  const wx = Math.max(0, x0 - pad);
  const wy = Math.max(0, y0 - pad);
  const ww = Math.min(w - 1, x1 + pad) - wx + 1;
  const wh = Math.min(h - 1, y1 + pad) - wy + 1;
  const n = ww * wh;
  const d = new Uint8Array(n);
  const reg = new Uint8Array(n);
  for (let y = 0; y < wh; y++) {
    for (let x = 0; x < ww; x++) {
      d[y * ww + x] = dist[(y + wy) * w + x + wx];
      reg[y * ww + x] = region[(y + wy) * w + x + wx];
    }
  }
  const smooth = smoothDistance(d, ww, wh, 2);
  // The empty space beyond the lines: not filled, and empty even with the grain smoothed over.
  const outside = new Uint8Array(n);
  for (let i = 0; i < n; i++) outside[i] = !reg[i] && smooth[i] < tol ? 1 : 0;
  const dIn = distanceToMask(reg, ww, wh);
  const dOut = distanceToMask(outside, ww, wh);
  const peak = maxFilter(smooth, ww, wh, 3);
  const feather = Math.max(1, 2 * soft);
  for (let y = 0; y < wh; y++) {
    for (let x = 0; x < ww; x++) {
      const i = y * ww + x;
      if (reg[i] || outside[i] || dIn[i] > UNDER_LINE_MAX_PX) continue;
      // No empty space beyond within reach (a line inside the region, or a wide solid one): fill
      // all of it within reach — it's behind the line.
      const span = Number.isFinite(dOut[i]) ? dIn[i] + dOut[i] : Infinity;
      const t = Number.isFinite(span) ? dIn[i] / span : 0; // 0 at the region, ½ at the middle
      const edge = Number.isFinite(span)
        ? Math.max(0, Math.min(1, ((0.5 - t) * span) / feather + 0.5))
        : 1;
      if (edge <= 0) continue;
      const end = 1 - peak[i] / 255;
      const along = Math.min(1, t / 0.5);
      out[(y + wy) * w + x + wx] = Math.round(255 * edge * (1 + (end - 1) * along));
    }
  }
  return out;
}

/**
 * The fill grown `expand` px under the lines (Expand), as coverage 0–255 (2026-10-02). Soft 0: the
 * old whole-pixel round dilation (`dilateMask`). Above 0 the grown edge is a smooth round offset
 * measured by true distance (`distanceToMask`), solid up to `expand` px and fading to nothing over
 * the next max(1, 2 × Soft) px — antialiased at least. The whole-pixel dilation left a staircase
 * under the line, showing through a see-through one, and Soft's fade (`ridgeCoverage`) starts from
 * that edge, already in the line's dark middle where it has nothing left to fade: with Expand on,
 * Soft seemed to do nothing. Pure.
 */
export function expandedCoverage(
  mask: Uint8Array,
  w: number,
  h: number,
  expand: number,
  soft: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h);
  if (soft <= 0) {
    const grown = dilateMask(mask, w, h, expand);
    for (let i = 0; i < w * h; i++) if (grown[i]) out[i] = 255;
    return out;
  }
  const width = Math.max(1, 2 * soft);
  const dist = distanceToMask(mask, w, h);
  for (let i = 0; i < w * h; i++) {
    const c = (expand + width - dist[i]) / width;
    out[i] = c >= 1 ? 255 : c <= 0 ? 0 : Math.round(c * 255);
  }
  return out;
}

/**
 * The pixels a bucket tap at (sx, sy) fills: 1 = fill. Pixels within `tolerance` of the tapped
 * one (all four channels) are fillable; the rest are walls. `null` for a tap off the canvas.
 *
 * `gap` (clamped to MAX_GAP, as Fill enclosed's Bridge) closes breaks in the walls of up to about
 * 2×gap px: the walls are thickened by `gap`, the flood runs in what's left, and the region is
 * grown back `gap` steps over fillable pixels only (`growWithin`) — so it still reaches the lines,
 * into sharp inside corners too, and pokes only about `gap` px out through a bridged break. A region too narrow to survive the thickening (the tap lands
 * inside it) is filled without bridging instead, so a small pocket still fills.
 */
export function fillMask(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  sx: number,
  sy: number,
  tolerance: number,
  gap = 0,
): Uint8Array | null {
  if (sx < 0 || sx >= w || sy < 0 || sy >= h) return null;
  const s = (sy * w + sx) * 4;
  const fillable = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const p = i * 4;
    fillable[i] =
      Math.abs(data[p] - data[s]) <= tolerance &&
      Math.abs(data[p + 1] - data[s + 1]) <= tolerance &&
      Math.abs(data[p + 2] - data[s + 2]) <= tolerance &&
      Math.abs(data[p + 3] - data[s + 3]) <= tolerance
        ? 1
        : 0;
  }
  const r = clampGap(gap);
  if (r > 0) {
    const walls = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) walls[i] = fillable[i] ? 0 : 1;
    const thick = thickenMask(walls, w, h, r); // dilateMask's mask at any radius, in constant time
    const start = sy * w + sx;
    if (!thick[start]) {
      const open = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) open[i] = thick[i] ? 0 : 1;
      return growWithin(flood(open, w, h, start), fillable, w, h, r);
    }
  }
  return flood(fillable, w, h, sy * w + sx);
}

/** Grow `region` by `steps` 8-connected steps, only into `allowed` pixels. Square steps reach a
 *  corner a round dilation of the same radius misses (it left the inside corners of a box unfilled
 *  by ~0.4×gap), and staying on `allowed` pixels at each step — never squeezing diagonally between
 *  two wall pixels — means it never crosses a line. */
function growWithin(
  region: Uint8Array,
  allowed: Uint8Array,
  w: number,
  h: number,
  steps: number,
): Uint8Array {
  let edge: number[] = [];
  for (let i = 0; i < w * h; i++) if (region[i]) edge.push(i);
  for (let s = 0; s < steps && edge.length; s++) {
    const next: number[] = [];
    for (const i of edge) {
      const x = i % w;
      const y = (i - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          const n = ny * w + nx;
          if (region[n] || !allowed[n]) continue;
          // A diagonal step between two wall pixels would slip through a 1px diagonal line.
          if (dx && dy && !allowed[y * w + nx] && !allowed[ny * w + x]) continue;
          region[n] = 1;
          next.push(n);
        }
      }
    }
    edge = next;
  }
  return region;
}

/** The 4-connected region of `open` pixels around `start` (1 = in it). */
function flood(open: Uint8Array, w: number, h: number, start: number): Uint8Array {
  const out = new Uint8Array(w * h);
  if (!open[start]) return out;
  out[start] = 1;
  const stack = [start];
  const visit = (n: number) => {
    if (out[n] || !open[n]) return;
    out[n] = 1;
    stack.push(n);
  };
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    if (x > 0) visit(i - 1);
    if (x < w - 1) visit(i + 1);
    if (i >= w) visit(i - w);
    if (i + w < w * h) visit(i + w);
  }
  return out;
}

export function floodFill(
  ctx: CanvasRenderingContext2D,
  startX: number,
  startY: number,
  fillColor: { r: number; g: number; b: number; a: number },
  options: FillOptions = {},
) {
  const tolerance = options.tolerance ?? 32;
  const expand = options.expand ?? 0;

  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;

  const sx = Math.round(startX);
  const sy = Math.round(startY);
  if (sx < 0 || sx >= w || sy < 0 || sy >= h) return;

  const startIdx = (sy * w + sx) * 4;
  const targetR = data[startIdx];
  const targetG = data[startIdx + 1];
  const targetB = data[startIdx + 2];
  const targetA = data[startIdx + 3];

  // Don't fill if clicking on the same color — exactly the same. Within the region tolerance (as
  // it was) refused real recolours: #000000 could not be filled with the default #1a1a1a.
  if (
    targetR === fillColor.r &&
    targetG === fillColor.g &&
    targetB === fillColor.b &&
    targetA === fillColor.a
  ) {
    return;
  }

  // --- Pass 1: the region to fill (with Gap, breaks in the lines bridged: `fillMask`) ---
  const mask = fillMask(data, w, h, sx, sy, tolerance, options.gap ?? 0)!;

  // --- Pass 2: coverage per pixel, 0–255 (2026-10-02, from slop-paint; 2026-10-04 `ridgeCoverage`) ---
  // Soft runs the fill under the lines to their middle, behind them; Expand grows it under them
  // with an edge feathered by Soft; with both, whichever reaches further. The tapped region itself
  // stays solid. Soft 0 and no Expand: the region alone (`null`, no allocation); Soft 0 with
  // Expand: the expand alone (the region is inside it anyway).
  const soft = options.softEdge ?? 0;
  let toMiddle: Uint8ClampedArray | null = null;
  if (soft > 0) {
    const seed = { r: targetR, g: targetG, b: targetB, a: targetA };
    toMiddle = ridgeCoverage(
      bucketStrength(data, w, h, seed, tolerance),
      w,
      h,
      mask,
      tolerance,
      soft,
    );
  }
  const cover =
    expand > 0
      ? toMiddle
        ? atLeast(expandedCoverage(mask, w, h, expand, soft), toMiddle)
        : expandedCoverage(mask, w, h, expand, soft)
      : toMiddle;

  // --- Pass 3: Apply fill behind existing content ---
  // Tapping a PAINTED area recolours it: the region itself is written (as with expand 0) and only
  // the expand ring goes behind. Painting the whole region behind could never change an opaque
  // pixel, so at the default expand a recolour tap did nothing but add a faint rim. An EMPTY area
  // (the usual fill between lines) still goes all behind, so faint anti-aliased line pixels that
  // fall inside the region stay on top of the fill.
  const painted = targetA > tolerance;
  if (expand > 0 && painted) {
    for (let i = 0; i < w * h; i++) {
      if (mask[i]) {
        const pi = i * 4;
        data[pi] = fillColor.r;
        data[pi + 1] = fillColor.g;
        data[pi + 2] = fillColor.b;
        data[pi + 3] = fillColor.a;
        cover![i] = 0; // written; what is left of the coverage is the ring
      }
    }
    ctx.putImageData(imageData, 0, 0);
  }
  if (expand > 0) {
    // Draw fill to a temp canvas, then composite behind existing content
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = w;
    tempCanvas.height = h;
    const tempCtx = tempCanvas.getContext("2d")!;
    const tempData = tempCtx.createImageData(w, h);
    const td = tempData.data;

    for (let i = 0; i < w * h; i++) {
      if (cover![i]) {
        const pi = i * 4;
        td[pi] = fillColor.r;
        td[pi + 1] = fillColor.g;
        td[pi + 2] = fillColor.b;
        td[pi + 3] = Math.round((fillColor.a * cover![i]) / 255);
      }
    }
    tempCtx.putImageData(tempData, 0, 0);

    // Draw fill behind existing content using destination-over
    ctx.save();
    ctx.resetTransform();
    ctx.globalCompositeOperation = "destination-over";
    ctx.drawImage(tempCanvas, 0, 0);
    ctx.restore();
  } else {
    // No expand — write directly to the image data: the tapped region takes the fill colour; what
    // Soft adds under the lines goes BEHIND them (the line stays on top: no halo over it).
    for (let i = 0; i < w * h; i++) {
      const pi = i * 4;
      if (mask[i]) {
        data[pi] = fillColor.r;
        data[pi + 1] = fillColor.g;
        data[pi + 2] = fillColor.b;
        data[pi + 3] = fillColor.a;
        continue;
      }
      const c = cover ? cover[i] : 0;
      if (!c) continue;
      const sa = (fillColor.a / 255) * (c / 255);
      const da = data[pi + 3] / 255;
      const oa = da + sa * (1 - da);
      if (oa <= 0) continue;
      data[pi] = Math.round((data[pi] * da + fillColor.r * sa * (1 - da)) / oa);
      data[pi + 1] = Math.round((data[pi + 1] * da + fillColor.g * sa * (1 - da)) / oa);
      data[pi + 2] = Math.round((data[pi + 2] * da + fillColor.b * sa * (1 - da)) / oa);
      data[pi + 3] = Math.round(oa * 255);
    }
    ctx.putImageData(imageData, 0, 0);
  }
}

/** [0..255] r,g,b → "#rrggbb" (lowercase); clamps + rounds. */
export function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function hexToRgba(
  hex: string,
  opacity: number,
): { r: number; g: number; b: number; a: number } {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const a = Math.round((opacity / 100) * 255);
  return { r, g, b, a };
}

/**
 * Every region the ink on `canvas` encloses, as a device-px mask — READ-ONLY, so the caller can ask
 * "is there anything to fill?" before it touches the document. `area` 0 means nothing was enclosed
 * (an open outline, or art that is already solid), which the caller must report rather than
 * silently no-op: a no-op and a successful fill of an already-white interior look identical.
 *
 * Split from the paint step on purpose. `fillAllEnclosed` used to do both, which forced the caller
 * to materialise a keyframe (and, past a layer's end, EXTEND the layer) before it could know the
 * answer — leaving the model mutated on the nothing-to-fill path.
 */
export function enclosedFillRegion(
  canvas: HTMLCanvasElement,
  opts: { gap?: number; expand?: number } = {},
): { region: Uint8Array; area: number } {
  const w = canvas.width,
    h = canvas.height;
  if (w === 0 || h === 0) return { region: new Uint8Array(0), area: 0 };
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const { data } = ctx.getImageData(0, 0, w, h);
  return enclosedRegion(data, w, h, { gap: opts.gap, expand: opts.expand });
}

/**
 * Paint `region` (device px, sized to the ctx's canvas) in one pass BEHIND existing content — the
 * animator's white-under-black-outline.
 *
 * Always composites with destination-over, unlike `floodFill`, which only takes that path when
 * `expand > 0`. Painting behind is the point here, not an artefact of the expand pass.
 */
export function fillRegionBehind(
  ctx: CanvasRenderingContext2D,
  region: Uint8Array,
  fillColor: { r: number; g: number; b: number; a: number },
  softEdge = 0,
  expand = 0,
): void {
  const w = ctx.canvas.width,
    h = ctx.canvas.height;
  if (w === 0 || h === 0 || region.length < w * h) return;

  const temp = document.createElement("canvas");
  temp.width = w;
  temp.height = h;
  const tctx = temp.getContext("2d")!;
  const img = tctx.createImageData(w, h);
  const td = img.data;
  // Soft, as the bucket's: under the lines to their middle (`ridgeCoverage`). Expand (when the
  // caller left it to us: Soft above 0) grows it at least that far under them, with a feathered
  // edge, as the bucket's. The enclosed areas are empty, so the strength is the alpha, and walls
  // start at alpha 10 (`enclosedRegion`'s threshold). Soft 0 and no Expand: the region alone.
  let cover: Uint8ClampedArray | null = null;
  if (softEdge > 0) {
    const dist = colourDistance(ctx.getImageData(0, 0, w, h).data, w, h, {
      r: 0,
      g: 0,
      b: 0,
      a: 0,
    });
    cover = ridgeCoverage(dist, w, h, region, 10, softEdge);
  }
  if (expand > 0) {
    const grown = expandedCoverage(region, w, h, expand, softEdge);
    cover = cover ? atLeast(grown, cover) : grown;
  }
  for (let i = 0; i < w * h; i++) {
    const c = cover ? cover[i] : region[i] ? 255 : 0;
    if (!c) continue;
    const pi = i * 4;
    td[pi] = fillColor.r;
    td[pi + 1] = fillColor.g;
    td[pi + 2] = fillColor.b;
    td[pi + 3] = Math.round((fillColor.a * c) / 255);
  }
  tctx.putImageData(img, 0, 0);

  ctx.save();
  ctx.resetTransform(); // the region is in device px; the caller's CTM must not scale it
  ctx.globalCompositeOperation = "destination-over";
  ctx.drawImage(temp, 0, 0);
  ctx.restore();
}
