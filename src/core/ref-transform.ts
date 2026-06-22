import type { RefTransform } from "../anim/document";

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
export type Handle = "nw" | "ne" | "se" | "sw" | "rotate" | "body" | null;

const MIN_SCALE = 0.05;

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
  const hw = (base.w / 2) * t.scale,
    hh = (base.h / 2) * t.scale;
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
  const hh = (base.h / 2) * t.scale;
  return rotate({ x: c.x, y: c.y - hh - gap }, c, t.rotation);
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
  const c = transformCenter(base, t);
  const local = rotate(p, c, -t.rotation);
  const hw = (base.w / 2) * t.scale,
    hh = (base.h / 2) * t.scale;
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
  return { x: cx + (ox * cos - oy * sin) / t.scale, y: cy + (ox * sin + oy * cos) / t.scale };
}

/** Map a layer-local point out to document space — the forward of inverseTransformPoint. */
export function forwardTransformPoint(base: Rect, t: RefTransform, p: Pt): Pt {
  const cx = base.x + base.w / 2,
    cy = base.y + base.h / 2;
  const ox = (p.x - cx) * t.scale,
    oy = (p.y - cy) * t.scale;
  const cos = Math.cos(t.rotation),
    sin = Math.sin(t.rotation);
  return { x: cx + t.dx + (ox * cos - oy * sin), y: cy + t.dy + (ox * sin + oy * cos) };
}

/** Translate by (ddx, ddy). */
export function applyMove(t: RefTransform, ddx: number, ddy: number): RefTransform {
  return { ...t, dx: t.dx + ddx, dy: t.dy + ddy };
}

/** Uniform scale about `center`: t.scale * |p-center|/|start-center|, clamped. */
export function applyScale(t: RefTransform, center: Pt, start: Pt, p: Pt): RefTransform {
  const d0 = dist(start, center);
  if (d0 < 1e-6) return t;
  return { ...t, scale: Math.max(MIN_SCALE, t.scale * (dist(p, center) / d0)) };
}

/** Rotate about `center` by the angle the pointer swept from `start` to `p`. */
export function applyRotate(t: RefTransform, center: Pt, start: Pt, p: Pt): RefTransform {
  const a0 = Math.atan2(start.y - center.y, start.x - center.x);
  const a1 = Math.atan2(p.y - center.y, p.x - center.x);
  return { ...t, rotation: t.rotation + (a1 - a0) };
}
