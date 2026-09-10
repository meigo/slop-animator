import type { Cell } from "../anim/document";

/** What a pointer-down on a cell strip means. */
export type CellPointer =
  | { kind: "seek"; frame: number }
  | { kind: "move"; keyIndex: number }
  | { kind: "resize"; keyIndex: number };

/**
 * Resize-hotspot half-width for a given column width. Was a fixed 5px, which held only because
 * the column was a fixed 24: the invariant at Timeline.svelte:1051 requires
 * `edgePx + moveCancelPx < cellW / 2`, and at 24 that is 5 + 6 = 11 < 12 — one pixel of margin.
 * Below about 22px a fixed pair breaks it and a pending long-press can let a resize cross a column
 * boundary before it is cancelled. Both thresholds therefore scale with the column.
 */
export function edgePx(cellW: number): number {
  return Math.max(2, Math.min(5, Math.round(cellW * 0.2)));
}

/** Companion to `edgePx`: how far a pointer may travel before a pending long-press is cancelled.
 *  `Math.floor`, not `Math.round`: rounding the `.5` case upward broke the
 *  `edgePx + moveCancelPx < cellW / 2` invariant at w=14 and w=18 (both reachable zoom stops). */
export function moveCancelPx(cellW: number): number {
  return Math.max(3, Math.min(6, Math.floor(cellW * 0.25)));
}

/** Supported frame-column widths. 24 is the historical fixed value and stays the default, so
 *  nothing changes until the zoom is moved. 12 is Flash's default; below it the marks stop being
 *  hittable with a finger even with the scaled thresholds. */
export const MIN_CELL_W = 12;
export const MAX_CELL_W = 32;
export const DEFAULT_CELL_W = 24;

export function clampTimelineCellW(w: number): number {
  if (!Number.isFinite(w)) return DEFAULT_CELL_W;
  return Math.max(MIN_CELL_W, Math.min(MAX_CELL_W, Math.round(w)));
}

/**
 * Classify a pointer-down at horizontal `offsetX` (px from the track's left edge):
 * - near a keyframe or loop key's span's right edge → resize that key's hold span
 * - on the keyframe or loop key cell itself → move that key
 * - otherwise → seek to the column.
 */
export function planCellPointer(
  cells: Cell[],
  offsetX: number,
  cellW: number,
  count: number,
): CellPointer {
  const frame = columnAtX(offsetX, cellW, count);
  // The cell that owns this frame: the nearest KEY OR LOOP at/before it. A loop key owns its region
  // exactly as a key owns its holds, so both are grabbable and both have a resizable trailing edge.
  let ki: number | null = Math.min(frame, cells.length - 1);
  while (ki >= 0 && cells[ki].kind === "hold") ki--;
  if (ki < 0) ki = null;
  if (ki !== null) {
    let end = ki + 1; // exclusive end of this key's span
    while (end < cells.length && cells[end].kind === "hold") end++;
    // A TRAILING hold (no later key) runs visually to the document's last frame, not to the end of
    // the stored track — so on a layer shorter than the document the grab handle belongs where the
    // dashes stop. Anchoring it at `cells.length` put it mid-run, with the span continuing past a
    // hotspot that could no longer be reached from the visible edge.
    const spanEnd = end >= cells.length ? Math.max(end, count) : end;
    if (Math.abs(offsetX - spanEnd * cellW) <= edgePx(cellW))
      return { kind: "resize", keyIndex: ki };
    if (frame === ki) return { kind: "move", keyIndex: ki };
  }
  return { kind: "seek", frame };
}

/**
 * Map a horizontal offset (px, measured from the grid track's left edge) to a frame column
 * index, clamped to [0, count-1]. `cellW` is the fixed column width in px.
 */
export function columnAtX(offsetX: number, cellW: number, count: number): number {
  if (count <= 0) return 0;
  const i = Math.floor(offsetX / cellW);
  return Math.max(0, Math.min(count - 1, i));
}

/**
 * Map a horizontal offset (px from the frame strip's left edge) to an animation LENGTH in frames,
 * clamped to the model's 1..9999. Unlike `columnAtX` this ROUNDS and is 1-based: the length handle
 * sits on a column BOUNDARY (the boundary at `n * cellW` means "n frames"), not inside a cell.
 */
export function lengthAtX(offsetX: number, cellW: number): number {
  return Math.max(1, Math.min(9999, Math.round(offsetX / cellW)));
}

/**
 * The `scrollLeft` that keeps the PLAYHEAD at the screen x it already occupies while the frame
 * column width changes from `fromW` to `toW`.
 *
 * Zooming a timeline from its left edge is the wrong origin: the frame you are working on is the one
 * you want to keep looking at, and between 12px and 32px a frame 200 columns out travels 4000px — so
 * the playhead leaves the viewport on almost any zoom that matters. Anchoring on it is what every NLE
 * does and it costs one subtraction.
 *
 * The playhead's CONTENT x is `gutterW + frame * w + w / 2` — the same expression the playhead line
 * itself uses. Note the trailing half column: it is why "just scale scrollLeft" is wrong even at
 * frame 0, whose centre moves 12px → 16px away from the gutter on a 24 → 32 zoom.
 *
 * `gutterW` cancels (this is a difference of two content positions at the same gutter), so a
 * user-widened name column cannot change how zoom behaves — asserted in the tests rather than left
 * as a claim. It is still a parameter because the caller has it and passing it reads clearer than
 * a comment explaining its absence.
 *
 * Floored at 0. The browser clamps a `scrollLeft` assignment anyway, but a negative here would mean
 * "the anchor cannot be held" and should read as the left end, not as a number.
 */
export function anchoredScrollLeft(
  frame: number,
  fromW: number,
  toW: number,
  scrollLeft: number,
  gutterW: number,
): number {
  const contentX = (w: number) => gutterW + frame * w + w / 2;
  return Math.max(0, contentX(toW) - (contentX(fromW) - scrollLeft));
}
