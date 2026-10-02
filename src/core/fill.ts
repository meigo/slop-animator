/**
 * Flood fill (paint bucket) using a scanline algorithm.
 * Operates on raw ImageData for performance.
 */

import { dilateMask, distanceToMask } from "./mask-ops";
import { enclosedRegion } from "./fill-holes";

export interface FillOptions {
  /** Color tolerance for matching the clicked pixel's color (0-255) */
  tolerance?: number;
  /** Alpha threshold (0-255): pixels with alpha >= this are treated as walls */
  alphaThreshold?: number;
  /** Expand fill by this many pixels to cover antialiased edges. Fill draws behind existing content. */
  expand?: number;
  /** Soft edge: how far the fill fades into the surrounding lines' soft edges, behind them
   *  (0 = the hard pixel edge; `softCoverage`). */
  softEdge?: number;
}

/** The values the Soft slider stops at (2026-10-02): quarters up to 2, where it antialiases a
 *  line, then coarser for wide feathers (with Expand, 8 fades over 16 px). Uneven so 0.5 is still
 *  easy to hit on a 96 px slider (an even 0–8 in quarters would be ~3 px a step). */
export const SOFT_STEPS = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6, 8];
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
 * alpha alone when the tap was on an empty pixel (an empty pixel's colour means nothing). What
 * `softCoverage` climbs. Pure.
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

/** Distance units (0–255) of fade per 1 of Soft (`softCoverage`). */
export const SOFT_RANGE_PER_PX = 64;
/** How far, in px, the soft edge may reach into a line at most. */
const SOFT_MAX_STEPS = 8;

/**
 * The fill's coverage, 0–255, antialiased against the lines around it (2026-10-02). The flood
 * (`region`) stops where a line's soft edge passes the colour tolerance, a whole-pixel STAIRCASE;
 * no per-pixel rule fixes that — filling a whole pixel more just moves the staircase. Instead each
 * pixel of the line's edge beside the region gets coverage from how FAINT the line is there:
 * 1 − (dist − tol) / range, `dist` its distance from the tapped colour (`colourDistance`) and
 * range = Soft × `SOFT_RANGE_PER_PX`. The line's own antialiasing carries where the edge really
 * falls between pixels, so the coverage follows it smoothly. Drawn BEHIND the line. Reached from
 * the region stepping uphill only (never past the line's darkest pixel, never through an empty
 * pixel — a break — and at most 8 px), so nothing spills into the space beyond. Soft 0: the region
 * alone, the old hard edge. Pure.
 */
export function softCoverage(
  dist: Uint8Array,
  w: number,
  h: number,
  region: Uint8Array,
  tol: number,
  soft: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h);
  const steps = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let tail = 0;
  for (let i = 0; i < w * h; i++) {
    if (!region[i]) continue;
    out[i] = 255;
    steps[i] = 1;
    queue[tail++] = i;
  }
  const range = soft * SOFT_RANGE_PER_PX;
  if (range <= 0) return out;
  const ceiling = tol + range;
  for (let head = 0; head < tail; head++) {
    const p = queue[head];
    if (steps[p] > SOFT_MAX_STEPS) continue;
    const x = p % w;
    const floor = Math.max(dist[p], 1);
    const visit = (q: number) => {
      if (steps[q] || dist[q] < floor || dist[q] >= ceiling) return;
      steps[q] = steps[p] + 1;
      out[q] = Math.round(255 * Math.min(1, 1 - (dist[q] - tol) / range));
      queue[tail++] = q;
    };
    if (x > 0) visit(p - 1);
    if (x < w - 1) visit(p + 1);
    if (p >= w) visit(p - w);
    if (p < w * (h - 1)) visit(p + w);
  }
  return out;
}

