import type { RefTransform, TransformTrack } from "../anim/document";

export interface Pt {
  x: number;
  y: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export type Handle = "nw" | "ne" | "se" | "sw" | "n" | "e" | "s" | "w" | "rotate" | "body" | null;

export const MIN_SCALE = 0.05;

/** Floor a scale's MAGNITUDE at MIN_SCALE, keeping its sign — so a drag through zero flips the axis
 *  instead of collapsing it, and nothing downstream ever divides by zero. 0 counts as positive. */
export function floorScale(v: number): number {
  return v < 0 ? Math.min(-MIN_SCALE, v) : Math.max(MIN_SCALE, v);
}

/** Image center in document coords (fit-center + translate). */
export function transformCenter(base: Rect, t: RefTransform): Pt {
  return { x: base.x + base.w / 2 + t.dx, y: base.y + base.h / 2 + t.dy };
}

function rotate(p: Pt, c: Pt, ang: number): Pt {
  const cos = Math.cos(ang),
    sin = Math.sin(ang);
  const x = p.x - c.x,
    y = p.y - c.y;
  return { x: c.x + x * cos - y * sin, y: c.y + x * sin + y * cos };
}

/** Corners NW, NE, SE, SW of the transformed image. */
export function transformedCorners(base: Rect, t: RefTransform): [Pt, Pt, Pt, Pt] {
  const c = transformCenter(base, t);
  const hw = (base.w / 2) * t.scaleX,
    hh = (base.h / 2) * t.scaleY;
  const local: Pt[] = [
    { x: c.x - hw, y: c.y - hh },
    { x: c.x + hw, y: c.y - hh },
    { x: c.x + hw, y: c.y + hh },
    { x: c.x - hw, y: c.y + hh },
  ];
  return local.map((p) => rotate(p, c, t.rotation)) as [Pt, Pt, Pt, Pt];
}

/** Rotate-handle position: `gap` doc px beyond the top-edge midpoint (rotated about center). */
export function rotateHandlePos(base: Rect, t: RefTransform, gap: number): Pt {
  const c = transformCenter(base, t);
  const hh = (base.h / 2) * Math.abs(t.scaleY);
  return rotate({ x: c.x, y: c.y - hh - gap }, c, t.rotation);
}

/** Edge midpoints N, E, S, W of the transformed image (the side-stretch handles). */
export function transformedSides(base: Rect, t: RefTransform): [Pt, Pt, Pt, Pt] {
  const [nw, ne, se, sw] = transformedCorners(base, t);
  const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  return [mid(nw, ne), mid(ne, se), mid(se, sw), mid(sw, nw)];
}

/** Where the rotate handle's stem leaves the box: the VISUAL top edge's midpoint, which is local
 *  −y only while scaleY is positive — hence |scaleY|, matching `rotateHandlePos`. */
export function rotateHandleStem(base: Rect, t: RefTransform): Pt {
  const c = transformCenter(base, t);
  return rotate({ x: c.x, y: c.y - (base.h / 2) * Math.abs(t.scaleY) }, c, t.rotation);
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Which handle a point hits within `tolDoc`. Corners + rotate first, then body, else null. */
export function hitTestHandle(
  base: Rect,
  t: RefTransform,
  p: Pt,
  tolDoc: number,
  gap: number,
): Handle {
  const [nw, ne, se, sw] = transformedCorners(base, t);
  const named: [Handle, Pt][] = [
    ["nw", nw],
    ["ne", ne],
    ["se", se],
    ["sw", sw],
    ["rotate", rotateHandlePos(base, t, gap)],
  ];
  for (const [h, pt] of named) if (dist(p, pt) <= tolDoc) return h;
  const [n, e, s, w] = transformedSides(base, t);
  const sides: [Handle, Pt][] = [
    ["n", n],
    ["e", e],
    ["s", s],
    ["w", w],
  ];
  for (const [h, pt] of sides) if (dist(p, pt) <= tolDoc) return h;
  const c = transformCenter(base, t);
  const local = rotate(p, c, -t.rotation);
  const hw = (base.w / 2) * Math.abs(t.scaleX),
    hh = (base.h / 2) * Math.abs(t.scaleY);
  if (Math.abs(local.x - c.x) <= hw && Math.abs(local.y - c.y) <= hh) return "body";
  return null;
}

/** Map a document-space point into a layer's local (untransformed) cell space — the inverse of the
 *  affine used to render the layer. Identity transform ⇒ the point unchanged. */
export function inverseTransformPoint(base: Rect, t: RefTransform, p: Pt): Pt {
  const cx = base.x + base.w / 2,
    cy = base.y + base.h / 2;
  const ox = p.x - (cx + t.dx),
    oy = p.y - (cy + t.dy);
  const cos = Math.cos(-t.rotation),
    sin = Math.sin(-t.rotation);
  return { x: cx + (ox * cos - oy * sin) / t.scaleX, y: cy + (ox * sin + oy * cos) / t.scaleY };
}

/** Map a layer-local point out to document space — the forward of inverseTransformPoint. */
export function forwardTransformPoint(base: Rect, t: RefTransform, p: Pt): Pt {
  const cx = base.x + base.w / 2,
    cy = base.y + base.h / 2;
  const ox = (p.x - cx) * t.scaleX,
    oy = (p.y - cy) * t.scaleY;
  const cos = Math.cos(t.rotation),
    sin = Math.sin(t.rotation);
  return { x: cx + t.dx + (ox * cos - oy * sin), y: cy + t.dy + (ox * sin + oy * cos) };
}

/** Translate by (ddx, ddy). */
export function applyMove(t: RefTransform, ddx: number, ddy: number): RefTransform {
  return { ...t, dx: t.dx + ddx, dy: t.dy + ddy };
}

/** The target's own axes in document space: local x → (cos, sin), local y → (−sin, cos). */
function localAxis(t: RefTransform, axis: "x" | "y"): Pt {
  const cos = Math.cos(t.rotation),
    sin = Math.sin(t.rotation);
  return axis === "x" ? { x: cos, y: sin } : { x: -sin, y: cos };
}

/** Ratio of the pointer's offset from `center` to the grab's, measured along `u`. Null when the
 *  grab sat on the centre line (nothing to measure against). Signed: past the centre is negative. */
function ratioAlong(u: Pt, center: Pt, start: Pt, p: Pt): number | null {
  const l0 = (start.x - center.x) * u.x + (start.y - center.y) * u.y;
  if (Math.abs(l0) < 1e-6) return null;
  return ((p.x - center.x) * u.x + (p.y - center.y) * u.y) / l0;
}

/** Proportional scale about `center`: ONE signed factor — the pointer's offset projected onto the
 *  grab direction — applied to both axes, so signs are kept and dragging through the centre flips
 *  both (a 180° turn). */
export function applyScale(t: RefTransform, center: Pt, start: Pt, p: Pt): RefTransform {
  const v0 = { x: start.x - center.x, y: start.y - center.y };
  const len2 = v0.x * v0.x + v0.y * v0.y;
  if (len2 < 1e-12) return t;
  const k = ((p.x - center.x) * v0.x + (p.y - center.y) * v0.y) / len2;
  return { ...t, scaleX: floorScale(t.scaleX * k), scaleY: floorScale(t.scaleY * k) };
}

/** Stretch ONE of the target's own axes about `center`. */
export function applyStretch(
  t: RefTransform,
  axis: "x" | "y",
  center: Pt,
  start: Pt,
  p: Pt,
): RefTransform {
  const k = ratioAlong(localAxis(t, axis), center, start, p);
  if (k === null) return t;
  return axis === "x"
    ? { ...t, scaleX: floorScale(t.scaleX * k) }
    : { ...t, scaleY: floorScale(t.scaleY * k) };
}

/** A corner with Keep proportions OFF: each axis follows the pointer independently. */
export function applyFreeScale(t: RefTransform, center: Pt, start: Pt, p: Pt): RefTransform {
  return applyStretch(applyStretch(t, "x", center, start, p), "y", center, start, p);
}

/** One handle drag, from the grab-time transform. THE dispatch the gizmo and the on-canvas drag
 *  share, so the two cannot drift. */
export function dragTransform(
  handle: Exclude<Handle, null>,
  startT: RefTransform,
  center: Pt,
  start: Pt,
  p: Pt,
  keepProportions: boolean,
): RefTransform {
  switch (handle) {
    case "body":
      return applyMove(startT, p.x - start.x, p.y - start.y);
    case "rotate":
      return applyRotate(startT, center, start, p);
    case "e":
    case "w":
      return applyStretch(startT, "x", center, start, p);
    case "n":
    case "s":
      return applyStretch(startT, "y", center, start, p);
    default:
      return keepProportions
        ? applyScale(startT, center, start, p)
        : applyFreeScale(startT, center, start, p);
  }
}

/**
 * Mirror a transform across the line x = `line` ("h") or y = `line` ("v"), in the target's parent
 * space, keeping the same base. Reflecting `C + d + R(θ)S(p − C)` by F = diag(−1, 1) gives
 * F·R(θ)·S = R(−θ)·S(−sx, sy), so the result is again a transform on the same base:
 * scaleX' = −scaleX, rotation' = −rotation, dx' = 2·line − 2·C.x − dx (the "v" case mirrors this on
 * y). Affine in every field, so it commutes with key interpolation — see `mirrorTransformTrack`.
 */
export function mirrorTransform(
  t: RefTransform,
  baseCentre: Pt,
  axis: "h" | "v",
  line: number,
): RefTransform {
  return axis === "h"
    ? { ...t, scaleX: -t.scaleX, rotation: -t.rotation, dx: 2 * line - 2 * baseCentre.x - t.dx }
    : { ...t, scaleY: -t.scaleY, rotation: -t.rotation, dy: 2 * line - 2 * baseCentre.y - t.dy };
}

/** Mirror every key of a transform track (a NEW track; frames, easing, sampling, box untouched). */
export function mirrorTransformTrack(
  track: TransformTrack,
  baseCentre: Pt,
  axis: "h" | "v",
  line: number,
): TransformTrack {
  return {
    ...track,
    keys: track.keys.map((k) => ({ ...k, v: mirrorTransform(k.v, baseCentre, axis, line) })),
  };
}

/** Rotate about `center` by the angle the pointer swept from `start` to `p`. */
export function applyRotate(t: RefTransform, center: Pt, start: Pt, p: Pt): RefTransform {
  const a0 = Math.atan2(start.y - center.y, start.x - center.x);
  const a1 = Math.atan2(p.y - center.y, p.x - center.x);
  return { ...t, rotation: t.rotation + (a1 - a0) };
}

export interface ComposeStep {
  base: Rect;
  t: RefTransform;
}

function isId(t: RefTransform): boolean {
  return t.dx === 0 && t.dy === 0 && t.scaleX === 1 && t.scaleY === 1 && t.rotation === 0;
}

/** Map p outward through a chain of transforms (inner-to-outer order). Identity steps are skipped. */
export function forwardChain(steps: ComposeStep[], p: Pt): Pt {
  let q = p;
  for (const s of steps) if (!isId(s.t)) q = forwardTransformPoint(s.base, s.t, q);
  return q;
}

/** Map p inward through a chain of transforms (inner-to-outer order); applies each step's inverse
 *  starting from the OUTER end so the result lands in the innermost local space. */
export function inverseChain(steps: ComposeStep[], p: Pt): Pt {
  let q = p;
  for (let i = steps.length - 1; i >= 0; i--)
    if (!isId(steps[i].t)) q = inverseTransformPoint(steps[i].base, steps[i].t, q);
  return q;
}
