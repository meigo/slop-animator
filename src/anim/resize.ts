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
 * Where a resize puts the old cell's pixels for an ANIMATED drawing layer that turns or scales
 * between keys (`turnsOrScales`): centred, `C' − f·C`, whatever the anchor. Then the whole anchor
 * shift goes into the translation (`resizeCentredTransform`). Review 2026-10-17 #11: with the
 * anchor's placement each key needs `d' = f·d + e − A·e` (`resizeDocPivotTransform`), and `A·e` is
 * not linear in the rotation, while the frames between keys lerp `dx/dy` linearly — so every key was
 * exact and the in-betweens swung off (134 px at the midpoint of a 0°→90° pair after a middle-left
 * Crop of 1920 → 1000). Only where nothing is cut: Scale and a growing Crop fit the whole old cell
 * either way.
 *
 * In a Crop (`f` = 1) the offset is ROUNDED to whole device px (`dpr`), so the cells are copied,
 * not resampled half a pixel (an odd margin made it x.5); `resizeCentredTransform` takes the
 * remainder. A Scale resamples anyway, so it keeps the exact offset. Logical px.
 */
export function centredCellOffset(pl: Placement, dpr: number): { x: number; y: number } {
  const x = pl.newW / 2 - (pl.f * pl.oldW) / 2;
  const y = pl.newH / 2 - (pl.f * pl.oldH) / 2;
  if (pl.f !== 1) return { x, y };
  return { x: Math.round(x * dpr) / dpr, y: Math.round(y * dpr) / dpr };
}

/**
 * A drawing layer's transform after a resize whose cells were placed at `offset`
 * (`centredCellOffset`): `d' = f·d + e − A·r`, e = M(C) − C', r = offset − (C' − f·C) the rounding
 * remainder. With no remainder it is linear in the key values, so interpolation is exact; with one
 * (|r| ≤ 0.5 device px a side), every key is still exact and a frame between keys is off by at most
 * |r| (≤ 0.71 px), the chord-vs-arc gap of the remainder alone.
 */
export function resizeCentredTransform<T extends Transform>(
  t: T,
  pl: Placement,
  offset: { x: number; y: number },
): T {
  const ex = pl.f * (pl.oldW / 2) + pl.ox - pl.newW / 2;
  const ey = pl.f * (pl.oldH / 2) + pl.oy - pl.newH / 2;
  const a = linear(
    t,
    offset.x - (pl.newW / 2 - (pl.f * pl.oldW) / 2),
    offset.y - (pl.newH / 2 - (pl.f * pl.oldH) / 2),
  );
  return { ...t, dx: pl.f * t.dx + ex - a.x, dy: pl.f * t.dy + ey - a.y };
}

/**
 * The bands of the NEW paper a centred layer's cell no longer reaches (`centredCellOffset`): its
 * cell sits `e` = M(C) − C' away from the paper (before its own transform), so strokes in a band
 * |e| wide on that side fall outside its canvas and are clipped, until the layer is moved back.
 * Whole logical px, bands under 1 px left out. For the Size dialog.
 */
export function centredBands(
  pl: Placement,
): { edge: "left" | "right" | "top" | "bottom"; px: number }[] {
  const ex = pl.f * (pl.oldW / 2) + pl.ox - pl.newW / 2;
  const ey = pl.f * (pl.oldH / 2) + pl.oy - pl.newH / 2;
  const out: { edge: "left" | "right" | "top" | "bottom"; px: number }[] = [];
  if (Math.abs(ex) >= 1)
    out.push({ edge: ex > 0 ? "left" : "right", px: Math.round(Math.abs(ex)) });
  if (Math.abs(ey) >= 1)
    out.push({ edge: ey > 0 ? "top" : "bottom", px: Math.round(Math.abs(ey)) });
  return out;
}

/** Whether a transform track's keys differ in turn or scale — the only case where the anchor's
 *  correction (`resizeDocPivotTransform`) differs between keys and so can't be interpolated. */
export function turnsOrScales(keys: Transform[]): boolean {
  const k0 = keys[0];
  return keys.some(
    (k) => k.rotation !== k0.rotation || k.scaleX !== k0.scaleX || k.scaleY !== k0.scaleY,
  );
}

/** Whether the placement keeps the document centre where it was (the centre anchor, or a Scale
 *  that fits exactly): then the anchor's correction is zero and nothing drifts. */
export function keepsCentre(pl: Placement): boolean {
  const ex = pl.f * (pl.oldW / 2) + pl.ox - pl.newW / 2;
  const ey = pl.f * (pl.oldH / 2) + pl.oy - pl.newH / 2;
  return Math.abs(ex) < 1e-9 && Math.abs(ey) < 1e-9;
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

/**
 * What a resize must do about a drawing layer's transform. A Crop cuts every key cell in CELL
 * space, which is the paper only for an untransformed layer: a moved, scaled or turned layer shows
 * a different part of its cell, so the crop dropped pixels that showed inside the new document
 * and kept some that showed off it (2026-10-17 review #6). Only a Crop that shrinks a side cuts
 * anything — Scale fits the whole cell and a growing Crop keeps all of it, and the transform
 * mapping (`resizeDocPivotTransform`) then keeps the picture in place.
 * - `shift`: a static move and/or flip (`isRigidAxisTransform`) cuts its own window of the cell,
 *   the part that shows in the new document (`cropShift`): exact, no resampling, the flip kept.
 * - `bake`: any other static transform (a scale or a turn) is drawn through itself straight into
 *   the new canvas (`cropBakeMatrix`) and reset — it resamples, as Apply does, and the Size dialog
 *   says so.
 * - `loses`: an animated layer, or any member of a transformed or animated group, shows a different
 *   part of its cells on different frames; no single cut keeps them all. The Size dialog warns.
 */
export function cropTransformPlan(
  resize: { mode: ResizeMode; oldW: number; oldH: number; newW: number; newH: number },
  layer: { transform: Transform; animated: boolean; groupTransformed: boolean },
): "keep" | "shift" | "bake" | "loses" {
  const cuts = resize.mode === "crop" && (resize.newW < resize.oldW || resize.newH < resize.oldH);
  if (!cuts) return "keep";
  if (layer.animated || layer.groupTransformed) return "loses";
  const t = layer.transform;
  if (t.dx === 0 && t.dy === 0 && t.scaleX === 1 && t.scaleY === 1 && t.rotation === 0)
    return "keep";
  return isRigidAxisTransform(t) ? "shift" : "bake";
}

/** A move and/or a flip: unit scale on both axes, no turn. Such a layer shows its cell pixel for
 *  pixel, only somewhere else (or mirrored). */
export function isRigidAxisTransform(t: Transform): boolean {
  const unit = (s: number) => Math.abs(Math.abs(s) - 1) < 1e-9;
  return (
    unit(t.scaleX) &&
    unit(t.scaleY) &&
    Math.abs(Math.sin(t.rotation)) < 1e-9 &&
    Math.cos(t.rotation) > 0
  );
}

/**
 * A Crop (`pl.f` = 1) of a moved or flipped layer (`isRigidAxisTransform`): where its old cell goes
 * in the new cell (`offset`, logical px, in place of the placement's `ox`/`oy`) and its transform
 * after. The window is the part of the cell that shows in the new document: the cell point shown at
 * the new centre lands at the new cell's centre. The offset differs from the placement's by whole
 * pixels, so the pixels are copied, not resampled; the fraction of the move that is left stays in
 * the transform, and so does the flip. Derived from new-render(q) = old-render(p) + o with
 * q = p + offset: `d' = d + e − A(e + offset − o)`, e = M(C) − C' (as `resizeDocPivotTransform`).
 */
export function cropShift<T extends Transform>(
  t: T,
  pl: Placement,
): { offset: { x: number; y: number }; transform: T } {
  const cx = pl.oldW / 2,
    cy = pl.oldH / 2;
  const ncx = pl.newW / 2,
    ncy = pl.newH / 2;
  // The cell point shown at the new centre: the old paper point X* = C' − o, through render⁻¹ (A is
  // its own inverse for a flip).
  const sx = Math.sign(t.scaleX),
    sy = Math.sign(t.scaleY);
  const px = cx + sx * (ncx - pl.ox - cx - t.dx);
  const py = cy + sy * (ncy - pl.oy - cy - t.dy);
  const offset = {
    x: pl.ox + Math.round(ncx - px - pl.ox),
    y: pl.oy + Math.round(ncy - py - pl.oy),
  };
  const ex = cx + pl.ox - ncx,
    ey = cy + pl.oy - ncy;
  return {
    offset,
    transform: {
      ...t,
      dx: t.dx + ex - sx * (ex + offset.x - pl.ox),
      dy: t.dy + ey - sy * (ey + offset.y - pl.oy),
    },
  };
}

/**
 * A Crop (`pl.f` = 1) of a scaled or turned layer: the canvas matrix `[a, b, c, d, e, f]` (as
 * `setTransform` takes it, logical px) that draws the old cell straight into the new one where it
 * showed — render(p) = C + d + A(p − C), then the placement. The transform is reset after. Drawn
 * into the NEW canvas, so a side that grows keeps the art that shows past the old paper.
 */
export function cropBakeMatrix(
  t: Transform,
  pl: Placement,
): [number, number, number, number, number, number] {
  const cos = Math.cos(t.rotation),
    sin = Math.sin(t.rotation);
  const a = cos * t.scaleX,
    b = sin * t.scaleX,
    c = -sin * t.scaleY,
    d = cos * t.scaleY;
  const cx = pl.oldW / 2,
    cy = pl.oldH / 2;
  return [a, b, c, d, cx + t.dx - (a * cx + c * cy) + pl.ox, cy + t.dy - (b * cx + d * cy) + pl.oy];
}
