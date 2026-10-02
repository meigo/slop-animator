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

// ── The ratio lock and the steps of a large downscale (2026-10-02; slop-paint bb3ef4e's
// `src/resize.ts`, the same code). ──

export const MAX_DOC_PX = 8192;

const clampDoc = (n: number) => Math.max(1, Math.min(MAX_DOC_PX, Math.round(n)));

/** The other side for `value` with the ratio locked: `value` × `to` / `from`, where `from` and
 *  `to` are the document's current sides (so the ratio never drifts as you type), clamped to
 *  1…8192 px. */
export function linkedSize(value: number, from: number, to: number): number {
  if (!(from > 0) || !Number.isFinite(value)) return clampDoc(to);
  return clampDoc((value * to) / from);
}

/**
 * The sizes to shrink through, ending at the target: halve while the next halving still stays at
 * or above it, then the target. One `drawImage` from far larger reads only a few source pixels per
 * destination pixel and aliases (the stamp brushes' tip had the same problem); halving averages
 * properly. Growing or a shrink under 2× is a single step.
 */
export function halvingSteps(
  fromW: number,
  fromH: number,
  toW: number,
  toH: number,
): { w: number; h: number }[] {
  const steps: { w: number; h: number }[] = [];
  let w = fromW;
  let h = fromH;
  while (w / 2 >= toW && h / 2 >= toH && (w / 2 > toW || h / 2 > toH)) {
    w = Math.max(toW, Math.round(w / 2));
    h = Math.max(toH, Math.round(h / 2));
    steps.push({ w, h });
  }
  const last = steps[steps.length - 1];
  if (!last || last.w !== toW || last.h !== toH) steps.push({ w: toW, h: toH });
  return steps;
}
