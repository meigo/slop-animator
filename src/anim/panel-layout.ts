/** Layout geometry for the resizable layer panel (pure; no DOM). Mirrors `timeline-layout.ts`. */

/** Below this the layer detail row wraps to several lines and the name column stops being useful.
 *  It is a floor, not a target — the row is `flex-wrap` by design, so narrower degrades rather than
 *  clips. 180 of usable content PLUS the 4px strip reserved for the resize grip — the guarantee is
 *  about content width, so the reserved strip has to be added on top of it. */
export const MIN_PANEL_WIDTH = 184;
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

/** Below this the layer-name column stops fitting a useful number of characters. */
export const MIN_GUTTER_LABEL_WIDTH = 80;
/** The width the timeline's name column had when it was the fixed `LABEL_W` constant. */
export const DEFAULT_GUTTER_LABEL_WIDTH = 120;

/** Clamp the timeline gutter's NAME column (px) to [MIN, 40% of the viewport], MIN always winning.
 *  40% rather than the panel's 50%: this column eats horizontally into the frame strip, which is the
 *  timeline's actual content, so it earns a tighter ceiling. Excludes the fixed marker column —
 *  callers add `MARKER_W` themselves, as `GUTTER_W` does. */
export function clampGutterLabelWidth(px: number, viewportW: number): number {
  const max = Math.max(MIN_GUTTER_LABEL_WIDTH, Math.round(viewportW * 0.4));
  return Math.max(MIN_GUTTER_LABEL_WIDTH, Math.min(px, max));
}
