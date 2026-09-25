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
 * both endpoints (a quad between the nib's support points, plus the ellipse itself at a
 * corner, which is precisely the correct join for a Minkowski sweep). Continuous by
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
  const p = nibSupportPoint(a, b, angleRad, ux, uy);
  return p.x * ux + p.y * uy;
}

/**
 * WHERE the nib reaches farthest along (ux, uy): the support POINT, as an offset from the nib's
 * centre. `nibSupport` is its projection on (ux, uy), so the ribbon keeps exactly the same width;
 * what changes is that the edge sits at the point of the nib that actually touches it. For a flat
 * nib that point lies out near its TIPS, not straight out to the side. The ribbon used to be
 * offset along the normal (`p ± n·nibSupport`), which gave the right width but cut both ends
 * square to the travel instead of along the nib (reported 2026-09-24 with a screenshot: a vertical
 * stroke ending flat under a 45° nib), painted the square corners a real nib never reaches, and
 * left the outside of every sharp corner short, because the tips that carry the edge round a turn
 * were never on it.
 */
export function nibSupportPoint(
  a: number,
  b: number,
  angleRad: number,
  ux: number,
  uy: number,
): { x: number; y: number } {
  return supportPoint(a, b, Math.cos(angleRad), Math.sin(angleRad), ux, uy);
}

/** `nibSupportPoint` with the nib angle's cos/sin precomputed — the stroke loop calls it once per
 *  sample and the angle is constant for the whole stroke. */
function supportPoint(
  a: number,
  b: number,
  c: number,
  s: number,
  ux: number,
  uy: number,
): { x: number; y: number } {
  const alongMajor = ux * c + uy * s;
  const alongMinor = -ux * s + uy * c;
  const h = Math.hypot(a * alongMajor, b * alongMinor);
  // Local support point (a²·α, b²·β) / h, rotated back into the page.
  const lx = (a * a * alongMajor) / h;
  const ly = (b * b * alongMinor) / h;
  return { x: lx * c - ly * s, y: lx * s + ly * c };
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
 * How straight the baseline walk must stay: chord length as a fraction of path length.
 *
 * Without this the walk spans a HAIRPIN: at the apex it lands on one leg going back and on the
 * other going forward, so the chord points across the turn and the normal comes out near-parallel
 * to the travel. The ribbon twists there and leaves the apex uncovered — the corner holes reported
 * on 2026-09-24. Measured on that shape, the apex normal sat 6° off the travel direction where it
 * needs 90°. Stopping at the corner keeps the baseline (and so the damping) on one leg, which is
 * the only place its jitter argument holds anyway: a real corner dwarfs the noise the baseline
 * exists to suppress.
 */
const MIN_STRAIGHTNESS = 0.7;

/**
 * Turn angle (degrees) above which a VERTEX counts as a corner — a place where the path doubles
 * back inside one sample, so no single normal is perpendicular to "the" travel direction, because
 * there are two of them. TEST-ONLY: it names the vertices the `normals` perpendicularity test
 * excuses. The renderer does not read it — what decides where a corner join is drawn is
 * `CORNER_SKEW`, per segment. Changing this changes nothing on screen.
 */
export const CORNER_TURN_DEG = 60;

/**
 * |cos| between a segment's direction and a damped normal above which the segment counts as a
 * CORNER and its piece becomes the hull of the nib at both ends — the exact sweep of that segment,
 * which carries the join that fills the outside of the turn. The quads alone leave it short
 * wherever the damped normal no longer describes the segment, which is only at real turns: along
 * a leg the damped normal stays within a few degrees of perpendicular (see the `normals` tests),
 * and measured on 2000-point jittery strokes this fires zero times. Still ONE subpath per segment,
 * unlike the per-vertex footprint join rejected earlier (see the corner-holes CHANGELOG entries).
 */
const CORNER_SKEW = 0.5;

/** How much travel the straightness test waits for before it trusts the ratio. Over one or two
 *  samples the ratio is mostly jitter, and testing it there would stop the walk on noise — which
 *  hands back exactly the per-segment normal this baseline exists to avoid. */
const CHORD_SETTLE_PX = 2;

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
  // Returns where the walk stopped, how far it got, and whether it stopped because the STROKE ran
  // out (as opposed to reaching `want` or a corner).
  const walk = (i: number, dir: -1 | 1, want: number) => {
    let j = i;
    let d = 0;
    let ranOut = false;
    while (d < want) {
      const k = j + dir;
      if (k < 0 || k >= points.length) {
        ranOut = true;
        break;
      }
      const stepLen = Math.hypot(points[k].x - points[j].x, points[k].y - points[j].y);
      const chord = Math.hypot(points[k].x - points[i].x, points[k].y - points[i].y);
      const travelled = d + stepLen;
      // STRAIGHTNESS, not direction: on a hairpin the chord from the start points much the same way
      // before and after the apex (the legs are nearly antiparallel), so a direction test cannot see
      // the corner at all — measured 0.93 alignment with one. What does change is that the path
      // keeps growing while the chord stops. Jitter costs a few percent of this ratio; rounding a
      // corner collapses it.
      if (travelled >= CHORD_SETTLE_PX && chord < MIN_STRAIGHTNESS * travelled) break;
      d = travelled;
      j = k;
    }
    return { p: points[j], d, ranOut };
  };
  return points.map((p, i) => {
    // Near an END of the stroke one side runs out of samples, which halves the baseline exactly
    // where it matters most: with edges at the nib's support points, a normal error there moves
    // the END CUT along the nib by about a²/b per radian (a flat nib turns 1° into ~5px), and the
    // live end is redrawn on every Pencil move — measured at 1px jitter it jumped ~7px between
    // frames. So the other side walks the shortfall instead, keeping the baseline its full length.
    // Only running out of STROKE triggers this; a walk stopped by a corner stays stopped.
    let back = walk(i, -1, target);
    const fwd = walk(i, 1, target + (back.ranOut ? target - back.d : 0));
    if (fwd.ranOut) back = walk(i, -1, target + (target - fwd.d));
    const a = back.p;
    const b = fwd.p;
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
/** A corner join's nib outline is coarser than a dab's: it only fills the outside of a turn, and
 *  its vertices are what a dense scribble pays for. Measured on a 6000-point hatch (534 joins):
 *  20 points took a redraw from ~200ms to ~320ms, 8 to ~250ms, while leaving 7-20px² of a sharp
 *  corner short against 4-9px² for 20 — facets on the outer edge, not holes. */
const JOIN_SEGMENTS = 8;
function nibRing(
  cx: number,
  cy: number,
  a: number,
  b: number,
  angleRad: number,
  segments = NIB_SEGMENTS,
): number[][] {
  const ca = Math.cos(angleRad);
  const sa = Math.sin(angleRad);
  const ring: number[][] = [];
  for (let k = 0; k < segments; k++) {
    const t = (k / segments) * Math.PI * 2;
    const px = a * Math.cos(t);
    const py = b * Math.sin(t);
    ring.push([cx + px * ca - py * sa, cy + px * sa + py * ca]);
  }
  return ring;
}

/** Do all of a polygon's turns go the same way (it is convex, so it cannot cross itself)? */
function isConvex(ring: number[][]): boolean {
  let left = false;
  let right = false;
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[(i + 1) % ring.length];
    const [cx, cy] = ring[(i + 2) % ring.length];
    const turn = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
    if (turn > 0) left = true;
    else if (turn < 0) right = true;
  }
  return !(left && right);
}

/**
 * Convex hull of a few points (monotone chain), counter-clockwise. Each segment piece goes through
 * this because a quad built from two per-sample normals is NOT always a simple polygon: where the
 * normal swings past 90° between two samples — every sharp turn — the quad twists into a BOWTIE.
 * Its two lobes wind in opposite directions, `addRing` can only make one of them positive, and
 * under nonzero fill the other CANCELS the ink of whatever piece it overlaps: the holes at corners
 * reported (twice) on 2026-09-24. A hull cannot cross itself, so every piece winds positive and no
 * overlap can ever cancel. On an untwisted quad it is the same quad (or a hair larger where the
 * width changes fast); on a bowtie it is the untwisted quad, which is what the segment sweeps.
 */
function convexHull(pts: number[][]): number[][] {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: number[][] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0)
      lower.pop();
    lower.push(q);
  }
  const upper: number[][] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0)
      upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Does the path turn by more than `CORNER_TURN_DEG` at `b`? Coincident neighbours count as no turn:
 *  a held pen delivers them in bursts and they carry no direction to compare. */
