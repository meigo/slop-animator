import {
  isLayerEditable,
  resolvedKeyCell,
  type Cell,
  type DrawingLayer,
  type Project,
} from "./document";
import { shiftLayerTransformKeys, type CanvasOps } from "./timeline";

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
/** Place `cells` onto `layer` starting at `startFrame`: replace in place, padding with holds if it
 *  lands past the layer's end. Does NOT clone — callers pass cells they already own (fresh clones).
 *  Shared by paste (which clones first) and move (whose cells are already cloned by copyBlock). */
function writeColumn(layer: DrawingLayer, cells: Cell[], startFrame: number): void {
  for (let r = 0; r < cells.length; r++) {
    const f = startFrame + r;
    if (f >= layer.cells.length) {
      while (layer.cells.length < f) layer.cells.push({ kind: "hold" });
      layer.cells.push(cells[r]);
    } else {
      layer.cells[f] = cells[r]; // replace, never mutate in place
    }
  }
}

/** Overwrite-write a column onto `layer` at `startFrame`, cloning each cell first (for paste, whose
 *  source block is a persistent clipboard that must not be aliased into the document). */
function overwriteColumn(
  layer: DrawingLayer,
  cells: Cell[],
  startFrame: number,
  ops: CanvasOps,
): void {
  writeColumn(
    layer,
    cells.map((c) => cloneCell(c, ops)),
    startFrame,
  );
}

/** Extract a self-contained block. `layerIds` top-first; frames inclusive [startFrame, endFrame].
 *  Copy/paste materializes a leading hold into a KEY so the clipboard stands alone. Move keeps
 *  leading holds as holds so a mid-span drag does not duplicate the resolved key. */
export function copyBlock(
  project: Project,
  layerIds: number[],
  startFrame: number,
  endFrame: number,
  ops: CanvasOps,
  opts?: { materializeLeading?: boolean },
): CellBlock {
  const materializeLeading = opts?.materializeLeading !== false;
  const rows = endFrame - startFrame + 1;
  const columns: Cell[][] = [];
  for (const id of layerIds) {
    const layer = project.layers.find((l) => l.id === id);
    if (!layer || layer.kind !== "draw") continue;
    const col: Cell[] = [];
    for (let r = 0; r < rows; r++) {
      const f = startFrame + r;
      if (r === 0 && materializeLeading) {
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
 *  Lands past a layer's end → pad with holds then append. Overflow columns ignored. Locked layers
 *  are inert: their column is consumed (alignment kept) but nothing is written. */
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
    if (!layer || !isLayerEditable(layer, project.groups)) continue; // non-editable: inert, column consumed
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
    if (!layer || !isLayerEditable(layer, project.groups)) continue; // non-editable: inert, column consumed
    const at = startFrame;
    while (layer.cells.length < at) layer.cells.push({ kind: "hold" });
    const clones = block.columns[c].map((cell) => cloneCell(cell, ops));
    layer.cells.splice(at, 0, ...clones);
    // Shift this layer's own transform keys with its cells, for the same reason the per-layer frame
    // tools do: the track belongs to exactly the layer whose cells were just respliced, so there IS
    // one correct shift — and without it the drawings move while the motion stays put, a frame per
    // inserted column. (A reference RANGE is document-space and shared, which is why those are
    // deliberately left alone here.)
    for (let i = 0; i < clones.length; i++) shiftLayerTransformKeys(layer, at, 1);
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
    if (!layer || !isLayerEditable(layer, project.groups)) continue; // non-editable: inert
    for (let f = startFrame; f <= endFrame && f < layer.cells.length; f++) {
      layer.cells[f] = { kind: "hold" };
    }
  }
}

/** True when at least one listed layer would actually be written by a block op. Used to skip
 *  empty undo entries (keyboard Cut/Delete on an all-locked/hidden selection). */
export function anyEditableLayer(project: Project, layerIds: number[]): boolean {
  return layerIds.some((id) => {
    const layer = project.layers.find((l) => l.id === id);
    return !!layer && isLayerEditable(layer, project.groups);
  });
}

/** True when paste at `topLayerId` (active layer, playhead) would write at least one cell.
 *  Matches pasteCells: ref / unknown active → no; then skip-and-consume down the stack. */
export function anyEditablePasteTarget(project: Project, topLayerId: number): boolean {
  const top = project.layers.find((l) => l.id === topLayerId);
  if (!top || top.kind !== "draw") return false;
  return drawingLayerIdsDown(project, topLayerId).some((id) => {
    const layer = project.layers.find((l) => l.id === id);
    return !!layer && isLayerEditable(layer, project.groups);
  });
}

/** The key a HOLD written at `frame` would show, given every cell before `frame` is already final.
 *  Past the track's end the pad holds writeColumn adds chain back to the last existing cell, so
 *  clamp instead of taking resolveKeyframeIndex's "blank after the end" null. */
function keyShownBefore(layer: DrawingLayer, frame: number): Cell | null {
  const at = Math.min(frame - 1, layer.cells.length - 1);
  if (at < 0) return null;
  return resolvedKeyCell(layer, at)?.cell ?? null;
}

/** Move the selected block by `delta` frames on its OWN layers (frames-only), overwriting the
 *  destination. Returns the applied delta after clamping so the earliest moved frame stays >= 0.
 *  Leading holds stay holds (unlike copy) so a mid-span drag does not duplicate the resolved key —
 *  unless the move crosses a key, see below. The range is blanked, then the cloned block is
 *  re-stamped at +applied. copyBlock clones first, so source/destination overlap is safe.
 *  `layerIds` must be drawing layers. */
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
  const dest = startFrame + applied;
  const block = copyBlock(project, layerIds, startFrame, endFrame, ops, {
    materializeLeading: false,
  });
  // What each column's leading cell DISPLAYS right now. A leading hold carries no pixels, so at the
  // destination it re-resolves to whatever key precedes it THERE: correct for a nudge inside its own
  // hold span, but across an intervening key the marquee would move while the drawing silently
  // changed. Read before deleteBlock vacates the source, and per layer (each resolves on its own
  // track).
  const shown = new Map<number, Cell | null>();
  for (const id of layerIds) {
    const layer = project.layers.find((l) => l.id === id);
    if (!layer || layer.kind !== "draw") continue;
    if (layer.cells[startFrame]?.kind === "key") continue; // already self-contained
    shown.set(id, resolvedKeyCell(layer, startFrame)?.cell ?? null);
  }
  deleteBlock(project, layerIds, startFrame, endFrame); // vacate the source → holds
  let c = 0;
  for (const id of layerIds) {
    const layer = project.layers.find((l) => l.id === id);
    if (!layer || layer.kind !== "draw") continue; // mirrors copyBlock's column filter → alignment
    // Locked row: consume the column (deleteBlock skipped it too, so its cells are untouched).
    if (isLayerEditable(layer, project.groups)) {
      const col = block.columns[c];
      if (shown.has(id)) {
        // The source is vacated and the write starts at `dest`, so everything before `dest` is now
        // final — this is exactly what the moved hold would resolve to on arrival. Materialize only
        // when that differs, so the mid-span case still moves a hold as a hold.
        const src = shown.get(id)!;
        if (keyShownBefore(layer, dest) !== src)
          col[0] = src ? cloneCell(src, ops) : { kind: "key", canvas: ops.create() };
      }
      writeColumn(layer, col, dest);
    }
    c++;
  }
  return applied;
}
