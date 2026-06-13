/** Opacity of the nearest onion ghost; farther ghosts fade linearly toward 0. */
export const ONION_BASE_OPACITY = 0.4;

export interface OnionFrame {
  frame: number;
  kind: "prev" | "next";
  opacity: number;
}

/** Linear fade: distance 1 → base, distance `count` → base/count. */
function ghostOpacity(distance: number, count: number): number {
  return ONION_BASE_OPACITY * ((count - distance + 1) / count);
}

/**
 * Which neighbour frames to ghost for `current`, in draw order (farthest first so the
 * nearest ghost paints on top). Out-of-range neighbours are dropped.
 */
export function computeOnionFrames(
  current: number,
  frameCount: number,
  prevCount: number,
  nextCount: number
): OnionFrame[] {
  const result: OnionFrame[] = [];

  for (let d = prevCount; d >= 1; d--) {
    const frame = current - d;
    if (frame < 0) continue;
    result.push({ frame, kind: "prev", opacity: ghostOpacity(d, prevCount) });
  }
  for (let d = nextCount; d >= 1; d--) {
    const frame = current + d;
    if (frame > frameCount - 1) continue;
    result.push({ frame, kind: "next", opacity: ghostOpacity(d, nextCount) });
  }
  return result;
}
