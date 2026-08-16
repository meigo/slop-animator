/** Audio clip trim arithmetic (pure; no DOM, no Web Audio).
 *
 *  Trim is stored as SOURCE frames — `trimInFrames` skipped at the head, `trimLenFrames` kept from
 *  there — matching `offsetFrames`, which is also frames. Both are optional on the track; absent
 *  means untrimmed, so an old project plays the whole buffer.
 */

/** A clip may never be trimmed shorter than this. Zero would be silence with a draggable edge. */
export const AUDIO_MIN_TRIM_FRAMES = 1;

/** The kept span in BUFFER seconds: where to start in the source, and how much of it to play.
 *  `lenS` floors at 0 so a nonsense trim yields silence rather than a negative duration, which
 *  `AudioBufferSourceNode.start()` would throw on. */
export function audioTrimSpan(
  trimInFrames: number | undefined,
  trimLenFrames: number | undefined,
  durationS: number,
  fps: number,
): { inS: number; lenS: number } {
  const inS = Math.max(0, (trimInFrames ?? 0) / fps);
  const remainingS = Math.max(0, durationS - inS);
  const lenS =
    trimLenFrames == null ? remainingS : Math.max(0, Math.min(trimLenFrames / fps, remainingS));
  return { inS, lenS };
}

/** Drag the TAIL handle by `deltaFrames` (right = longer). Capped at the source's extent and
 *  floored at one frame. `extentFrames` is the whole buffer in frames (`audioFrameSpan`). */
export function trimTail(
  trimInFrames: number | undefined,
  trimLenFrames: number | undefined,
  deltaFrames: number,
  extentFrames: number,
): { trimInFrames: number; trimLenFrames: number } {
  const tin = Math.max(0, trimInFrames ?? 0);
  const cur = trimLenFrames ?? extentFrames - tin;
  const max = Math.max(AUDIO_MIN_TRIM_FRAMES, extentFrames - tin);
  const next = Math.max(AUDIO_MIN_TRIM_FRAMES, Math.min(cur + deltaFrames, max));
  return { trimInFrames: tin, trimLenFrames: next };
}

/** Drag the HEAD handle by `deltaFrames` (right = trim more off the front).
 *
 *  `offsetFrames` and `trimInFrames` move by the SAME delta on purpose: the two changes cancel in
 *  project time, so the audio you KEEP stays under the same frames it was already under. Trimming
 *  usually happens because the sync is already right, so a head trim must not re-sync the clip. */
export function trimHead(
  offsetFrames: number,
  trimInFrames: number | undefined,
  trimLenFrames: number | undefined,
  deltaFrames: number,
  extentFrames: number,
): { offsetFrames: number; trimInFrames: number; trimLenFrames: number } {
  const tin = Math.max(0, trimInFrames ?? 0);
  const len = trimLenFrames ?? extentFrames - tin;
  // Clamp the delta itself, so offset and in-point cannot be clamped by different amounts and
  // break the invariant this function exists to hold.
  const lo = -tin; // cannot skip less than nothing
  const hi = len - AUDIO_MIN_TRIM_FRAMES; // cannot eat the last frame
  const d = Math.max(lo, Math.min(deltaFrames, hi));
  return { offsetFrames: offsetFrames + d, trimInFrames: tin + d, trimLenFrames: len - d };
}
