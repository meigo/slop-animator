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

/** The noise's random value at lattice point (x, y), 0–1. */
export function lattice2(key: number, x: number, y: number): number {
  let t = (Math.imul(key ^ x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * The outline moved in or out by noise of its PAGE position, so a point drawn once lands in the
 * same place every frame however the stroke grows. `amp` (document px) is the most it moves;
 * `scale` (document px) the size of the bumps; a second, finer octave at half the amplitude.
 */
export function wobbleOutline(
  outline: number[][],
  seed: number,
  amp: number,
  scale: number,
): number[][] {
  if (!(amp > 0) || !(scale > 0)) return outline;
  const s1 = 1 / scale;
  const s2 = 2.5 / scale;
  return outline.map(([x, y, ...rest]) => {
    const dx = (noise2(seed, x * s1, y * s1) - 0.5) * 2 + (noise2(seed + 2, x * s2, y * s2) - 0.5);
    const dy =
      (noise2(seed + 1, x * s1, y * s1) - 0.5) * 2 + (noise2(seed + 3, x * s2, y * s2) - 0.5);
    return [x + (dx * amp) / 1.5, y + (dy * amp) / 1.5, ...rest];
  });
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
