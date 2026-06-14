import { resolveKeyframeIndex, type DrawingLayer } from "./document";

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
 * - Already a keyframe → returns its canvas unchanged.
 * - A hold over an earlier keyframe → clones that drawing (draw-on-hold = clone & edit on top).
 * - A hold with nothing held → a fresh blank keyframe.
 */
export function ensureDrawableKeyframe(layer: DrawingLayer, frame: number, ops: CanvasOps): HTMLCanvasElement {
  const current = layer.cells[frame];
  if (current.kind === "key") return current.canvas;

  const ki = resolveKeyframeIndex(layer.cells, frame);
  const held = ki === null ? null : layer.cells[ki];
  const canvas = held && held.kind === "key" ? ops.clone(held.canvas) : ops.create();
  layer.cells[frame] = { kind: "key", canvas };
  return canvas;
}
