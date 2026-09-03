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

/**
 * A flat nib AMPLIFIES input jitter, and this is the whole reason the next two helpers exist.
 * The swept half-width comes from the travel direction meeting the nib's fixed angle, so a
 * sample that deviates sideways by a fraction of a pixel can swing the width from `b` to `a` —
 * a 20× jump at flatness 0.95 — and paints a spike the length of the nib across a hairline.
 * A round brush shows none of this, because its sweep is direction-independent; measured on a
 * synthetic path, 0.4px of sample jitter already furs the edges and 1.2px produces the spikes
 * reported from a real Pencil stroke. Both stages below are dampers on that amplification, not
 * cosmetic prettifying — remove them and a Pencil stroke grows fur again.
 */

/** Light centred smoothing of the sample positions. Centred, so it costs no lag — this engine
 *  redraws the whole stroke every frame and has the future samples in hand, unlike an
 *  incremental one. Deliberately mild: it removes sub-pixel noise without rounding real corners
 *  (verified against a hard zigzag). */
function smoothPositions(points: InputPoint[]): InputPoint[] {
  if (points.length < 3) return points;
  const K = 2;
  return points.map((p, i) => {
    let sx = 0;
    let sy = 0;
    let sw = 0;
    for (let j = -K; j <= K; j++) {
      const q = points[i + j];
      if (!q) continue;
      const w = K + 1 - Math.abs(j);
      sx += q.x * w;
      sy += q.y * w;
      sw += w;
    }
    return { ...p, x: sx / sw, y: sy / sw };
  });
}

/**
 * The unit normal at each sample, taken over a baseline long enough that jitter cannot rotate
 * it. Baseline length is measured in DISTANCE, not samples: sample density swings with drawing
 * speed, so a fixed sample count would smooth a fast stroke and barely touch a slow one. It
 * scales with the nib's long semi-axis because that is what sets the error — an angular error
 * of σ/L becomes a width error of about a·σ/L, so a baseline near `a` keeps a pixel of jitter
 * to about a pixel of width.
 */
export function normals(
  points: { x: number; y: number }[],
  reach: number,
): { nx: number; ny: number }[] {
  const target = Math.max(2, reach);
  const walk = (i: number, dir: -1 | 1) => {
    let j = i;
    let d = 0;
    while (d < target) {
      const k = j + dir;
      if (k < 0 || k >= points.length) break;
      d += Math.hypot(points[k].x - points[j].x, points[k].y - points[j].y);
      j = k;
    }
    return points[j];
  };
  return points.map((p, i) => {
    const a = walk(i, -1);
    const b = walk(i, 1);
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let len = Math.hypot(dx, dy);
    if (len === 0) {
      // Every sample in reach is coincident (a held pen). Fall back to any neighbour, then to a
      // fixed direction, so the nib still lands instead of dividing by zero.
      const q = points[i + 1] ?? points[i - 1] ?? p;
      dx = q.x - p.x;
      dy = q.y - p.y;
      len = Math.hypot(dx, dy);
      if (len === 0) return { nx: 0, ny: 1 };
    }
    return { nx: -dy / len, ny: dx / len };
  });
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
  const pts = smoothPositions(points);
  const nib = pts.map((p) => nibSemiAxes((minW + p.pressure * (maxW - minW)) / 2, flat));
  // Reach scales with the widest nib the stroke reaches, so the damping matches the worst case
  // rather than whatever width happens to be under the pointer at one sample.
  const nrm = normals(pts, maxW / 2);

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
  addNib(ctx, pts[0].x, pts[0].y, nib[0].a, nib[0].b, angle);

  for (let i = 1; i < pts.length; i++) {
    const p1 = pts[i - 1];
    const p2 = pts[i];
    // Each end offsets along its OWN stabilised normal (see `normals`) rather than along the
    // raw segment's perpendicular. The nib's reach there depends on how the travel direction
    // meets the nib's fixed angle — that is where thick and thin come from, and it is exactly
    // what makes a noisy direction so destructive.
    const n1 = nrm[i - 1];
    const n2 = nrm[i];
    const o1 = nibSupport(nib[i - 1].a, nib[i - 1].b, angle, n1.nx, n1.ny);
    const o2 = nibSupport(nib[i].a, nib[i].b, angle, n2.nx, n2.ny);
    // Wound to match addNib's ellipses (see the note there). The ordering is orientation-stable
    // whichever way the stroke runs: it is built in the (travel, left-normal) frame, which is a
    // rotation of canvas space, and rotations preserve winding — so a stroke that doubles back
    // on itself still unions with its own earlier segments instead of erasing them.
    ctx.moveTo(p1.x + n1.nx * o1, p1.y + n1.ny * o1);
    ctx.lineTo(p1.x - n1.nx * o1, p1.y - n1.ny * o1);
    ctx.lineTo(p2.x - n2.nx * o2, p2.y - n2.ny * o2);
    ctx.lineTo(p2.x + n2.nx * o2, p2.y + n2.ny * o2);
    ctx.closePath();
    addNib(ctx, p2.x, p2.y, nib[i].a, nib[i].b, angle);
  }

  ctx.fill();
  ctx.restore();
}
