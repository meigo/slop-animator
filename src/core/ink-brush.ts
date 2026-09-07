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

/**
 * Dwell pooling. A real pen leaves a fatter mark where the nib lingers — the ink has longer to
 * soak in — and that is the one part of ink behaviour this engine can reproduce for free, by
 * modulating the per-segment width before `inkRuns` ever sees it. No extra pass, no extra
 * composite; the existing pipeline draws the result.
 *
 * The measure is PEN SPEED, in document px per millisecond, and it is deliberately NOT
 * normalised by the brush width. The first version keyed off contact time (`width / speed`) on
 * the reasoning that a wide nib genuinely does rest on a given spot for longer. That is the right
 * physics and the wrong control: it makes the trigger speed proportional to brush width, which
 * measured out at 0.02 px/ms for a hairline against 4.5 px/ms for a size-60 brush — a 225x spread,
 * against real drawing speeds of roughly 0.1-3 px/ms. So a thin brush never pooled at any speed a
 * hand actually produces and a fat one pooled constantly, and it was reported exactly that way:
 * "I can't tell if it's on all the time or not at all". Keying off speed alone means the effect
 * answers to how you moved and nothing else, which is the only version of it that can be learned.
 * The SIZE of the swell stays proportional to the width — a hairline gaining 8px would be absurd —
 * it is only the TRIGGER that is absolute. Three tests pin this.
 *
 * Speed is averaged over a window measured in MILLISECONDS, not in neighbouring samples. This is
 * the load-bearing choice and it is deliberate: a neighbour-count window narrows as the Pencil
 * samples faster, so the same stroke drawn at the same speed would pool differently at 120Hz and
 * 240Hz. That is exactly the sample-rate dependence `inkRuns` was fixed for twice, and a test
 * pins it here.
 *
 * DELIBERATELY CAPPED at `MAX_DWELL_SWELL`. Real ink keeps spreading for as long as the nib
 * rests; this stops. An unbounded blob growing under a hand that paused to think is a footgun,
 * not a feature.
 */
const DWELL_WINDOW_MS = 16;
/** Pen speed (document px/ms) at which pooling starts, and at which it is full. Chosen against
 *  measured drawing speeds: an ordinary stroke runs ~0.6 px/ms and a quick one ~1.5, so nothing
 *  pools while you are simply drawing; a deliberate slowdown is ~0.25 and a creep ~0.03. */
const POOL_START_SPEED = 0.3;
const POOL_FULL_SPEED = 0.03;
/** Widest the stroke can get: 2x at pool 100. */
export const MAX_DWELL_SWELL = 1.0;

export function dwellSwell(points: InputPoint[], widths: number[], pool: number): number[] {
  if (!(pool > 0) || widths.length === 0) return widths;
  const strength = (Math.min(100, pool) / 100) * MAX_DWELL_SWELL;
  return widths.map((w, s) => {
    // The window is anchored on the segment's own endpoints and walks outward in time. It stays
    // small (sample rate x 32ms, so ~4-8 points) however slowly the pen is moving, because it is
    // bounded by the clock and not by distance.
    let lo = s;
    while (lo > 0 && points[s].timestamp - points[lo - 1].timestamp < DWELL_WINDOW_MS) lo--;
    let hi = s + 1;
    while (
      hi < points.length - 1 &&
      points[hi + 1].timestamp - points[s + 1].timestamp < DWELL_WINDOW_MS
    )
      hi++;

    let dist = 0;
    for (let k = lo; k < hi; k++) {
      dist += Math.hypot(points[k + 1].x - points[k].x, points[k + 1].y - points[k].y);
    }
    const elapsed = points[hi].timestamp - points[lo].timestamp;
    // No measurable interval means no measurable speed. Pooling on a guess would blob at random,
    // so the segment is left alone.
    if (!(elapsed > 0)) return w;

    // dist 0 (a truly stationary pen) gives speed 0, which clamps to full dwell — correct.
    const speed = dist / elapsed;
    const dwell = Math.max(
      0,
      Math.min(1, (POOL_START_SPEED - speed) / (POOL_START_SPEED - POOL_FULL_SPEED)),
    );
    return w * (1 + strength * dwell);
  });
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

  // Dwell pooling swells the mark where the nib lingered. Applied to the widths rather than in a
  // pass of its own, so it costs one comparison at pool 0 and rides the existing batching above it.
  const pooled = dwellSwell(points, widths, settings.dwellPool ?? 0);

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
    strokeRuns(ctx, points, mids, pooled);
    return;
  }

  // Translucent: paint the whole stroke opaque on the scratch layer under the caller's
  // transform, then hand the target a single flat shape at `alpha`. Compositing at identity
  // maps scratch device pixels 1:1; the caller's selection clip is stored in device space and
  // survives the transform change, so it still applies.
  sctx.setTransform(ctx.getTransform());
  sctx.strokeStyle = settings.color;
  strokeRuns(sctx, points, mids, pooled);

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
