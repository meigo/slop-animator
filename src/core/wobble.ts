import type { InputPoint } from "./input";

/*
 * Wobble (2026-10-03): an uneven outline for the outline brushes (Smooth, Calligraphy,
 * Watercolour). Each point is moved by noise of its PAGE position, so a point drawn once lands in
 * the same place every frame however the stroke grows, and two pieces sharing a point stay joined.
 */

/** The stroke's seed: from its first point, which stays put while the stroke grows. */
export function strokeSeed(first: InputPoint): number {
  const h = Math.imul(Math.round(first.x * 16) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.round(first.y * 16);
  return Math.imul(h ^ Math.round(first.timestamp), 0xc2b2ae35) >>> 0 || 1;
}

/** Smooth 2D value noise in [0, 1], one random value per integer lattice point, cosine-blended. */
export function noise2(key: number, x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const tx = (1 - Math.cos((x - ix) * Math.PI)) / 2;
  const ty = (1 - Math.cos((y - iy) * Math.PI)) / 2;
  const a = lattice2(key, ix, iy);
  const b = lattice2(key, ix + 1, iy);
  const c = lattice2(key, ix, iy + 1);
  const d = lattice2(key, ix + 1, iy + 1);
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

/** The noise's random value at lattice point (x, y), 0–1. The key is scrambled before it meets x:
 *  `key ^ x` made `seed + 1`'s noise `seed`'s with neighbouring columns swapped (for an even seed),
 *  so the dx and dy wobble were correlated and edges along one diagonal wobbled less (2026-10-17). */
export function lattice2(key: number, x: number, y: number): number {
  const k = Math.imul(key ^ (key >>> 15), 0x9e3779b1);
  let t = (Math.imul(k ^ x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * The outline moved in or out by noise of its PAGE position, so a point drawn once lands in the
 * same place every frame however the stroke grows. `amp` (document px) is the most it moves;
 * `scale` (document px) the size of the bumps. `fine` adds a second octave, 2.5× finer at half the
 * amplitude: Smooth's and Watercolour's sparse, curved outlines smooth it away, but Calligraphy's
 * straight-edged pieces, corners ≤ 3 px apart, kept every bump and came out ragged — it passes
 * `fine = false` (2026-10-03, the user's call: "softer like Smooth").
 *
 * `spine` (Smooth, 2026-10-21): the stroke's centre line as [x, y, half-width] points. With it, a
 * point moves INWARD by at most half the local half-width (`spineAt`), so where both edges move in
 * the stroke keeps at least half its width: `amp` follows the WIDEST width, and at Wobble ~100,
 * Press 3, the lightest parts pinched to nothing. Outward and along the edge it moves as before, so
 * where the stroke is wide nothing changes.
 */
export function wobbleOutline(
  outline: number[][],
  seed: number,
  amp: number,
  scale: number,
  fine: boolean = true,
  spine?: number[][],
): number[][] {
  if (!(amp > 0) || !(scale > 0)) return outline;
  const s1 = 1 / scale;
  const s2 = 2.5 / scale;
  // Both ways the most a point moves is `amp`.
  const k = fine ? amp / 1.5 : amp;
  // No point anywhere could move in more than allowed: skip the lookup (low Wobble).
  let minR = Infinity;
  for (const p of spine ?? []) if (p[2] < minR) minR = p[2];
  const at = spine?.length && amp > minR / 2 ? spineAt(spine) : null;
  return outline.map(([x, y, ...rest]) => {
    let dx = (noise2(seed, x * s1, y * s1) - 0.5) * 2;
    let dy = (noise2(seed + 1, x * s1, y * s1) - 0.5) * 2;
    if (fine) {
      dx += noise2(seed + 2, x * s2, y * s2) - 0.5;
      dy += noise2(seed + 3, x * s2, y * s2) - 0.5;
    }
    dx *= k;
    dy *= k;
    const c = at?.(x, y);
    if (c) {
      const ox = x - c[0];
      const oy = y - c[1];
      const len = Math.hypot(ox, oy);
      if (len > 1e-9) {
        const nx = ox / len;
        const ny = oy / len;
        const over = -(dx * nx + dy * ny) - c[2] / 2;
        if (over > 0) {
          dx += over * nx;
          dy += over * ny;
        }
      }
    }
    return [x + dx, y + dy, ...rest];
  });
}

/**
 * A lookup from an outline point to the spine point it was drawn around: from the EARLIEST one
 * whose disc (half-width plus a little slack for perfect-freehand's streamlining) holds it, the
 * nearest along the path from there; else the nearest. The earliest pass, so a later pass
 * crossing an earlier one never changes which spine point an earlier part's edge belongs to — a
 * drawn part stays put as the stroke grows. Bucketed on a grid, so it stays cheap on a long
 * stroke.
 */
function spineAt(spine: number[][]): (x: number, y: number) => number[] | null {
  let maxR = 0;
  for (const p of spine) if (p[2] > maxR) maxR = p[2];
  const slack = (r: number) => Math.max(1, r * 0.25);
  const cell = Math.max(1, maxR + slack(maxR));
  const key = (gx: number, gy: number) => gx * 1048576 + gy;
  const grid = new Map<number, number[]>();
  spine.forEach((p, i) => {
    const k = key(Math.floor(p[0] / cell), Math.floor(p[1] / cell));
    const list = grid.get(k);
    if (list) list.push(i);
    else grid.set(k, [i]);
  });
  const d2 = (j: number, x: number, y: number) => {
    const dx = x - spine[j][0];
    const dy = y - spine[j][1];
    return dx * dx + dy * dy;
  };
  return (x, y) => {
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    let first = -1;
    let nearest = -1;
    let nearestD = Infinity;
    for (let gy = cy - 1; gy <= cy + 1; gy++) {
      for (let gx = cx - 1; gx <= cx + 1; gx++) {
        const list = grid.get(key(gx, gy));
        if (!list) continue;
        for (const i of list) {
          const d = d2(i, x, y);
          const reach = spine[i][2] + slack(spine[i][2]);
          if (d <= reach * reach && (first < 0 || i < first)) first = i;
          if (d < nearestD) {
            nearestD = d;
            nearest = i;
          }
        }
      }
    }
    if (first < 0 && nearest < 0) return null;
    // On from there to the nearest point of that same pass: the earliest disc's centre lies behind,
    // and the direction from it leans along the stroke, which let the edge in sideways.
    let i = first >= 0 ? first : nearest;
    while (i + 1 < spine.length && d2(i + 1, x, y) < d2(i, x, y)) i++;
    // And onto the path between the points either side, so the direction is square to the stroke
    // (from a spine POINT it still leaned by up to half their spacing).
    let best = spine[i];
    let bestD = d2(i, x, y);
    for (let j = i - 1; j <= i; j++) {
      if (j < 0 || j + 1 >= spine.length) continue;
      const [ax, ay, ar] = spine[j];
      const [bx, by, br] = spine[j + 1];
      const lx = bx - ax;
      const ly = by - ay;
      const l2 = lx * lx + ly * ly;
      if (!(l2 > 0)) continue;
      const t = Math.max(0, Math.min(1, ((x - ax) * lx + (y - ay) * ly) / l2));
      const qx = ax + lx * t;
      const qy = ay + ly * t;
      const d = (x - qx) * (x - qx) + (y - qy) * (y - qy);
      if (d < bestD) {
        best = [qx, qy, ar + (br - ar) * t];
        bestD = d;
      }
    }
    return best;
  };
}

/** How far the outline moves at Wobble 0–100, for a stroke `width` document px wide at most. */
export function wobbleAmp(width: number, wobble: number): number {
  return (Math.max(0, Math.min(100, wobble)) / 100) * 0.2 * width;
}

/** The size of the bumps for a stroke `width` document px wide at most: a third of the width, so the
 *  two edges wobble on their own instead of the whole stroke bending. */
export function wobbleScale(width: number): number {
  return Math.max(3, width * 0.35);
}
