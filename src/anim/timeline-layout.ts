/** Layout geometry for the resizable timeline panel (pure; no DOM). */

export const MIN_TIMELINE_HEIGHT = 140; // toolbar + ruler + ~2 rows — keep the canvas from collapsing
export const DEFAULT_TIMELINE_HEIGHT = 260;

/** Clamp a proposed timeline height (px) to [MIN, 60% of the viewport], MIN always winning. */
export function clampTimelineHeight(px: number, viewportH: number): number {
  const max = Math.max(MIN_TIMELINE_HEIGHT, Math.round(viewportH * 0.6));
  return Math.max(MIN_TIMELINE_HEIGHT, Math.min(px, max));
}
