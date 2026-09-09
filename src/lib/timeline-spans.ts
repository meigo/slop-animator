/**
 * Hold runs as Flash draws them: a keyframe plus the frames it holds over, as ONE span.
 *
 * Derived from `computeTimelineGlyphs`'s output rather than from the cells, deliberately. That
 * function already answers every hard question — which key resolves at a frame, whether it has
 * ink, and that an inked key keeps holding past the end of the stored track — and it is tested.
 * Re-deriving any of that here would create a second answer that can drift from the first.
 *
 * `endFrame` is INCLUSIVE. A `blank` span is a `◇` keyframe: a real boundary with no content,
 * drawn as an outline rather than a fill, and always one frame long because nothing holds over it.
 */
export interface TimelineSpan {
  startFrame: number;
  endFrame: number;
  blank: boolean;
}

export function computeTimelineSpans(glyphs: string[]): TimelineSpan[] {
  const out: TimelineSpan[] = [];
  for (let f = 0; f < glyphs.length; f++) {
    const g = glyphs[f];
    if (g === "◆") {
      let end = f;
      while (end + 1 < glyphs.length && glyphs[end + 1] === "—") end++;
      out.push({ startFrame: f, endFrame: end, blank: false });
      f = end;
    } else if (g === "◇") {
      out.push({ startFrame: f, endFrame: f, blank: true });
    }
  }
  return out;
}
