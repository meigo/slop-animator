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

/** What a "trim to playhead" command should act on, given the active layer and whether the project
 *  has an audio track. Deliberately a PRECEDENCE rule rather than a selection: the timeline has no
 *  notion of an active audio row, and adding one would be new state for one command.
 *
 *  A VIDEO reference falls through to audio because its span IS its footage — there is nothing to
 *  trim. Callers surface the resolved target in the button's title, so the precedence is visible
 *  before you press rather than surprising after. */
export function trimToPlayheadTarget(
  activeLayerKind: "draw" | "image-ref" | "video-ref" | "missing-ref" | null,
  hasAudio: boolean,
): "ref" | "audio" | null {
  if (activeLayerKind === "image-ref") return "ref";
  return hasAudio ? "audio" : null;
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
