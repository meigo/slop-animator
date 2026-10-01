/** What a row drag in the layers panel looks like (2026-10-01): the dragged row follows the pointer
 *  and the rows below the drop point slide down to open a gap — drawn over `layer-drop.ts`'s
 *  `dropTarget`, which alone decides where a drop lands. Copied from slop-vector-editor
 *  (SLOP-LAYER-DRAG.md); here rows are keyed (`l12` / `g3`: layer and group ids can collide) and
 *  the row height is passed in.
 *  Pure: no DOM, so it is testable. Every position is in the list's CONTENT coordinates (client y −
 *  list top + scrollTop), measured once when the drag starts, so rows sliding aside never move
 *  the targets they are measured against. */
import type { RowBox } from "../anim/layer-drop";

/** How far the pointer travels before a press on a grip becomes a drag, so a tap lifts nothing. */
export const DRAG_THRESHOLD_PX = 3;
/** slop-vector-editor's row height, the default where a caller doesn't pass its own. */
export const ROW_PX = 32;
/** The band at the list's top and bottom edge that scrolls it, and the fastest step per frame. */
export const SCROLL_EDGE_PX = 32;
export const SCROLL_MAX_PX = 12;

export function pastThreshold(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX;
}

/** The rows that slide down to open the gap: every row at or below the drop line. Nothing slides
 *  when there is no drop (a refused position), so the gap closes. */
export function shiftedRowIds(rows: readonly RowBox[], line: number | null): Set<string> {
  if (line === null) return new Set();
  return new Set(rows.filter((r) => r.top >= line - 0.5).map((r) => r.key));
}

/** The floating row's top: the pointer less where on its row it was grabbed, kept inside the
 *  content so it cannot stretch the list (and so feed the auto-scroll) past its end. */
export function ghostTop(y: number, grab: number, contentHeight: number, rowPx = ROW_PX): number {
  return Math.min(Math.max(y - grab, 0), Math.max(contentHeight - rowPx, 0));
}

/** Pixels to scroll this frame for a pointer at client `y` over a list spanning `top`…`bottom`:
 *  negative near the top edge, positive near the bottom, faster the deeper into the band (or past
 *  it), zero elsewhere. */
export function autoScrollStep(y: number, top: number, bottom: number): number {
  const band = Math.min(SCROLL_EDGE_PX, (bottom - top) / 4);
  if (!(band > 0)) return 0;
  const depth = (d: number) => Math.min(d / band, 1) * SCROLL_MAX_PX;
  if (y < top + band) return -Math.ceil(depth(top + band - y));
  if (y > bottom - band) return Math.ceil(depth(y - (bottom - band)));
  return 0;
}
