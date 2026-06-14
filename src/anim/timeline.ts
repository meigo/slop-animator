import { resolveKeyframeIndex, refreshLength, type Cell, type DrawingLayer, type Project } from "./document";

/** Canvas creation/cloning, injected so timeline logic is testable without the DOM. */
export interface CanvasOps {
  create(): HTMLCanvasElement;
  clone(src: HTMLCanvasElement): HTMLCanvasElement;
}

/** Insert a hold AFTER `after` on this layer, extending the current held span by one frame. */
export function addFrame(layer: DrawingLayer, after: number): void {
  const at = clampIndex(layer, after);
  layer.cells.splice(at + 1, 0, { kind: "hold" });
}

/** Clamp a target index to the last existing cell so "after current" always lands inside the track. */
function clampIndex(layer: DrawingLayer, frame: number): number {
  return Math.max(0, Math.min(frame, layer.cells.length - 1));
}

/**
 * Insert a new keyframe AFTER `after`, cloning the drawing currently shown at `after`
 * (the resolved keyframe, or blank if none). Shifts later cells right. ("Insert keyframe" / F6.)
 */
export function insertKeyframe(layer: DrawingLayer, after: number, ops: CanvasOps): void {
  const at = clampIndex(layer, after);
  const ki = resolveKeyframeIndex(layer.cells, at);
  const src = ki === null ? null : layer.cells[ki];
  const canvas = src && src.kind === "key" ? ops.clone(src.canvas) : ops.create();
  layer.cells.splice(at + 1, 0, { kind: "key", canvas });
}

/** Insert an empty keyframe AFTER `after`, shifting later cells right. ("Insert blank keyframe" / F7.) */
export function insertBlankKeyframe(layer: DrawingLayer, after: number, ops: CanvasOps): void {
  const at = clampIndex(layer, after);
  layer.cells.splice(at + 1, 0, { kind: "key", canvas: ops.create() });
}

/** Make the cell at `frame` a hold. */
export function setHold(layer: DrawingLayer, frame: number): void {
  layer.cells[frame] = { kind: "hold" };
}

/** Duplicate the keyframe shown at `frame` into a new keyframe right after it. */
export function duplicateKeyframe(layer: DrawingLayer, frame: number, ops: CanvasOps): void {
  insertKeyframe(layer, frame, ops);
}

/** Remove the cell at `frame` on this layer, shifting later cells left. Keeps at least one cell. */
export function deleteFrame(layer: DrawingLayer, frame: number): void {
  if (layer.cells.length <= 1) return;
  if (frame < 0 || frame >= layer.cells.length) return;
  layer.cells.splice(frame, 1);
}

/**
 * Guarantee the cell at `frame` is a keyframe and return its canvas, so a tool can draw on it.
 * - Past the layer's end → extend with holds up to `frame`, then a fresh blank keyframe.
 * - Already a keyframe → returns its canvas unchanged.
 * - A hold over an earlier keyframe → clones that drawing (draw-on-hold = clone & edit on top).
 * - A hold with nothing held → a fresh blank keyframe.
 */
export function ensureDrawableKeyframe(layer: DrawingLayer, frame: number, ops: CanvasOps): HTMLCanvasElement {
  if (frame >= layer.cells.length) {
    while (layer.cells.length < frame) layer.cells.push({ kind: "hold" });
    const canvas = ops.create();
    layer.cells.push({ kind: "key", canvas });
    return canvas;
  }

  const current = layer.cells[frame];
  if (current.kind === "key") return current.canvas;

  const ki = resolveKeyframeIndex(layer.cells, frame);
  const held = ki === null ? null : layer.cells[ki];
  const canvas = held && held.kind === "key" ? ops.clone(held.canvas) : ops.create();
  layer.cells[frame] = { kind: "key", canvas };
  return canvas;
}

/** Insert a hold at index `at` in EVERY drawing layer (global shift), then refresh document length. */
export function insertFrameAllLayers(project: Project, at: number): void {
  for (const layer of project.layers) {
    if (layer.kind !== "draw") continue;
    const idx = Math.max(0, Math.min(at, layer.cells.length));
    layer.cells.splice(idx, 0, { kind: "hold" });
  }
  refreshLength(project);
}

