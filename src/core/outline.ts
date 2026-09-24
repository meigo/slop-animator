/**
 * Outline-from-alpha: the pure half of the Outline tool. Turns a cell's alpha plane into an
 * outline of adjustable thickness, with two noise-driven knobs.
 *
 * See `docs/superpowers/specs/2026-09-24-outline-from-alpha-design.md`. The short version: a
 * SIGNED distance field (positive inside), seeded sub-pixel from the brush's anti-aliasing, then
 * keep the pixels whose distance falls inside a band whose offset (Wobble) and width (Variation)
 * come from two seeded noise fields. Signed rather than inside-only because an inside-only field
 * clips an outward wobble, leaving something indistinguishable from Variation.
 */

const ORTH = 1;
const DIAG = Math.SQRT2;
const FAR = 1e9;

/**
 * Distance in px from each pixel centre to the shape's edge: POSITIVE inside, NEGATIVE outside.
 *
 * Two-pass chamfer (orthogonal 1, diagonal √2 — about 4% high on long diagonals, under 1px at the
 * tool's maximum thickness). Boundary pixels are seeded at `|alpha/255 - 0.5|` rather than 0, so a
 * hard edge lands half a pixel outside the last opaque pixel (geometrically right) and an
 * anti-aliased edge keeps its sub-pixel position — which is what stops outlined text going blocky.
 *
 * Off-canvas counts as OUTSIDE, matching `erodeMask`'s documented convention, so a shape running
 * off the edge of the canvas is outlined along that edge.
 */
export function signedDistanceField(
  alpha: Uint8Array | Uint8ClampedArray,
  w: number,
  h: number,
): Float32Array {
  const n = w * h;
  const inside = new Uint8Array(n);
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    inside[i] = alpha[i] >= 128 ? 1 : 0;
    d[i] = FAR;
  }
  // Seed every pixel that has a differently-classified 4-neighbour (off-grid = outside).
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const me = inside[i];
      const left = x > 0 ? inside[i - 1] : 0;
      const right = x < w - 1 ? inside[i + 1] : 0;
      const up = y > 0 ? inside[i - w] : 0;
      const down = y < h - 1 ? inside[i + w] : 0;
      if (left !== me || right !== me || up !== me || down !== me) {
        d[i] = Math.abs(alpha[i] / 255 - 0.5);
      }
    }
  }
  // Forward pass: top-left to bottom-right.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + ORTH);
      if (y > 0) v = Math.min(v, d[i - w] + ORTH);
      if (y > 0 && x > 0) v = Math.min(v, d[i - w - 1] + DIAG);
      if (y > 0 && x < w - 1) v = Math.min(v, d[i - w + 1] + DIAG);
      d[i] = v;
    }
  }
  // Backward pass: bottom-right to top-left.
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = d[i];
      if (x < w - 1) v = Math.min(v, d[i + 1] + ORTH);
      if (y < h - 1) v = Math.min(v, d[i + w] + ORTH);
      if (y < h - 1 && x < w - 1) v = Math.min(v, d[i + w + 1] + DIAG);
      if (y < h - 1 && x > 0) v = Math.min(v, d[i + w - 1] + DIAG);
      d[i] = v;
    }
  }
  for (let i = 0; i < n; i++) if (!inside[i]) d[i] = -d[i];
  return d;
}

/** Integer hash → [0, 1). `Math.imul` keeps the multiplies in 32-bit, which is both faster and
 *  reproducible across engines (a plain `*` would go through doubles and lose the low bits). */
function hash2(xi: number, yi: number, seed: number): number {
  let n = Math.imul(xi, 374761393) ^ Math.imul(yi, 668265263) ^ Math.imul(seed, 1274126177);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

const smoothstep = (t: number): number => t * t * (3 - 2 * t);

/** Smooth 2D value noise in [-1, 1]. `x`/`y` are lattice units: divide px by the feature size. */
export function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const tx = smoothstep(x - xi);
  const ty = smoothstep(y - yi);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const e = hash2(xi + 1, yi + 1, seed);
  const top = a + (b - a) * tx;
  const bottom = c + (e - c) * tx;
  return (top + (bottom - top) * ty) * 2 - 1;
}

/** Widest band the tool offers. The cost is flat in thickness (the field does the work), so this
 *  is a taste limit, not a performance one. */
export const MAX_THICKNESS = 24;
/** How far Wobble at 100% moves the line across the true edge, in px. */
export const WOBBLE_MAX = 3;
/** How much Variation at 100% swells or thins the band, as a fraction of `thickness`. */
export const VARIATION_MAX = 0.6;
/** The band never goes below this, so the line cannot break. Gaps were a deliberate non-goal —
 *  see the spec's decision 3; a `MIN_WIDTH` of 0 is how you would get them. */
export const MIN_WIDTH = 0.75;
/** Noise lattice size in px. What makes the variation read as hand movement rather than static. */
export const FEATURE_PX = 24;

export interface OutlineOptions {
  /** Band width in device px. Clamped to 0..MAX_THICKNESS; 0 yields an empty result. */
  thickness: number;
  /** 0..1 — how far the line wanders across the true edge. */
  wobble: number;
  /** 0..1 — how much the width swells and thins. */
  variation: number;
  /** Any integer. The same seed and options give byte-identical output. */
  seed: number;
}

/** Coerce anything a caller (or a `NumberField`, which writes `null` when emptied) might supply.
 *  Mirrors `clampGap` in `fill-holes.ts`, and for the same reason. */
export function clampThickness(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(MAX_THICKNESS, Math.max(0, n));
}

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/**
 * Alpha coverage (0..255) of the outline for `alpha`.
 *
 * `field` lets the caller reuse a `signedDistanceField` across knob changes: the field depends on
 * the ART only, so the tool computes it once per entry and every thickness/wobble/variation change
 * then costs one pass. Pass nothing and it is computed here.
 */
export function outlineMask(
  alpha: Uint8Array | Uint8ClampedArray,
  w: number,
  h: number,
  opts: OutlineOptions,
  field?: Float32Array,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h);
  const thickness = clampThickness(opts.thickness);
  if (thickness <= 0) return out;
  const wobble = clamp01(opts.wobble);
  const variation = clamp01(opts.variation);
  const seed = Number.isFinite(opts.seed) ? Math.trunc(opts.seed) : 0;
  const d = field ?? signedDistanceField(alpha, w, h);
  // A second, independent field for the width. Offsetting the lattice as well as the seed keeps the
  // two from sharing their zero crossings, which would tie a thin spot to an inward wobble.
  const widthSeed = seed ^ 0x9e3779b9;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const offset =
        wobble === 0 ? 0 : WOBBLE_MAX * wobble * valueNoise(x / FEATURE_PX, y / FEATURE_PX, seed);
      const width =
        variation === 0
          ? thickness
          : Math.max(
              MIN_WIDTH,
              thickness *
                (1 +
                  VARIATION_MAX *
                    variation *
                    valueNoise(x / FEATURE_PX + 11.5, y / FEATURE_PX + 7.25, widthSeed)),
            );
      // One-pixel ramp centred on each edge of the band: +0.5 puts the 50% point ON the boundary.
      const coverage = Math.min(d[i] - offset, offset + width - d[i]) + 0.5;
      out[i] = coverage <= 0 ? 0 : coverage >= 1 ? 255 : Math.round(coverage * 255);
    }
  }
  return out;
}
