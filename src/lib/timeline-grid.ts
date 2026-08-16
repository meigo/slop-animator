import { resolveKeyframeIndex, type Cell } from "../anim/document";

/** What a pointer-down on a cell strip means. */
export type CellPointer =
  | { kind: "seek"; frame: number }
  | { kind: "move"; keyIndex: number }
  | { kind: "resize"; keyIndex: number };

const EDGE_PX = 5; // hotspot width at a span's right edge

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
    if (Math.abs(offsetX - end * cellW) <= EDGE_PX) return { kind: "resize", keyIndex: ki };
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