/** Remove index `at` from every drawing layer that has it (global shift), keeping ≥1 cell each. */
export function deleteFrameAllLayers(project: Project, at: number): void {
  for (const layer of project.layers) {
    if (layer.kind !== "draw") continue;
    if (layer.cells.length <= 1) continue;
    if (at < 0 || at >= layer.cells.length) continue;
    layer.cells.splice(at, 1);
  }
  refreshLength(project);
}

/**
 * Set how many frames the keyframe at `keyFrame` occupies before the next key (its hold span).
 * `span` is the total cell count owned by this key (key + trailing holds), floored at 1.
 * Growing inserts holds at the span boundary (pushing following keys right); shrinking removes
 * trailing holds of this span only (pulling following keys left) — it never deletes another key.
 * No-op if `keyFrame` is not a key.
 */
export function setHoldSpan(layer: DrawingLayer, keyFrame: number, span: number): void {
  if (keyFrame < 0 || keyFrame >= layer.cells.length) return;
  if (layer.cells[keyFrame].kind !== "key") return;

  const desired = Math.max(1, Math.floor(span));
  let next = keyFrame + 1;
  while (next < layer.cells.length && layer.cells[next].kind === "hold") next++;
  const current = next - keyFrame; // cells owned: the key plus its trailing holds
  if (desired === current) return;

  if (desired > current) {
    const holds: Cell[] = Array.from({ length: desired - current }, () => ({ kind: "hold" }) as Cell);
    layer.cells.splice(keyFrame + current, 0, ...holds);
  } else {
    layer.cells.splice(keyFrame + desired, current - desired);
  }
}

/**
 * Move the keyframe at `from` to `to` on the same layer.
 * - Source cell becomes a hold.
 * - If `to` is a hold cell → the key lands there.
 * - If `to` is itself a key → the two keyframes swap.
 * - If `to` is past the end → the layer extends (padding holds) and the key is appended.
 * No-op if `from` is not a key or `to === from`.
 */
export function moveKeyframe(layer: DrawingLayer, from: number, to: number): void {
  if (to === from) return;
  if (from < 0 || from >= layer.cells.length) return;
  const moving = layer.cells[from];
  if (moving.kind !== "key") return;

  if (to >= layer.cells.length) {
    layer.cells[from] = { kind: "hold" };
    while (layer.cells.length < to) layer.cells.push({ kind: "hold" });
    layer.cells.push(moving);
    return;
  }
  if (to < 0) return;

  const target = layer.cells[to];
  if (target.kind === "key") {
    layer.cells[to] = moving;
    layer.cells[from] = target; // swap
  } else {
    layer.cells[to] = moving;
    layer.cells[from] = { kind: "hold" };
  }
}

/** One merged cell: a hold, or a keyframe carrying the resolved below+upper canvases to composite. */
export type MergePlan =
  | { kind: "hold" }
  | { kind: "key"; below: HTMLCanvasElement | null; upper: HTMLCanvasElement | null };

/**
 * Plan merging `upperCells` down onto `belowCells` without touching pixels.
 * A keyframe is produced only at the UNION of the two layers' keyframe positions (so holds
 * stay holds); each carries the canvas each layer *shows* at that frame (its resolved keyframe,
 * or null if that layer is blank there) for the caller to composite. Length = the longer layer.
 */
export function planMergeDown(belowCells: Cell[], upperCells: Cell[]): MergePlan[] {
  const len = Math.max(belowCells.length, upperCells.length);
  const plan: MergePlan[] = [];
  for (let f = 0; f < len; f++) {
    const bc = belowCells[f];
    const uc = upperCells[f];
    const bKey = bc !== undefined && bc.kind === "key";
    const uKey = uc !== undefined && uc.kind === "key";
    if (!bKey && !uKey) {
      plan.push({ kind: "hold" });
      continue;
    }
    const bki = resolveKeyframeIndex(belowCells, f);
    const uki = resolveKeyframeIndex(upperCells, f);
    const bResolved = bki === null ? null : belowCells[bki];
    const uResolved = uki === null ? null : upperCells[uki];
    plan.push({
      kind: "key",
      below: bResolved && bResolved.kind === "key" ? bResolved.canvas : null,
      upper: uResolved && uResolved.kind === "key" ? uResolved.canvas : null,
    });
  }
  return plan;
}
