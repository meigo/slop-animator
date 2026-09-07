import type { InputPoint } from "./input";
import type { BrushSettings } from "./brush";
import { widthRange } from "./brush";

/**
 * Ink/marker brush — a quadratic curve through the running midpoints of the input points,
 * with pressure-driven width.
 *
 * This engine was originally INCREMENTAL: one `beginPath()`/`stroke()` per input point,
 * drawing only the points added since the last call. That is what made its edges look
 * pixelated next to every other brush, and the mechanism is worth stating because it is not
 * obvious from the geometry (which was, and still is, correct).
 *
 * Input points arrive far closer together than the stroke is wide — `input.ts` caps the gap at
 * 4px and coalesced Pencil events usually land 1-2px apart, against a typical brush width of
 * 4-30px — so consecutive round-capped segments overlap their neighbours many times over. Each
 * separate `stroke()` composites `source-over` onto the antialiased fringe the previous one
 * left, and partial coverage compounds as `1-(1-a)^n`, so the soft edge pixels are driven to
 * fully opaque. The antialiasing is computed correctly and then destroyed after the fact,
 * leaving a hard, binary edge. Measured over a 560px arc at 1.4px point spacing, the fraction
 * of soft edge pixels lost against the same geometry stroked once: 7% at width 1.5, 16% at 3,
 * 28% at 6, 30% at 12, 36% at 24 — i.e. fine hairline, visibly crunchy when drawn fat, which
 * is exactly how it was reported.
 *
 * `brush.ts` never had this problem (one `ctx.fill()` for the whole outline) and
 * `calligraphy-brush.ts` was deliberately built to avoid it. The fix here is the same one:
 * composite each pixel once. Two things are needed together, and neither works alone.
 *
 *  1. FULL REDRAW, not incremental. The caller restores the pre-stroke snapshot and calls this
 *     with the whole point list, exactly as it does for smooth and calligraphy. An incremental
 *     engine has to flush whatever it has on every pointermove or the stroke visibly lags the
 *     pen, so it can never batch beyond the 1-3 points one event delivers.
 *  2. BATCHING BY WIDTH. A full redraw alone changes nothing, because the width varies per
 *     segment and `lineWidth` is fixed per `stroke()` — so a naive redraw still emits one
 *     stroke per segment. Contiguous segments whose width quantizes the same are collected
 *     into a single `Path2D` and stroked once instead (see `inkRuns`).
 *
 * Residual: consecutive runs still share their joint point, so they overlap there exactly
 * once. Measured 7.69 soft edge px per crossing against 8.0 for a single constant-width path —
 * the remaining gap is that one joint and is not worth chasing.
 *
 * The caller sets the dpr transform + selection clip.
 */

/**
 * Width step (px) at which two segments are considered the same width and merged into one run.
 * Rounding to 0.25px moves a rendered edge by at most 0.125px — below what a device pixel can
 * show, even at dpr 1 — while collapsing a smoothly varying 400-segment stroke to ~105 runs.
 * Absolute rather than proportional to the brush size on purpose: the error that matters is
 * the sub-pixel one at the edge, which does not scale with how fat the stroke is.
 */
export const INK_WIDTH_QUANTUM = 0.25;

/** A contiguous span of segments sharing one quantized width, stroked as a single path.
 *  `from`/`to` are segment indices, `to` exclusive. */
export interface InkRun {
  width: number;
  from: number;
  to: number;
}

/**
 * Group per-segment widths into contiguous runs of equal quantized width. The run count is
 * the number of `stroke()` calls, and therefore the number of times an edge pixel can be
 * re-composited — that is the whole point of this function, so it is kept pure and tested.
 */
export function inkRuns(widths: number[], quantum: number = INK_WIDTH_QUANTUM): InkRun[] {
  const runs: InkRun[] = [];
  for (let i = 0; i < widths.length; i++) {
    // Never quantize down to 0 — a zero-width stroke draws nothing at all.
    const w = Math.max(quantum, Math.round(widths[i] / quantum) * quantum);
    const last = runs[runs.length - 1];
    if (last && last.width === w) last.to = i + 1;
    else runs.push({ width: w, from: i, to: i + 1 });
  }
  return runs;
}

export function drawInkStroke(
  ctx: CanvasRenderingContext2D,
  points: InputPoint[],
  settings: BrushSettings,
  sizeRange: number = 1.0,
) {
  if (points.length < 2) return;

  // Model 2 range (see widthRange in brush.ts): pressure thins below / widens above nominal.
  const { min: minSize, max: maxSize } = widthRange(settings.size, sizeRange);
  const widthAt = (p: InputPoint) => minSize + p.pressure * (maxSize - minSize);

  // Segment s runs from midpoint(s-1) to midpoint(s) with points[s] as its control point
  // (points[0] is the start of segment 0). Unchanged from the incremental version — the
  // curve this engine draws is the same one, only the batching of the draw calls differs.
  const mids: { x: number; y: number }[] = [];
  const widths: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    mids.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    widths.push((widthAt(a) + widthAt(b)) / 2);
  }

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = settings.color;
  ctx.globalCompositeOperation = settings.isEraser ? "destination-out" : "source-over";
  ctx.globalAlpha = settings.isEraser ? 1 : settings.opacity / 100;

  for (const run of inkRuns(widths)) {
    const start = run.from === 0 ? points[0] : mids[run.from - 1];
    const path = new Path2D();
    path.moveTo(start.x, start.y);
    for (let s = run.from; s < run.to; s++) {
      path.quadraticCurveTo(points[s].x, points[s].y, mids[s].x, mids[s].y);
    }
    ctx.lineWidth = run.width;
    ctx.stroke(path);
  }
}
