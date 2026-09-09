/**
 * Hold runs as Flash draws them: a run of content, with a mark at every keyframe inside it.
 *
 * Derived from `computeTimelineGlyphs`'s output rather than from the cells, deliberately. That
 * function already answers every hard question — which key resolves at a frame, whether it has
 * ink, and that an inked key keeps holding past the end of the stored track — and it is tested.
 * Re-deriving any of that here would create a second answer that can drift from the first.
 *
 * `endFrame` is INCLUSIVE. **Only a blank key (or running out of content) ends a run.** Adjacent
 * inked keys do NOT: they are marked inside the span via `keyFrames`, not separated by it. Drawing
 * on 1s otherwise produced a row of disconnected one-frame blocks, when what those frames are is one
 * animated thing — and the frame that stops it is a `◇`, which is exactly what the artist reaches
 * for to end a run.
 *
 * A `blank` span is that `◇`: a real boundary with no content, always one frame long because
 * nothing holds over it, and carrying no `keyFrames` (it is not content, so it has no key mark of
 * that kind). The view draws it as a hollow diamond on its own frame with no fill behind it — the
 * frame where the ink stops is the one that owns the mark.
 */
export interface TimelineSpan {
  startFrame: number;
  endFrame: number;
  blank: boolean;
  /** Frames inside this span carrying a `◆`. Always non-empty for a content span (a run starts at
   *  a key), always empty for a blank one. */
  keyFrames: number[];
}

export function computeTimelineSpans(glyphs: string[]): TimelineSpan[] {
  const out: TimelineSpan[] = [];
  let run: TimelineSpan | null = null; // the content run being extended, if any
  for (let f = 0; f < glyphs.length; f++) {
    const g = glyphs[f];
    if (g === "◆") {
      if (run) {
        run.endFrame = f;
        run.keyFrames.push(f);
      } else {
        run = { startFrame: f, endFrame: f, blank: false, keyFrames: [f] };
        out.push(run);
      }
    } else if (g === "—") {
      // A hold only ever continues the key before it in `computeTimelineGlyphs` output. It does NOT
      // in `Timeline.svelte`'s block-drag preview (`displayGlyph`), which blanks the vacated source
      // range and strands the holds that followed the dragged key — dragging a key out of its own
      // run yields ["", "—", "◆", "—"], whose f=1 is a hold with no key before it. This guard is
      // therefore load-bearing, not belt-and-braces: without it that render throws mid-drag. It also
      // keeps the `keyFrames` invariant below true, since a content span is only ever CREATED in the
      // ◆ branch and so can never come back empty. Tested; do not remove.
      if (run) run.endFrame = f;
    } else {
      // "◇" or "": content stops. The blank key gets its own one-frame span; "" gets nothing.
      run = null;
      if (g === "◇") out.push({ startFrame: f, endFrame: f, blank: true, keyFrames: [] });
    }
  }
  return out;
}
