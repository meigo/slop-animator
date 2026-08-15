/** Layout geometry for the resizable layer panel (pure; no DOM). Mirrors `timeline-layout.ts`. */

/** Below this the layer detail row wraps to several lines and the name column stops being useful.
 *  It is a floor, not a target — the row is `flex-wrap` by design, so narrower degrades rather than
 *  clips. */
export const MIN_PANEL_WIDTH = 180;
/** Tailwind `w-56`, the fixed width the panel had before it became resizable, so an existing
 *  project opens looking identical. */
export const DEFAULT_PANEL_WIDTH = 224;

/** Clamp a proposed layer-panel width (px) to [MIN, 50% of the viewport], MIN always winning —
 *  the same shape as `clampTimelineHeight`, so a narrow window can never strand the panel wider
 *  than the screen and leave the canvas with nothing. */
export function clampPanelWidth(px: number, viewportW: number): number {
  const max = Math.max(MIN_PANEL_WIDTH, Math.round(viewportW * 0.5));
  return Math.max(MIN_PANEL_WIDTH, Math.min(px, max));
}
