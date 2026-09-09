import { resolveKeyframeIndex, type Cell } from "../anim/document";

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

/** Companion to `edgePx`: how far a pointer may travel before a pending long-press is cancelled. */
export function moveCancelPx(cellW: number): number {
  return Math.max(3, Math.min(6, Math.round(cellW * 0.25)));
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
 * - near a keyframe span's right edge → resize that key's hold span
 * - on the keyframe cell itself → move that key
 * - otherwise → seek to the column.
 */
export function planCellPointer(
  cells: Cell[],
  offsetX: number,
  cellW: number,
  count: number,
): CellPointer {
  const frame = columnAtX(offsetX, cellW, count);
  const ki = resolveKeyframeIndex(cells, frame);
  if (ki !== null) {
    let end = ki + 1; // exclusive end of this key's span
    while (end < cells.length && cells[end].kind !== "key") end++;
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
