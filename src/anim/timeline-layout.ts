/** Layout geometry for the resizable timeline panel (pure; no DOM). */

export const MIN_TIMELINE_HEIGHT = 140; // toolbar + ruler + ~2 rows — keep the canvas from collapsing
export const DEFAULT_TIMELINE_HEIGHT = 260;

/** Clamp a proposed timeline height (px) to [MIN, 60% of the viewport], MIN always winning. */
export function clampTimelineHeight(px: number, viewportH: number): number {
  const max = Math.max(MIN_TIMELINE_HEIGHT, Math.round(viewportH * 0.6));
  return Math.max(MIN_TIMELINE_HEIGHT, Math.min(px, max));
}

/** Page-step scroll so the playhead stays in the visible cell strip (right of the gutter).
 *  Returns the next `scrollLeft`, or null when the caller should leave the scroll alone.
 *  Forward only while the playhead is advancing — if the user has scrolled ahead we do not
 *  yank them back. A backward jump (loop wrap) that left the view does snap. */
export function playheadFollowScroll(
  playheadX: number,
  scrollLeft: number,
  clientWidth: number,
  gutterW: number,
  pad: number,
  prevPlayheadX: number | null,
): number | null {
  const viewLeft = scrollLeft + gutterW + pad;
  const viewRight = scrollLeft + clientWidth - pad;
  if (playheadX > viewRight) return Math.max(0, playheadX - gutterW - pad);
  const wrapped = prevPlayheadX !== null && playheadX < prevPlayheadX;
  if (wrapped && playheadX < viewLeft) return Math.max(0, playheadX - gutterW - pad);
  return null;
}

/** Horizontal strip length in frames: the document, or the furthest clip tail if a video/audio
 *  clip hangs past the last frame. Every timeline row must be at least this wide so
 *  `position: sticky` gutters stay pinned — sticky is trapped in the row's own box. */
export function timelineStripFrames(frameCount: number, clipEndFrames: number[]): number {
  let max = Math.max(0, frameCount);
  for (const end of clipEndFrames) if (end > max) max = end;
  return max;
}
