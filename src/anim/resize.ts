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
  oldW: number,
  oldH: number,
  newW: number,
  newH: number,
  mode: ResizeMode,
  anchor: Anchor,
): { x: number; y: number; w: number; h: number } {
  if (oldW <= 0 || oldH <= 0) return { x: 0, y: 0, w: newW, h: newH };
  const factor = mode === "scale" ? Math.min(newW / oldW, newH / oldH) : 1;
  const w = oldW * factor;
  const h = oldH * factor;
  return { x: (newW - w) * anchor.ax, y: (newH - h) * anchor.ay, w, h };
}

/** How a resize moves the old document's content: `p → (f·p.x + ox, f·p.y + oy)`, logical px. */
export interface Placement {
  f: number;
  ox: number;
  oy: number;
  oldW: number;
  oldH: number;
  newW: number;
  newH: number;
}

type Transform = { dx: number; dy: number; scaleX: number; scaleY: number; rotation: number };
type Box = { x: number; y: number; w: number; h: number };

/** The transform's linear part (rotate ∘ scale, as `forwardTransformPoint` applies it) on `v`. */
function linear(t: Transform, vx: number, vy: number): { x: number; y: number } {
  const x = vx * t.scaleX;
  const y = vy * t.scaleY;
  const cos = Math.cos(t.rotation);
  const sin = Math.sin(t.rotation);
  return { x: x * cos - y * sin, y: x * sin + y * cos };
}

/**
 * A DRAWING layer's transform after a resize. It turns about the document centre, which after the
 * resize is the NEW centre, while the pixels were moved by the placement — so a translation scales
 * with them, and when the placement does not keep the centre (crop or scale to a corner anchor) a
 * rotated or scaled layer also needs the difference made up: `d' = f·d + (I − A)(M(C) − C')`, where
 * A is the transform's linear part, M the placement and C, C' the old and new centres. Rotation
 * and scale are unchanged. (The resize used to leave every transform as it was, so transformed
 * layers ended up somewhere else — 2026-09-30 review.)
 */
export function resizeDocPivotTransform<T extends Transform>(t: T, pl: Placement): T {
  const ex = pl.f * (pl.oldW / 2) + pl.ox - pl.newW / 2;
  const ey = pl.f * (pl.oldH / 2) + pl.oy - pl.newH / 2;
  const a = linear(t, ex, ey);
  return { ...t, dx: pl.f * t.dx + ex - a.x, dy: pl.f * t.dy + ey - a.y };
}

/**
 * A REFERENCE layer's transform after a resize. Its media is contain-fitted to the document and
 * centred, so it is re-fitted to the new document on its own (by `k`, new fit ÷ old fit): the
 * scale makes up the difference to the placement's `f`, and the translation makes up for the new
 * centre not being where the placement put the old one.
 */
export function resizeFitTransform<T extends Transform>(t: T, pl: Placement, k: number): T {
  const r = k > 0 ? pl.f / k : 1;
  const ex = pl.f * (pl.oldW / 2) + pl.ox - pl.newW / 2;
  const ey = pl.f * (pl.oldH / 2) + pl.oy - pl.newH / 2;
  return {
    ...t,
    dx: pl.f * t.dx + ex,
    dy: pl.f * t.dy + ey,
    scaleX: t.scaleX * r,
    scaleY: t.scaleY * r,
  };
}

/** A GROUP's transform after a resize: it turns about its content (or its frozen box, mapped with
 *  `resizeBox`), which the placement carries along, so only the translation scales. */
export function resizeContentPivotTransform<T extends Transform>(t: T, pl: Placement): T {
  return { ...t, dx: pl.f * t.dx, dy: pl.f * t.dy };
}

/** A document-space box (a frozen pivot box) through the placement. */
export function resizeBox(b: Box, pl: Placement): Box {
  return { x: pl.f * b.x + pl.ox, y: pl.f * b.y + pl.oy, w: pl.f * b.w, h: pl.f * b.h };
}
