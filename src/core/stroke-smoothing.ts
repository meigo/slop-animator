/**
 * Stroke steadying (pure).
 *
 * Stream is a ROPE (a "lazy brush"): the line is pulled behind the pen on a string of
 * `ropeLength` screen px, so movement shorter than the string never reaches it. It works in
 * screen space, so it feels the same at any zoom and on any pointer rate (a per-event average
 * weakened as events got faster — a Pencil's 240 Hz left most of the wobble).
 *
 * Smooth averages each point of the Smooth brush's path with its neighbours BOTH sides, by arc
 * length. The brush redraws the whole stroke every frame, so this costs no lag; the window
 * narrows toward the ends, so a stroke still starts and ends exactly where it was drawn (the tip
 * settles as the stroke grows past it).
 *
 * Both keep a CORNER where the pen pauses: a pen held nearly still for `PAUSE_MS` pulls the rope
 * in (`ropeCatchUp`), so the line reaches the corner before setting off again, and the path is
 * smoothed leg by leg between pauses (`pauseBreaks`) when Sharp corners is on, so the averaging
 * never spans the corner (off by default: the rounded corner is a look people like).
 * A turn made without stopping still rounds.
 */
import type { InputPoint } from "./input";

interface Pt {
  x: number;
  y: number;
}

/** A pen still (within `STILL_PX` screen px) this long is pausing — at a corner, say (ms). */
export const PAUSE_MS = 50;
/** How far a pausing pen may still tremble (screen px). */
export const STILL_PX = 3;
/** Once paused, the rope pulls in with this time constant (ms): at the corner within ~0.1 s. */
export const CATCH_UP_MS = 25;

/** Stream 100% = a string this long (screen px). */
export const ROPE_MAX_PX = 40;
/** Smooth 100% = averaging over this far either side of each point (screen px). */
export const SMOOTH_MAX_PX = 32;

/** The string length for Stream `v` (0–1). Squared, so the low half of the slider stays gentle
 *  (50% = 10 px) and the top end is strong. */
export function ropeLength(v: number): number {
  const s = Math.min(1, Math.max(0, v));
  return ROPE_MAX_PX * s * s;
}

/** Where the brush goes when the pen moves to `pen`: nowhere while the string is slack, else
 *  pulled along the string until it is exactly `length` behind. */
export function ropeStep(brush: Pt, pen: Pt, length: number): Pt {
  const dx = pen.x - brush.x;
  const dy = pen.y - brush.y;
  const d = Math.hypot(dx, dy);
  if (d <= length) return brush;
  const k = (d - length) / d;
  return { x: brush.x + dx * k, y: brush.y + dy * k };
}

/** The brush `dtMs` later while the pen pauses at `pen`: an exponential glide there, snapped to
 *  it when under half a px away. */
export function ropeCatchUp(brush: Pt, pen: Pt, dtMs: number): Pt {
  const dx = pen.x - brush.x;
  const dy = pen.y - brush.y;
  if (Math.hypot(dx, dy) < 0.5) return dx || dy ? pen : brush;
  if (!(dtMs > 0)) return brush;
  const k = 1 - Math.exp(-dtMs / CATCH_UP_MS);
  const next = { x: brush.x + dx * k, y: brush.y + dy * k };
  return Math.hypot(pen.x - next.x, pen.y - next.y) < 0.5 ? pen : next;
}

/** Smooth `smoothing` (0–100) as a path-averaging radius in DOCUMENT px at `zoom` (screen px per
 *  document px), so it means the same distance on screen whatever the zoom. */
export function pathSmoothRadius(smoothing: number, zoom: number): number {
  const s = Math.min(100, Math.max(0, smoothing)) / 100;
  return zoom > 0 ? (SMOOTH_MAX_PX * s) / zoom : 0;
}

/**
 * Where the pen paused: the index of the last point of every run of points that stays within
 * `stillDist` of the run's first point for at least `pauseMs` (timestamps in ms). A still pen
 * sends few events or none, so a run can be just two points with a long gap between them.
 */
export function pauseBreaks(points: InputPoint[], stillDist: number, pauseMs = PAUSE_MS): number[] {
  const breaks: number[] = [];
  const n = points.length;
  let j = 0;
  while (j < n - 1) {
    let k = j;
    while (
      k + 1 < n &&
      Math.hypot(points[k + 1].x - points[j].x, points[k + 1].y - points[j].y) <= stillDist
    ) {
      k++;
    }
    if (k > j && points[k].timestamp - points[j].timestamp >= pauseMs) {
      breaks.push(k);
      j = k + 1;
    } else {
      j++;
    }
  }
  return breaks;
}

/**
 * `points` with each position (and pressure) replaced by a Gaussian-weighted average of the
 * points within `radius` of it along the path — with `sharpCorners`, one leg at a time between
 * the pen's pauses, so a paused corner stays sharp (off, the corner rounds: a look worth keeping). The window at each point is also limited to its distance from either end of
 * its leg, so the ends — and the corners — stay put and nothing is pulled short. A pause is the pen
 * within `radius / 8` for `PAUSE_MS`: the same share of the window at any zoom.
 */
export function smoothPath(
  points: InputPoint[],
  radius: number,
  sharpCorners = false,
): InputPoint[] {
  if (points.length < 3 || !(radius > 0)) return points;
  const breaks = sharpCorners ? pauseBreaks(points, radius / 8) : [];
  if (!breaks.length) return smoothLeg(points, radius);
  const out: InputPoint[] = [];
  let from = 0;
  for (const b of [...breaks, points.length - 1]) {
    if (b <= from) continue;
    const leg = smoothLeg(points.slice(from, b + 1), radius);
    // Each leg starts on the previous one's last point: keep it once.
    out.push(...(out.length ? leg.slice(1) : leg));
    from = b;
  }
  return out;
}

function smoothLeg(points: InputPoint[], radius: number): InputPoint[] {
  const n = points.length;
  if (n < 3 || !(radius > 0)) return points;
  const s = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    s[i] = s[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  const total = s[n - 1];
  const out: InputPoint[] = new Array(n);
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < n; i++) {
    const h = Math.min(radius, s[i], total - s[i]);
    if (h <= 0) {
      out[i] = points[i];
      continue;
    }
    while (s[lo] < s[i] - h) lo++;
    while (lo > 0 && s[lo - 1] >= s[i] - h) lo--;
    if (hi < i) hi = i;
    while (hi + 1 < n && s[hi + 1] <= s[i] + h) hi++;
    while (hi > i && s[hi] > s[i] + h) hi--;
    const inv2s2 = 1 / (2 * (h / 2) * (h / 2)); // σ = h/2: the window is ±2σ
    let wSum = 0;
    let x = 0;
    let y = 0;
    let p = 0;
    for (let j = lo; j <= hi; j++) {
      const d = s[j] - s[i];
      const w = Math.exp(-d * d * inv2s2);
      wSum += w;
      x += points[j].x * w;
      y += points[j].y * w;
      p += points[j].pressure * w;
    }
    out[i] = { ...points[i], x: x / wSum, y: y / wSum, pressure: p / wSum };
  }
  return out;
}
