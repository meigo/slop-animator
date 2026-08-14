export function videoClipLayout(
  offsetFrames: number,
  speed: number,
  durationSec: number,
  fps: number,
): { startFrame: number; spanFrames: number } {
  const spd = speed > 0 ? speed : 1;
  // `|| 0` collapses IEEE -0 (from `-offsetFrames` when offset is 0) so
  // callers and deep equality see plain 0.
  return {
    startFrame: Math.round(-offsetFrames / spd) || 0,
    spanFrames: Math.max(0, Math.ceil((durationSec * fps) / spd)),
  };
}

/** New `offsetFrames` after sliding the visible start by `deltaFrames` (right = +). */
export function offsetAfterClipDrag(
  startFrame: number,
  deltaFrames: number,
  speed: number,
): number {
  const spd = speed > 0 ? speed : 1;
  return -(startFrame + deltaFrames) * spd;
}
