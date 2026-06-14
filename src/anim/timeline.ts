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
    if (layer.kind !== "draw") continue;
    layer.cells.push({ kind: "hold" });
  }
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

/** Remove the frame column from every layer. No-op if only one frame remains or `frame` is out of range. */
export function deleteFrame(project: Project, frame: number): void {
  if (project.frameCount <= 1) return;
  if (frame < 0 || frame >= project.frameCount) return;
  project.frameCount -= 1;
  for (const layer of project.layers) {
    if (layer.kind !== "draw") continue;
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
