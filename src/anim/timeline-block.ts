import { resolvedKeyCell, type Cell, type DrawingLayer, type Project } from "./document";
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

/** Overwrite-write a column of cells onto `layer` starting at `startFrame`: clone each cell, replace
 *  in place, and pad with holds if it lands past the layer's end. Shared by paste and move. */
function overwriteColumn(
  layer: DrawingLayer,
  cells: Cell[],
  startFrame: number,
  ops: CanvasOps,
): void {
  for (let r = 0; r < cells.length; r++) {
    const f = startFrame + r;
    const cell = cloneCell(cells[r], ops);
    if (f >= layer.cells.length) {
      while (layer.cells.length < f) layer.cells.push({ kind: "hold" });
      layer.cells.push(cell);
    } else {
      layer.cells[f] = cell; // replace, never mutate in place
    }
  }
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

/** Drawing-layer ids from `topLayerId` downward through the stack (toward the bottom = display-down),
 *  skipping reference layers. Empty if the id is unknown. Column 0 = the top layer. */
export function drawingLayerIdsDown(project: Project, topLayerId: number): number[] {
  const idx = project.layers.findIndex((l) => l.id === topLayerId);
  if (idx < 0) return [];
  const ids: number[] = [];
  for (let i = idx; i >= 0; i--)
    if (project.layers[i].kind === "draw") ids.push(project.layers[i].id);
  return ids;
}

/** Overwrite-paste: stamp `block` in place with column 0 at `targetTopLayerId`, filling downward.
 *  Lands past a layer's end → pad with holds then append. Overflow columns ignored. */
export function pasteBlockOverwrite(
  project: Project,
  block: CellBlock,
  targetTopLayerId: number,
  startFrame: number,
  ops: CanvasOps,
): void {
  const targetIds = drawingLayerIdsDown(project, targetTopLayerId);
  for (let c = 0; c < block.cols; c++) {
    if (c >= targetIds.length) break; // overflow past bottom layer
    const layer = project.layers.find((l) => l.id === targetIds[c]);
    if (!layer || layer.kind !== "draw") continue;
    overwriteColumn(layer, block.columns[c], startFrame, ops);
  }
}

/** Insert-paste: for each pasted layer, splice its column at `startFrame`, shifting later cells
 *  right (pasted layers only). Pads with holds if `startFrame` is past the layer's end. */
export function pasteBlockInsert(
  project: Project,
  block: CellBlock,
  targetTopLayerId: number,
  startFrame: number,
  ops: CanvasOps,
): void {
  const targetIds = drawingLayerIdsDown(project, targetTopLayerId);
  for (let c = 0; c < block.cols; c++) {
    if (c >= targetIds.length) break;
    const layer = project.layers.find((l) => l.id === targetIds[c]);
    if (!layer || layer.kind !== "draw") continue;
    const at = startFrame;
    while (layer.cells.length < at) layer.cells.push({ kind: "hold" });
    const clones = block.columns[c].map((cell) => cloneCell(cell, ops));
    layer.cells.splice(at, 0, ...clones);
  }
}

/** Replace every cell in the block region with a hold (Delete). Track length is unchanged
 *  (so ≥1 cell per layer is preserved). Skips missing/reference layers. */
export function deleteBlock(
  project: Project,
  layerIds: number[],
  startFrame: number,
  endFrame: number,
): void {
  for (const id of layerIds) {
    const layer = project.layers.find((l) => l.id === id);
    if (!layer || layer.kind !== "draw") continue;
    for (let f = startFrame; f <= endFrame && f < layer.cells.length; f++) {
      layer.cells[f] = { kind: "hold" };
    }
  }
}

/** Move the selected block by `delta` frames on its OWN layers (frames-only), overwriting the
 *  destination. Returns the applied delta after clamping so the earliest moved frame stays >= 0.
 *  Self-contained: leading holds are materialized (via copyBlock), the range is blanked, then the
 *  cloned block is re-stamped at +applied. copyBlock clones first, so source/destination overlap
 *  is safe. `layerIds` must be drawing layers (as resolveSelectionRect guarantees). */
export function moveBlockFrames(
  project: Project,
  layerIds: number[],
  startFrame: number,
  endFrame: number,
  delta: number,
  ops: CanvasOps,
): number {
  const applied = Math.max(delta, -startFrame);
  if (applied === 0) return 0;
  const block = copyBlock(project, layerIds, startFrame, endFrame, ops); // columns for draw layers, in order
  deleteBlock(project, layerIds, startFrame, endFrame); // vacate the source → holds
  let c = 0;
  for (const id of layerIds) {
    const layer = project.layers.find((l) => l.id === id);
    if (!layer || layer.kind !== "draw") continue; // mirrors copyBlock's column filter → alignment
    // Write cloned cells directly (copyBlock already cloned; don't clone again)
    const cells = block.columns[c];
    for (let r = 0; r < cells.length; r++) {
      const f = startFrame + applied + r;
      if (f >= layer.cells.length) {
        while (layer.cells.length < f) layer.cells.push({ kind: "hold" });
        layer.cells.push(cells[r]);
      } else {
        layer.cells[f] = cells[r];
      }
    }
    c++;
  }
  return applied;
}
