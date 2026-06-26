// Deform-tool logic, isolated so a future ARAP solver replaces only this module's deformation block
// (the FFD version is just lattice plumbing; the lift/warp/render/bake pipeline lives in selection.ts).

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Convert a device-px content-bounds rect to a logical selection rect; null when there's no content. */
export function contentRectLogical(bounds: Rect | null, dpr: number): Rect | null {
  if (!bounds) return null;
  return { x: bounds.x / dpr, y: bounds.y / dpr, w: bounds.w / dpr, h: bounds.h / dpr };
}

/** Warp grids need >=2 control points per axis. */
export function clampDensity(n: number): number {
  return Math.max(2, Math.round(n));
}
