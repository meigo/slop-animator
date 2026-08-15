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

/** Slide a whole range by `deltaFrames`, clamping the start at frame 0 and PRESERVING its length
 *  (a clamped slide must not silently trim — that is what the edge handles are for). */
export function rangeAfterSlide(
  range: { start: number; end: number },
  deltaFrames: number,
): { start: number; end: number } {
  const len = range.end - range.start;
  const start = Math.max(0, range.start + deltaFrames);
  return { start, end: start + len };
}

/** Trim one edge by `deltaFrames`. The start clamps at frame 0; the span never shrinks below one
 *  frame; the end may sit past the last project frame, which the timeline strip already sizes for. */
export function rangeAfterTrim(
  range: { start: number; end: number },
  edge: "start" | "end",
  deltaFrames: number,
): { start: number; end: number } {
  if (edge === "start") {
    return { start: Math.min(range.end, Math.max(0, range.start + deltaFrames)), end: range.end };
  }
  return { start: range.start, end: Math.max(range.start, range.end + deltaFrames) };
}
