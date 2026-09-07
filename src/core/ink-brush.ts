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
 *     stroke per segment. Contiguous segments whose width is close enough are collected into
 *     a single `Path2D` and stroked once instead (see `inkRuns`).
 *
 * Residual: consecutive runs still share their joint point, so they overlap there exactly
 * once. Measured 7.69 soft edge px per crossing against 8.0 for a single constant-width path —
 * the remaining gap is that one joint and is not worth chasing.
 *
 * A TRANSLUCENT stroke needs one more step, and it is not the same problem as the edge. Runs
 * are short along the path (~5px of arc) but the brush is 9-22px WIDE, so consecutive runs
 * overlap over an area roughly the width of the brush — not just at the antialiased fringe.
 * At `globalAlpha` 0.5 that area is covered two or three times and comes out at 1-(1-0.5)^3 ≈
 * 0.88 instead of 0.5, and — this is the part that shows — the number of overlaps depends on
 * how fast the PRESSURE is changing, so one stroke renders dark where the pressure varied and
 * light where it was held steady, and a mouse stroke (constant width, a single run) renders
 * lighter still. So when the stroke is translucent it is painted opaque onto a scratch layer
 * first and that layer is composited onto the target exactly once, which is the only thing
 * that makes the density uniform. See `inkScratch`.
 *
 * The caller sets the dpr transform + selection clip.
 */

/**
 * Width step (px) at which two segments are considered the same width and merged into one run.
 * Rounding to 0.25px moves a rendered edge by at most 0.125px — below what a device pixel can
 * show, even at dpr 1 — while collapsing a smoothly varying 400-segment stroke to ~100 runs.
 * Absolute rather than proportional to the brush size on purpose: the error that matters is
 * the sub-pixel one at the edge, which does not scale with how fat the stroke is.
 */
export const INK_WIDTH_QUANTUM = 0.25;

/** A contiguous span of segments sharing one stroked width, stroked as a single path.
 *  `from`/`to` are segment indices, `to` exclusive. */
export interface InkRun {
  width: number;
  from: number;
  to: number;
}

/**
 * Group per-segment widths into contiguous runs of near-equal width. The run count is the
 * number of `stroke()` calls, and therefore the number of times an edge pixel can be
 * re-composited — that is the whole point of this function, so it is kept pure and tested.
 *
 * The merge test is HYSTERESIS — "stay in the open run while the width is still within one
 * quantum of what that run is already stroking" — not "quantize each segment and compare".
 * Independent per-segment rounding looks equivalent and is not: it splits a run every time the
 * width crosses a bucket boundary, and a real Pencil delivers pressure that jitters across a
 * boundary over and over. Simulated on the measured stroke (400 segments, size 8, size range
 * 3) with ±0.02 of pressure noise, per-segment rounding gives 219 runs where the noiseless
 * profile gives 119 — i.e. under realistic input it decays back toward one composite per
 * segment and quietly undoes the fix above. Hysteresis gives 101 on the same input, and is
 * insensitive to the noise because the run's own width is the anchor and cannot drift.
 *
 * The price is that a segment can be stroked up to a FULL quantum off its requested width
 * rather than half of one (0.25px of width, so 0.125px of edge) — still under a device pixel,
 * and the bound the constant above was chosen for.
 */
export function inkRuns(widths: number[], quantum: number = INK_WIDTH_QUANTUM): InkRun[] {
  const runs: InkRun[] = [];
  for (let i = 0; i < widths.length; i++) {
    const last = runs[runs.length - 1];
    if (last && Math.abs(widths[i] - last.width) <= quantum) {
      last.to = i + 1;
      continue;
    }
    // Never quantize down to 0 — a zero-width stroke draws nothing at all.
    const w = Math.max(quantum, Math.round(widths[i] / quantum) * quantum);
    runs.push({ width: w, from: i, to: i + 1 });
  }
  return runs;
}

/** One `stroke()` per run of equal width, over the shared midpoint curve. Caller owns the
 *  composite op, alpha and colour — this only draws. */
function strokeRuns(
  ctx: CanvasRenderingContext2D,
  points: InputPoint[],
  mids: { x: number; y: number }[],
  widths: number[],
) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
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

/**
 * The scratch layer a translucent stroke is painted on before being composited once.
 *
 * Kept module-level and reused rather than allocated per redraw: this runs on every
 * pointermove, and a doc-sized canvas per move would churn tens of MB a second. The cost is
 * one canvas of the target's size held after the first translucent ink stroke — the same order
 * as one cell — which is why it is only reached when `globalAlpha < 1` and an opaque stroke
 * (the common case) still draws straight to the target with no scratch at all.
 */
let scratch: HTMLCanvasElement | null = null;
function inkScratch(width: number, height: number): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null;
  if (!scratch) scratch = document.createElement("canvas");
  const ctx = scratch.getContext("2d");
  if (!ctx) return null;
  if (scratch.width !== width || scratch.height !== height) {
    // Resizing clears; matching sizes must be cleared by hand, and in DEVICE space —
    // the caller's transform is about to be copied onto this context.
    scratch.width = width;
    scratch.height = height;
  } else {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
  }
  return ctx;
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

  // Same ladder as brush.ts / calligraphy-brush.ts / stamp-brush.ts — this engine used to
  // hardcode source-over, which silently made the "Behind" toggle a no-op for Ink alone.
  const alpha = settings.isEraser ? 1 : settings.opacity / 100;
  const op: GlobalCompositeOperation = settings.isEraser
    ? "destination-out"
    : settings.alphaLock
      ? "source-atop"
      : settings.drawBehind
        ? "destination-over"
        : "source-over";

  // Opaque (and every eraser stroke): the runs can go straight onto the target. Where they
  // overlap they paint the same colour at full alpha, so overlapping twice is invisible.
  const sctx = alpha < 1 ? inkScratch(ctx.canvas.width, ctx.canvas.height) : null;
  if (!sctx) {
    ctx.strokeStyle = settings.color;
    ctx.globalCompositeOperation = op;
    ctx.globalAlpha = alpha;
    strokeRuns(ctx, points, mids, widths);
    return;
  }

  // Translucent: paint the whole stroke opaque on the scratch layer under the caller's
  // transform, then hand the target a single flat shape at `alpha`. Compositing at identity
  // maps scratch device pixels 1:1; the caller's selection clip is stored in device space and
  // survives the transform change, so it still applies.
  sctx.setTransform(ctx.getTransform());
  sctx.strokeStyle = settings.color;
  strokeRuns(sctx, points, mids, widths);

  ctx.save();
  try {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = op;
    ctx.globalAlpha = alpha;
    ctx.drawImage(sctx.canvas, 0, 0);
  } finally {
    ctx.restore();
  }
}
