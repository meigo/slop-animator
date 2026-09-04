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

/**
 * Drop samples closer together than `minDist`. A 120Hz Pencil delivers far more points than the
 * geometry needs, and every one of them costs a subpath in the fill — measured at 6000 points,
 * decimating to 3px took a redraw from 1663ms to 13ms while changing 0.27% of the stroke's ink
 * pixels (i.e. antialiasing noise). The sweep stays geometrically exact at ANY spacing, because
 * the quads below connect consecutive nib positions exactly; decimation only coarsens the PATH,
 * never the ribbon around it. Endpoints are always kept so the stroke still ends where the pen
 * did.
 */
function decimate(points: InputPoint[], minDist: number): InputPoint[] {
  if (points.length < 3) return points;
  const out = [points[0]];
  let last = points[0];
  for (let i = 1; i < points.length - 1; i++) {
    if (Math.hypot(points[i].x - last.x, points[i].y - last.y) >= minDist) {
      out.push(points[i]);
      last = points[i];
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

/**
 * Add one convex ring to the current path, forced to a consistent (positive-area) winding.
 *
 * THIS NORMALISATION IS LOAD-BEARING, and it fails silently when it is missing. The pieces below
 * overlap wherever a stroke crosses itself or reverses, and under nonzero fill two opposite
 * windings CANCEL — punching white slivers through the caps and gashes across the joins. Deriving
 * the sign by hand got it wrong twice here (once as a comb through every join, once as slivers at
 * the caps only), so the winding is now computed rather than reasoned about, and nothing in this
 * file may emit a subpath by any other route.
 */
function addRing(ctx: CanvasRenderingContext2D, ring: number[][]) {
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  const r = area < 0 ? ring.slice().reverse() : ring;
  ctx.moveTo(r[0][0], r[0][1]);
  for (let i = 1; i < r.length; i++) ctx.lineTo(r[i][0], r[i][1]);
  ctx.closePath();
}

/** The nib's own footprint as a polygon rather than `ctx.ellipse`, so it goes through the same
 *  winding normalisation as everything else. Only the two stroke ENDS need one: consecutive quads
 *  share their end edge exactly (same point, same normal, same offset), so they tile the ribbon
 *  with no gaps — an interior cap per sample was the original performance bug, N big ellipses all
 *  overlapping each other in one fill. */
/** Below this much total travel the mark is a tap, not a stroke, and gets the nib's footprint. */
const DAB_TRAVEL_PX = 2;

/** Total travel along the sampled path — used only to tell a dab from a stroke. */
function strokeExtent(points: { x: number; y: number }[]): number {
  let d = 0;
  for (let i = 1; i < points.length; i++) {
    d += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return d;
}

const NIB_SEGMENTS = 20;
function nibRing(cx: number, cy: number, a: number, b: number, angleRad: number): number[][] {
  const ca = Math.cos(angleRad);
  const sa = Math.sin(angleRad);
  const ring: number[][] = [];
  for (let k = 0; k < NIB_SEGMENTS; k++) {
    const t = (k / NIB_SEGMENTS) * Math.PI * 2;
    const px = a * Math.cos(t);
    const py = b * Math.sin(t);
    ring.push([cx + px * ca - py * sa, cy + px * sa + py * ca]);
  }
  return ring;
}

/**
 * Draw the whole stroke. Like the smooth (perfect-freehand) engine and unlike the ink/stamp ones,
 * this is a FULL REDRAW from the pre-stroke snapshot rather than an incremental append: the whole
 * ribbon goes into one path and is filled ONCE, so a translucent stroke has uniform alpha instead
 * of darkening wherever two pieces meet. The caller restores the snapshot first (see
 * `Canvas.svelte`'s calligraphy branch).
 *
 * The ribbon is a chain of quads, one per segment, and they TILE rather than overlap: quad i ends
 * on exactly the edge quad i+1 starts from (same point, same normal, same offset). That is why
 * only the two ends carry a nib footprint. Emitting one per sample — which the first version did —
 * put N big overlapping ellipses into a single fill and made a long stroke quadratic: 1663ms for a
 * 6000-point redraw, against 13ms for this.
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
  // Smooth BEFORE decimating, so the dropped samples still inform the ones that survive; the
  // spacing is capped at 3px (measured harmless) and floored so a small nib is not coarsened.
  const pts = decimate(smoothPositions(points), Math.min(3, Math.max(0.75, maxW / 16)));
  const nib = pts.map((p) => nibSemiAxes((minW + p.pressure * (maxW - minW)) / 2, flat));
  // Reach scales with the widest nib the stroke reaches, so the damping matches the worst case
  // rather than whatever width happens to be under the pointer at one sample.
  const nrm = normals(pts, maxW / 2);
  const offset = (i: number) => nibSupport(nib[i].a, nib[i].b, angle, nrm[i].nx, nrm[i].ny);

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
  // A dab — pen down without travelling — is the one case whose mark IS the nib's footprint, so it
  // is the one case that still gets one. The threshold is a real distance rather than an epsilon:
  // a tap with a Pencil still jitters half a pixel or so, which clears any epsilon and then paints
  // quads of essentially zero area, i.e. NOTHING for a deliberate tap. Caught by testing a jittery
  // dab specifically; an exact-coincidence check looks correct and fails on every real tap.
  if (pts.length < 2 || strokeExtent(pts) < DAB_TRAVEL_PX) {
    addRing(ctx, nibRing(pts[0].x, pts[0].y, nib[0].a, nib[0].b, angle));
  }
  // NOTE: no footprint at the ends of a stroke that travelled. The true swept region does include
  // it — a real broad-edge pen set down and lifted leaves the nib's full shape — but at any real
  // flatness that shape is a long thin sliver lying at the nib angle, and where it protrudes past
  // the ribbon's end it reads as a stray whisker rather than as the stroke ending (reported from a
  // Pencil stroke as "misrotated brush tip stamp"). Ending flush is the deliberate choice: the end
  // cut still lands at the nib's own angle wherever the geometry calls for it, which is the chisel
  // entry/exit that actually reads as calligraphy. Compared side by side before choosing.
  for (let i = 1; i < pts.length; i++) {
    const p1 = pts[i - 1];
    const p2 = pts[i];
    const n1 = nrm[i - 1];
    const n2 = nrm[i];
    const o1 = offset(i - 1);
    const o2 = offset(i);
    addRing(ctx, [
      [p1.x + n1.nx * o1, p1.y + n1.ny * o1],
      [p1.x - n1.nx * o1, p1.y - n1.ny * o1],
      [p2.x - n2.nx * o2, p2.y - n2.ny * o2],
      [p2.x + n2.nx * o2, p2.y + n2.ny * o2],
    ]);
  }

  ctx.fill();
  ctx.restore();
}