/**
 * The fill grown `expand` px under the lines (Expand), as coverage 0–255 (2026-10-02). Soft 0: the
 * old whole-pixel round dilation (`dilateMask`). Above 0 the grown edge is a smooth round offset
 * measured by true distance (`distanceToMask`), solid up to `expand` px and fading to nothing over
 * the next max(1, 2 × Soft) px — antialiased at least. The whole-pixel dilation left a staircase
 * under the line, showing through a see-through one, and Soft's fade (`softCoverage`) starts from
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

export function floodFill(
  ctx: CanvasRenderingContext2D,
  startX: number,
  startY: number,
  fillColor: { r: number; g: number; b: number; a: number },
  options: FillOptions = {},
) {
  const tolerance = options.tolerance ?? 32;
  const alphaThreshold = options.alphaThreshold ?? 0;
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

  // Don't fill if clicking on a wall pixel
  if (alphaThreshold > 0 && targetA >= alphaThreshold) return;

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

  // --- Pass 1: Scanline flood fill to build a fill mask ---
  const mask = new Uint8Array(w * h); // 1 = fill, 0 = no fill

  function isWall(pixelIdx: number): boolean {
    if (alphaThreshold > 0) {
      return data[pixelIdx + 3] >= alphaThreshold;
    }
    return false;
  }

  function matches(pixelIdx: number): boolean {
    const pi = pixelIdx >> 2;
    if (mask[pi]) return false;
    if (isWall(pixelIdx)) return false;
    return (
      Math.abs(data[pixelIdx] - targetR) <= tolerance &&
      Math.abs(data[pixelIdx + 1] - targetG) <= tolerance &&
      Math.abs(data[pixelIdx + 2] - targetB) <= tolerance &&
      Math.abs(data[pixelIdx + 3] - targetA) <= tolerance
    );
  }

  const stack: [number, number][] = [[sx, sy]];

  while (stack.length > 0) {
    const [x, y] = stack.pop()!;
    let idx = (y * w + x) * 4;

    if (!matches(idx)) continue;

    // Find left edge
    let lx = x;
    while (lx > 0 && matches((y * w + lx - 1) * 4)) {
      lx--;
    }

    // Scan right, filling mask
    let rx = lx;
    let aboveAdded = false;
    let belowAdded = false;

    while (rx < w) {
      idx = (y * w + rx) * 4;
      if (!matches(idx)) break;

      mask[y * w + rx] = 1;

      if (y > 0) {
        const aboveIdx = ((y - 1) * w + rx) * 4;
        if (matches(aboveIdx)) {
          if (!aboveAdded) {
            stack.push([rx, y - 1]);
            aboveAdded = true;
          }
        } else {
          aboveAdded = false;
        }
      }

      if (y < h - 1) {
        const belowIdx = ((y + 1) * w + rx) * 4;
        if (matches(belowIdx)) {
          if (!belowAdded) {
            stack.push([rx, y + 1]);
            belowAdded = true;
          }
        } else {
          belowAdded = false;
        }
      }

      rx++;
    }
  }

  // --- Pass 2: coverage per pixel, 0–255 (2026-10-02, from slop-paint) ---
  // Expand grows the fill under the lines (all of it drawn behind them), its edge feathered by
  // Soft. Without Expand, Soft fades the fill into the lines' soft edges, behind them; the tapped
  // region itself stays solid. Soft 0 and no Expand: the region alone (`null`, no allocation).
  const soft = options.softEdge ?? 0;
  const cover =
    expand > 0
      ? expandedCoverage(mask, w, h, expand, soft)
      : soft > 0
        ? softCoverage(
            colourDistance(data, w, h, { r: targetR, g: targetG, b: targetB, a: targetA }),
            w,
            h,
            mask,
            tolerance,
            soft,
          )
        : null;

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
  // Expand (when the caller left it to us: Soft above 0) grows the region under the lines with a
  // feathered edge, as the bucket's; else Soft fades it into the lines' soft edges. The enclosed
  // areas are empty, so the distance is the alpha, and walls start at alpha 10 (`enclosedRegion`'s
  // threshold). Soft 0 and no Expand: the region alone.
  let cover: Uint8ClampedArray | null = null;
  if (expand > 0) cover = expandedCoverage(region, w, h, expand, softEdge);
  else if (softEdge > 0) {
    const dist = colourDistance(ctx.getImageData(0, 0, w, h).data, w, h, {
      r: 0,
      g: 0,
      b: 0,
      a: 0,
    });
    cover = softCoverage(dist, w, h, region, 10, softEdge);
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
