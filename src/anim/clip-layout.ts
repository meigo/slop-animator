export const VIDEO_MIN_TRIM_FRAMES = 1;

export type VideoTrim = {
  trimInFrames?: number;
  trimLenFrames?: number;
};

export function videoClipLayout(
  offsetFrames: number,
  speed: number,
  durationSec: number,
  fps: number,
  trim?: VideoTrim,
): { startFrame: number; spanFrames: number } {
  const spd = speed > 0 ? speed : 1;
  // `|| 0` collapses IEEE -0 (from `-offsetFrames` when offset is 0) so
  // callers and deep equality see plain 0.
  const startFrame = Math.round(-offsetFrames / spd) || 0;
  // Absent trim keeps the original formula exactly: going through an integer source
  // extent first can differ from `ceil((duration*fps)/speed)` by a frame at awkward
  // ratios, and an untrimmed clip must not change size just because the 5th argument
  // exists.
  if (trim == null || (trim.trimInFrames == null && trim.trimLenFrames == null)) {
    return { startFrame, spanFrames: Math.max(0, Math.ceil((durationSec * fps) / spd)) };
  }
  const extent = Math.max(0, Math.ceil(durationSec * fps));
  const { trimLenFrames } = videoTrimSpan(trim.trimInFrames, trim.trimLenFrames, extent);
  return { startFrame, spanFrames: Math.max(0, Math.ceil(trimLenFrames / spd)) };
}

/** `offsetFrames` that places SOURCE frame 0. Video `startFrame` is `round(-offset/speed)`, and a
 *  head trim DECREASES offset while INCREASING trimIn — adding them cancels, so the file's first
 *  frame stays put. Audio subtracts because its offset moves the other way. */
export function videoClipOriginOffset(
  offsetFrames: number,
  trimInFrames: number | undefined,
): number {
  return offsetFrames + Math.max(0, trimInFrames ?? 0);
}

/** Video element time for project `frame`. `trimInFrames` is SOURCE frames added only here —
 *  the same two-clock rule audio uses (`inS` only at `start()`). */
export function videoWantedTime(
  frame: number,
  offsetFrames: number,
  speed: number,
  fps: number,
  trimInFrames?: number,
): number {
  const spd = speed > 0 ? speed : 1;
  const off = Number.isFinite(offsetFrames) ? offsetFrames : 0;
  const tin = Number.isFinite(trimInFrames) ? Math.max(0, trimInFrames ?? 0) : 0;
  return (tin + off + frame * spd) / fps;
}

export function videoTrimSpan(
  trimInFrames: number | undefined,
  trimLenFrames: number | undefined,
  extentFrames: number,
): { trimInFrames: number; trimLenFrames: number } {
  const tin = Math.max(0, trimInFrames ?? 0);
  const remaining = Math.max(0, extentFrames - tin);
  const len = trimLenFrames == null ? remaining : Math.max(0, Math.min(trimLenFrames, remaining));
  return { trimInFrames: tin, trimLenFrames: len };
}

/** Drag the video HEAD by `deltaProjectFrames` (right = skip more of the file).
 *
 *  Video `startFrame` is `round(-offset/speed)`, so a project-frame drag must move offset by
 *  `-Δ·speed` and trimIn by `+Δ·speed`. Same-delta (the audio rule) would re-sync the picture.
 *  The SOURCE delta is clamped as one number so offset and trimIn cannot be clamped apart. */
export function trimVideoHead(
  offsetFrames: number,
  trimInFrames: number | undefined,
  trimLenFrames: number | undefined,
  deltaProjectFrames: number,
  speed: number,
  extentFrames: number,
): { offsetFrames: number; trimInFrames: number; trimLenFrames: number } {
  const spd = speed > 0 ? speed : 1;
  const tin = Math.max(0, trimInFrames ?? 0);
  const len = trimLenFrames ?? extentFrames - tin;
  const lo = -tin;
  const hi = len - VIDEO_MIN_TRIM_FRAMES;
  const dSrc = Math.max(lo, Math.min(deltaProjectFrames * spd, hi));
  return {
    offsetFrames: offsetFrames - dSrc,
    trimInFrames: tin + dSrc,
    trimLenFrames: len - dSrc,
  };
}

/** Drag the video TAIL by `deltaProjectFrames` (right = longer). Source-scaled like the head. */
export function trimVideoTail(
  trimInFrames: number | undefined,
  trimLenFrames: number | undefined,
  deltaProjectFrames: number,
  speed: number,
  extentFrames: number,
): { trimInFrames: number; trimLenFrames: number } {
  const spd = speed > 0 ? speed : 1;
  const tin = Math.max(0, trimInFrames ?? 0);
  const cur = trimLenFrames ?? extentFrames - tin;
  const max = Math.max(VIDEO_MIN_TRIM_FRAMES, extentFrames - tin);
  const next = Math.max(VIDEO_MIN_TRIM_FRAMES, Math.min(cur + deltaProjectFrames * spd, max));
  return { trimInFrames: tin, trimLenFrames: next };
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

/** The `trimHead`/`trimTail` delta that lands the given EDGE on `playhead`.
 *
 *  `end` is INCLUSIVE for both clip kinds, but they store different things — a reference range holds
 *  an inclusive `end`, while audio holds a LENGTH — so the same user-visible meaning needs different
 *  arithmetic, and the audio tail carries the `+ 1`. Getting this wrong is silent: the clip simply
 *  ends one frame early or late. */
export function trimDeltaToPlayhead(
  edge: "start" | "end",
  playhead: number,
  clip: { startFrame: number; lengthFrames: number },
): number {
  if (edge === "start") return playhead - clip.startFrame;
  return playhead - clip.startFrame + 1 - clip.lengthFrames;
}
