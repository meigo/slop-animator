import { resolvedKeyCell, type Cell, type Project } from "./document";
import type { CanvasOps } from "./timeline";

/** A rectangular block of cells copied from the timeline. cols = layers (top-first),
 *  rows = frames (earliest-first). Every KEY canvas/transform is deep-cloned, and each column
 *  starts with a KEY (leading holds are materialized on copy) so the block is self-contained. */
export interface CellBlock {
  cols: number;
  rows: number;
  columns: Cell[][]; // columns[c][r]; length cols, each length rows
}

/** Deep-clone a cell: fresh canvas + cloned transform/transformBox (never share refs). */
export function cloneCell(cell: Cell, ops: CanvasOps): Cell {
  if (cell.kind === "hold") return { kind: "hold" };
  const out: Cell = { kind: "key", canvas: ops.clone(cell.canvas) };
  if (cell.transform) out.transform = { ...cell.transform };
  if (cell.transformBox !== undefined)
    out.transformBox = cell.transformBox ? { ...cell.transformBox } : cell.transformBox;
  return out;
}

/** Extract a self-contained block. `layerIds` top-first; frames inclusive [startFrame, endFrame]. */
export function copyBlock(
  project: Project,
  layerIds: number[],
  startFrame: number,
  endFrame: number,
  ops: CanvasOps,
): CellBlock {
  const rows = endFrame - startFrame + 1;
  const columns: Cell[][] = [];
  for (const id of layerIds) {
    const layer = project.layers.find((l) => l.id === id);
    if (!layer || layer.kind !== "draw") continue;
    const col: Cell[] = [];
    for (let r = 0; r < rows; r++) {
      const f = startFrame + r;
      if (r === 0) {
        // Materialize the leading cell into a self-contained KEY (resolve holds to their key).
        const rk = resolvedKeyCell(layer, f);
        col.push(rk ? cloneCell(rk.cell, ops) : { kind: "key", canvas: ops.create() });
      } else {
        const cell = layer.cells[f];
        col.push(!cell || cell.kind === "hold" ? { kind: "hold" } : cloneCell(cell, ops));
      }
    }
    columns.push(col);
  }
  return { cols: columns.length, rows, columns };
}
