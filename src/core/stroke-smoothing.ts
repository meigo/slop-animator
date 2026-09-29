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
 * in along a smooth curve from the line to the pen (`catchUpPath`) — a straight pull cut across a curve — so the line
 * reaches the corner before setting off again (a lift catches up the same way), and the path is
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
/** The pen's recent path is kept for this many times the string's length — more than the rope
 *  can ever lag, so the catch-up always finds where the brush is. */
export const TRAIL_SPAN = 3;

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

/** A trail point: where the pen was, how hard, and when. */
export interface TrailPt extends Pt {
  pressure: number;
  t: number;
}

/** Catch-up points are this far apart (screen px) along their curve. */
const CATCH_UP_STEP = 2;

/**
 * The points that take the lagging brush to the pen — the end of `trail`, the pen's recent path,
 * oldest first — along a smooth curve: a cubic Hermite that leaves the brush heading where the
 * line was already heading (at the pen: a rope always points there) and arrives at the pen in the
 * direction the pen last moved. A straight glide there cut a chord across a curve; retracing the
 * trail kept the hand's wobble (which is what Stream is for) and kinked where the line, riding
 * inside the curve, joined the pen's path. At a paused corner both directions lie along the leg,
 * so the curve is the straight run into the corner.
 *
 * Pressure and time come from the trail, by arc fraction from the trail point nearest the brush
 * (`from`) to the pen: the catch-up keeps the pen's pace, which Ink's Pool reads. Only the last
 * `maxBack` of path (from the pen back) is searched for `from`: the brush is never further behind,
 * and on a small loop an older pass can come nearer. Empty when the brush is already at the pen.
 */
export function catchUpPath<T extends TrailPt>(
  trail: readonly T[],
  brush: Pt,
  maxBack: number,
): { path: TrailPt[]; from: T | null } {
  const nearest = nearestTrailIndex(trail, brush, maxBack);
  if (nearest < 0) return { path: [], from: null };
  const from = trail[nearest];
  const sub = trail.slice(nearest);
  const end = sub[sub.length - 1];
  const d = Math.hypot(end.x - brush.x, end.y - brush.y);
  if (sub.length < 2 || d < 0.5) return { path: [], from };

  // Arc length along the trail, for sampling its pressure and time by fraction.
  const cum = [0];
  for (let i = 1; i < sub.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(sub[i].x - sub[i - 1].x, sub[i].y - sub[i - 1].y));
  }
  const S = cum[cum.length - 1];
  const along = (s: number) => {
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const span = cum[i] - cum[i - 1];
    const k = span > 0 ? Math.min(1, Math.max(0, (s - cum[i - 1]) / span)) : 1;
    const a = sub[i - 1];
    const b = sub[i];
    return {
      x: a.x + (b.x - a.x) * k,
      y: a.y + (b.y - a.y) * k,
      pressure: a.pressure + (b.pressure - a.pressure) * k,
      t: a.t + (b.t - a.t) * k,
    };
  };

  // Directions: the line's (brush → pen), and the pen's last (over up to half the trail, at most
  // 12 px, so one jittery last sample doesn't swing it).
  const t0 = { x: (end.x - brush.x) / d, y: (end.y - brush.y) / d };
  const back = along(Math.max(0, S - Math.min(S / 2, 12)));
  const bl = Math.hypot(end.x - back.x, end.y - back.y);
  const t1 = bl > 1e-9 ? { x: (end.x - back.x) / bl, y: (end.y - back.y) / bl } : t0;

  const hermite = (u: number): Pt => {
    const u2 = u * u;
    const u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1;
    const h10 = u3 - 2 * u2 + u;
    const h01 = -2 * u3 + 3 * u2;
    const h11 = u3 - u2;
    return {
      x: h00 * brush.x + h10 * d * t0.x + h01 * end.x + h11 * d * t1.x,
      y: h00 * brush.y + h10 * d * t0.y + h01 * end.y + h11 * d * t1.y,
    };
  };

  // Sample densely, then keep points CATCH_UP_STEP apart by the curve's own arc length.
  const fine = Array.from({ length: 65 }, (_, i) => hermite(i / 64));
  const fcum = [0];
  for (let i = 1; i < fine.length; i++) {
    fcum.push(fcum[i - 1] + Math.hypot(fine[i].x - fine[i - 1].x, fine[i].y - fine[i - 1].y));
  }
  const L = fcum[fcum.length - 1];
  const n = Math.max(1, Math.ceil(L / CATCH_UP_STEP));
  const path: TrailPt[] = [];
  let j = 1;
  for (let k = 1; k <= n; k++) {
    const target = (L * k) / n;
    while (j < fcum.length - 1 && fcum[j] < target) j++;
    const span = fcum[j] - fcum[j - 1];
    const f = span > 0 ? (target - fcum[j - 1]) / span : 1;
    const p =
      k === n
        ? { x: end.x, y: end.y }
        : {
            x: fine[j - 1].x + (fine[j].x - fine[j - 1].x) * f,
            y: fine[j - 1].y + (fine[j].y - fine[j - 1].y) * f,
          };
    const src = along((S * k) / n); // pen's pressure and time at the same fraction of its path
    path.push({ x: p.x, y: p.y, pressure: src.pressure, t: src.t });
  }
  return { path, from };
}

