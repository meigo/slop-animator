/**
 * Freezing a long stroke (2026-10-02, port of slop-paint b89284d; see `frozenTo` in Canvas.svelte):
 * where the stroke's settled part ends — the last input point at least `marginPx` of TRAVEL and
 * `minPts` points behind the pen, so new points can no longer change what is drawn up to it.
 *
 * Travel counts only steps of `MIN_STEP_PX` or more from the last counted point. A resting Pencil
 * at Stream 0 keeps sending jitter points; summed as raw path length they "travelled" the margin
 * while the pen stood still, the settled point landed inside the rest, and Calligraphy — which keeps
 * no sample there (its decimation spacing is up to 3 px) — baked a piece running to the moving end:
 * a notch at the corner where the artist paused (found by this app's review; slop-paint's loop has
 * the same flaw). 0 when the stroke is shorter than the margin.
 */
export const MIN_STEP_PX = 3;

export function settledIndex(
  pts: readonly { x: number; y: number }[],
  marginPx: number,
  minPts: number,
): number {
  let i = pts.length - 1;
  if (i < 0) return 0;
  let d = 0;
  let ax = pts[i].x;
  let ay = pts[i].y;
  while (i > 0 && (d < marginPx || pts.length - 1 - i < minPts)) {
    const s = Math.hypot(pts[i - 1].x - ax, pts[i - 1].y - ay);
    if (s >= MIN_STEP_PX) {
      d += s;
      ax = pts[i - 1].x;
      ay = pts[i - 1].y;
    }
    i--;
  }
  return i;
}
