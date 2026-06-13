import { resolveKeyframeIndex, type DrawingLayer, type Project } from "./document";

/** Canvas creation/cloning, injected so timeline logic is testable without the DOM. */
export interface CanvasOps {
  create(): HTMLCanvasElement;
  clone(src: HTMLCanvasElement): HTMLCanvasElement;
}

/** Append one blank (hold) frame to every layer. */
export function addFrame(project: Project): void {
  project.frameCount += 1;
  for (const layer of project.layers) {
    layer.cells.push({ kind: "hold" });
  }
}

/**
 * Make the cell at `frame` a blank keyframe (Flash "Insert Keyframe" / F6 semantics:
 * in-place promotion of this cell, not a structural shift of later cells).
 * Replaces whatever was there — if the cell was already a keyframe, its drawing is discarded.
 */
export function insertKeyframe(layer: DrawingLayer, frame: number, ops: CanvasOps): void {
  layer.cells[frame] = { kind: "key", canvas: ops.create() };
}

/** Make the cell at `frame` a hold. */
export function setHold(layer: DrawingLayer, frame: number): void {
  layer.cells[frame] = { kind: "hold" };
}

/** Make `frame` a keyframe whose canvas is a clone of the keyframe currently shown there. */
export function duplicateKeyframe(layer: DrawingLayer, frame: number, ops: CanvasOps): void {
  const ki = resolveKeyframeIndex(layer.cells, frame);
  const cell = ki === null ? null : layer.cells[ki];
  const canvas = cell && cell.kind === "key" ? ops.clone(cell.canvas) : ops.create();
  layer.cells[frame] = { kind: "key", canvas };
}

/** Remove the frame column from every layer. No-op if only one frame remains or `frame` is out of range. */
export function deleteFrame(project: Project, frame: number): void {
  if (project.frameCount <= 1) return;
  if (frame < 0 || frame >= project.frameCount) return;
  project.frameCount -= 1;
  for (const layer of project.layers) {
    layer.cells.splice(frame, 1);
  }
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