/** The index of the trail point nearest `p`, searching back from the pen only `maxBack` of path
 *  (see `catchUpPath`); -1 for an empty trail. */
export function nearestTrailIndex(trail: readonly Pt[], p: Pt, maxBack: number): number {
  const n = trail.length;
  if (n === 0) return -1;
  let nearest = n - 1;
  let best = Math.hypot(trail[n - 1].x - p.x, trail[n - 1].y - p.y);
  let back = 0;
  for (let i = n - 2; i >= 0; i--) {
    back += Math.hypot(trail[i + 1].x - trail[i].x, trail[i + 1].y - trail[i].y);
    if (back > maxBack) break;
    const d = Math.hypot(trail[i].x - p.x, trail[i].y - p.y);
    if (d < best) {
      best = d;
      nearest = i;
    }
  }
  return nearest;
}

/**
 * When the pen was at `p` — a point of the lagging line — from the trail's times: projected onto
 * the trail segments either side of the nearest point and interpolated. The line's points are
 * stamped with THIS, not the event's time: the rope trails the pen by up to a string length, so
 * stamping it "now" put the pen's slowdown into the line a string's length early, and Ink's Pool
 * swelled a knot there, before the real end. Null for an empty trail.
 */
export function trailTimeAt(
  trail: readonly (Pt & { t: number })[],
  p: Pt,
  maxBack: number,
): number | null {
  const i = nearestTrailIndex(trail, p, maxBack);
  if (i < 0) return null;
  let best = { d: Infinity, t: trail[i].t };
  for (const j of [i - 1, i]) {
    const a = trail[j];
    const b = trail[j + 1];
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const k = len2 > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
    const d = Math.hypot(a.x + dx * k - p.x, a.y + dy * k - p.y);
    if (d < best.d) best = { d, t: a.t + (b.t - a.t) * k };
  }
  return best.t;
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
  points = collapseRests(points);
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

/** `points` with each run at one position cut to its first and last point. A resting pen keeps
 *  adding points at the rest point (input.ts keeps them for the ink engine's Pool), and every one
 *  of them is in every other's averaging window: a 5 s hold made each redraw ~20× slower. The pair
 *  keeps the rest's time span, which `pauseBreaks` reads. (slop-animator only.) */
function collapseRests(points: InputPoint[]): InputPoint[] {
  const out: InputPoint[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const prev = points[i - 1];
    const next = points[i + 1];
    const samePrev = prev && prev.x === p.x && prev.y === p.y;
    const sameNext = next && next.x === p.x && next.y === p.y;
    if (samePrev && sameNext) continue;
    out.push(p);
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
