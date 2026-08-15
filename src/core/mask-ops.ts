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

/** Grow every set pixel by `radius`. Off-grid neighbours are simply skipped (no wrap). */
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
