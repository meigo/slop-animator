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
