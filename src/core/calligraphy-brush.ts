/**
 * Calligraphy brush — a broad-edge (chisel) nib swept along the path.
 *
 * This is a SWEPT RIBBON, not a stamp engine, and that distinction is the whole reason the
 * file exists. The first implementation drew the nib as a rotated elliptical STAMP through
 * `stamp-brush.ts`, and it beaded: a stamp engine spaces its dabs by the tip's nominal width,
 * but a chisel nib's extent along the direction of travel COLLAPSES as it flattens (that is
 * what makes it calligraphic), so the spacing outruns the footprint and the stroke breaks into
 * discrete blobs. Tightening the spacing only trades beading for saturation, and raising the
 * flatness ceiling only hides the useful part of the range — the values that actually look
 * like calligraphy are exactly the ones that broke.
 *
 * So the nib is swept instead: for each segment, fill the convex hull of the nib ellipse at
 * both endpoints (a quad along the perpendicular offset, plus the ellipse itself at each
 * vertex, which is precisely the correct round join for a Minkowski sweep). Continuous by
 * construction at every flatness, exactly like `ink-brush.ts`'s stroked curve and `brush.ts`'s
 * filled outline are continuous by construction.
 */

import type { InputPoint } from "./input";
import type { BrushSettings } from "./brush";
import { widthRange } from "./brush";

/** 1.0 would collapse the nib's short axis to zero — a stroke with no thickness at all when
 *  travelling along the nib's edge. The sweep itself stays continuous right up to the limit
 *  (unlike the stamped version, which dashed well before it), so this cap is only about
 *  keeping the thinnest stroke renderable rather than about spacing. */
export const MAX_NIB_FLATNESS = 0.95;

export function clampNibFlatness(flatness: number): number {
  return Math.max(0, Math.min(MAX_NIB_FLATNESS, flatness));
}

/** Semi-axes of the nib for a given radius: the long axis (`a`) is always the full radius, so
 *  flatness 0 is an ordinary round tip; the short axis (`b`) shrinks toward (never reaches) 0.
 *  Shared with `BrushCursor`, so the painted nib and its on-canvas preview cannot disagree. */
export function nibSemiAxes(radius: number, flatness: number): { a: number; b: number } {
  const f = clampNibFlatness(flatness);
  return { a: radius, b: radius * (1 - f) };
}

/**
 * How far the nib reaches from its centre along the unit direction (ux, uy) — the ellipse's
 * support function. This is what produces the calligraphic thick/thin: sweeping perpendicular
 * to the nib's long axis returns ~`a` (full width), sweeping along it returns ~`b` (a hairline),
 * and every direction between interpolates.
 */
export function nibSupport(a: number, b: number, angleRad: number, ux: number, uy: number): number {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  const alongMajor = ux * c + uy * s;
  const alongMinor = -ux * s + uy * c;
  return Math.hypot(a * alongMajor, b * alongMinor);
}

/** Start a fresh subpath on the ellipse's own first point, so the ellipse does not get joined
 *  to the previous subpath by a stray connecting line. */
function addNib(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  a: number,
  b: number,
  angleRad: number,
) {
  ctx.moveTo(cx + a * Math.cos(angleRad), cy + a * Math.sin(angleRad));
  // The default (clockwise) sweep matches the winding of the quads below, and that agreement is
  // load-bearing: the ellipses and quads overlap by design, and under nonzero fill two opposite
  // windings CANCEL. Getting this backwards does not fail loudly — it renders the stroke as a
  // fine comb, holes punched at exactly the joins these ellipses exist to fill. Verified by
  // rendering both windings side by side, not by reasoning about the sign.
  ctx.ellipse(cx, cy, a, b, angleRad, 0, Math.PI * 2);
}

/**
 * Draw the whole stroke. Like the smooth (perfect-freehand) engine and unlike the ink/stamp
 * ones, this is a FULL REDRAW from the pre-stroke snapshot rather than an incremental append:
 * the entire ribbon goes into one path and is filled ONCE, so a translucent stroke has uniform
 * alpha instead of darkening everywhere two pieces overlap. The caller restores the snapshot
 * first (see `Canvas.svelte`'s calligraphy branch).
 */
export function drawCalligraphyStroke(
  ctx: CanvasRenderingContext2D,
  points: InputPoint[],
  settings: BrushSettings,
  sizeRange: number = 1.0,
) {
  if (points.length === 0) return;

  const { min: minW, max: maxW } = widthRange(settings.size, sizeRange);
  const angle = ((settings.nibAngle ?? 0) * Math.PI) / 180;
  const flat = clampNibFlatness(settings.nibFlatness ?? 0);
  const nib = points.map((p) => nibSemiAxes((minW + p.pressure * (maxW - minW)) / 2, flat));

  ctx.save();
  if (settings.isEraser) {
    ctx.globalCompositeOperation = "destination-out";
    ctx.globalAlpha = 1;
  } else {
    if (settings.alphaLock) ctx.globalCompositeOperation = "source-atop";
    else if (settings.drawBehind) ctx.globalCompositeOperation = "destination-over";
    else ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = settings.opacity / 100;
  }
  ctx.fillStyle = settings.color;

  ctx.beginPath();
  addNib(ctx, points[0].x, points[0].y, nib[0].a, nib[0].b, angle);

  for (let i = 1; i < points.length; i++) {
    const p1 = points[i - 1];
    const p2 = points[i];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);

    if (len > 0) {
      // Perpendicular to travel. The nib's reach along it depends on how the travel direction
      // meets the nib's fixed angle — that is where thick and thin come from.
      const nx = -dy / len;
      const ny = dx / len;
      const o1 = nibSupport(nib[i - 1].a, nib[i - 1].b, angle, nx, ny);
      const o2 = nibSupport(nib[i].a, nib[i].b, angle, nx, ny);
      // Wound to match addNib's ellipses (see the note there). The ordering is orientation-
      // stable whichever way the stroke runs: it is built in the (travel, left-normal) frame,
      // which is a rotation of canvas space, and rotations preserve winding — so a stroke that
      // doubles back on itself still unions with its own earlier segments instead of erasing
      // them.
      ctx.moveTo(p1.x + nx * o1, p1.y + ny * o1);
      ctx.lineTo(p1.x - nx * o1, p1.y - ny * o1);
      ctx.lineTo(p2.x - nx * o2, p2.y - ny * o2);
      ctx.lineTo(p2.x + nx * o2, p2.y + ny * o2);
      ctx.closePath();
    }
    addNib(ctx, p2.x, p2.y, nib[i].a, nib[i].b, angle);
  }

  ctx.fill();
  ctx.restore();
}