export function isCorner(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
): boolean {
  const ix = b.x - a.x;
  const iy = b.y - a.y;
  const ox = c.x - b.x;
  const oy = c.y - b.y;
  const il = Math.hypot(ix, iy);
  const ol = Math.hypot(ox, oy);
  if (il === 0 || ol === 0) return false;
  const cos = (ix / il) * (ox / ol) + (iy / il) * (oy / ol);
  return cos < Math.cos((CORNER_TURN_DEG * Math.PI) / 180);
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
 * no interior sample carries a nib footprint, except inside a corner segment's own hull (see
 * `CORNER_SKEW`). Emitting one per sample — which the first version did —
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
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  // Once per sample: each one is the end of one segment and the start of the next.
  const off = pts.map((_, i) => supportPoint(nib[i].a, nib[i].b, cosA, sinA, nrm[i].nx, nrm[i].ny));

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
  // cut is the chord between the nib's two support points, which lies along the nib — the chisel
  // entry/exit that actually reads as calligraphy. Compared side by side before choosing.
  for (let i = 1; i < pts.length; i++) {
    const p1 = pts[i - 1];
    const p2 = pts[i];
    const o1 = off[i - 1];
    const o2 = off[i];
    const piece = [
      [p1.x + o1.x, p1.y + o1.y],
      [p1.x - o1.x, p1.y - o1.y],
      [p2.x - o2.x, p2.y - o2.y],
      [p2.x + o2.x, p2.y + o2.y],
    ];
    let join = false;
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    if (len > 0) {
      const ux = dx / len;
      const uy = dy / len;
      const skew = Math.max(
        Math.abs(ux * nrm[i - 1].nx + uy * nrm[i - 1].ny),
        Math.abs(ux * nrm[i].nx + uy * nrm[i].ny),
      );
      if (skew > CORNER_SKEW) {
        join = true;
        const n1 = nib[i - 1];
        const n2 = nib[i];
        piece.push(
          ...nibRing(p1.x, p1.y, n1.a, n1.b, angle, JOIN_SEGMENTS),
          ...nibRing(p2.x, p2.y, n2.a, n2.b, angle, JOIN_SEGMENTS),
        );
      }
    }
    // Hulled, not emitted raw, wherever it could cross itself: at a sharp turn the raw quad is a
    // bowtie (see `convexHull`). An already-convex quad — nearly every segment — is its own hull
    // and goes straight in, sparing the sort and arrays on every live redraw.
    addRing(ctx, join || !isConvex(piece) ? convexHull(piece) : piece);
  }

  ctx.fill();
  ctx.restore();
}
