export type ResizeMode = "scale" | "crop";

/** 3×3 anchor: 0 = left/top, 0.5 = center, 1 = right/bottom. */
export interface Anchor {
  ax: 0 | 0.5 | 1;
  ay: 0 | 0.5 | 1;
}

/**
 * Where old content (`oldW×oldH`) lands inside a new canvas (`newW×newH`), in the same px units.
 * - scale → uniform fit factor `min(newW/oldW, newH/oldH)` (preserves aspect, no distortion).
 * - crop  → factor 1 (pixel scale kept).
 * The anchor distributes the leftover margin (negative offset on shrink = crop on that side).
 */
export function placeContent(
  oldW: number, oldH: number, newW: number, newH: number, mode: ResizeMode, anchor: Anchor
): { x: number; y: number; w: number; h: number } {
  if (oldW <= 0 || oldH <= 0) return { x: 0, y: 0, w: newW, h: newH };
  const factor = mode === "scale" ? Math.min(newW / oldW, newH / oldH) : 1;
  const w = oldW * factor;
  const h = oldH * factor;
  return { x: (newW - w) * anchor.ax, y: (newH - h) * anchor.ay, w, h };
}
