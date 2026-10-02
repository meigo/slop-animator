/**
 * Binary morphology on a w×h Uint8Array mask (1 = set). Shared by the Fill tool's `expand` and by
 * the Pose tool's outline filling. The structuring element is a CIRCLE of the given radius, so
 * radius 1 is a plus, not a 3×3 block — a detail the callers' measured behaviour depends on.
 */

/** Offsets within a circular radius, computed once per call. */
function circleOffsets(radius: number): [number, number][] {
  const offsets: [number, number][] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy <= radius * radius) offsets.push([dx, dy]);
    }
  }
  return offsets;
}

/**
 * Grow every set pixel by `radius`. Off-grid neighbours are simply skipped (no wrap).
 *
 * NOTE `radius <= 0` returns the CALLER'S array, not a copy — that early return is what makes gap 0
 * a true no-op, so don't write to the result assuming it is fresh.
 */
export function dilateMask(mask: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  if (radius <= 0) return mask;
  const result = new Uint8Array(w * h);
  const offsets = circleOffsets(radius);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      for (const [dx, dy] of offsets) {
        const nx = x + dx,
          ny = y + dy;
        if (nx >= 0 && nx < w && ny >= 0 && ny < h) result[ny * w + nx] = 1;
      }
    }
  }
  return result;
}

/**
 * Shrink every set region by `radius`: a pixel survives only if its whole neighbourhood is set.
 * Off-grid counts as CLEAR, so a shape flush to the edge erodes there — the alternative (treating
 * off-grid as set) lets a dilated mask reach the border and swallow the whole bitmap.
 *
 * NOTE `radius <= 0` returns the CALLER'S array, not a copy (as `dilateMask`) — don't write to the
 * result assuming it is fresh.
 */
export function erodeMask(mask: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  if (radius <= 0) return mask;
  const result = new Uint8Array(w * h);
  const offsets = circleOffsets(radius);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let all = 1;
      for (const [dx, dy] of offsets) {
        const nx = x + dx,
          ny = y + dy;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h || !mask[ny * w + nx]) {
          all = 0;
          break;
        }
      }
      result[y * w + x] = all;
    }
  }
  return result;
}

/**
 * Each pixel's Euclidean distance, in px, to the nearest set pixel of `mask` (0 on it; Infinity
 * when the mask is empty). Exact, in linear time: Felzenszwalb & Huttenlocher's squared-distance
 * transform, columns then rows. Used to grow a fill by a SMOOTH round offset with an antialiased
 * edge (`expandedCoverage` in fill.ts), where `dilateMask` grows it in whole pixels. Pure.
 */
export function distanceToMask(mask: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e20;
  const f = new Float64Array(Math.max(w, h));
  const d = new Float64Array(Math.max(w, h));
  const v = new Int32Array(Math.max(w, h));
  const z = new Float64Array(Math.max(w, h) + 1);
  const grid = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) grid[i] = mask[i] ? 0 : INF;
  // 1-D squared distance transform of f[0..n) into d.
  const pass = (n: number) => {
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }
  };
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x];
    pass(h);
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y];
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = grid[y * w + x];
    pass(w);
    for (let x = 0; x < w; x++) out[y * w + x] = d[x] >= INF / 2 ? Infinity : Math.sqrt(d[x]);
  }
  return out;
}
