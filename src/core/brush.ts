import getStroke from "perfect-freehand";
import type { InputPoint } from "./input";

/**
 * Model 2 pressure→width range. `size` is the nominal (medium) width:
 * light pressure → size / sizeRange (clamped to the 0.5px floor),
 * full pressure → size * sizeRange. `size` is floored at 0.5 before scaling so
 * `max` is unchanged from the legacy model when `sizeRange` is unchanged.
 * `sizeRange === 1` ⇒ constant width (used for the no-pressure / mouse path).
 */
export function widthRange(size: number, sizeRange: number): { min: number; max: number } {
  const floored = Math.max(0.5, size);
  return { min: Math.max(0.5, floored / sizeRange), max: floored * sizeRange };
}

/**
 * perfect-freehand's `smoothing` is not a curve parameter — it is a DECIMATION DISTANCE:
 * an outline point is discarded unless it is farther than `pfSize * smoothing` from the last
 * kept one. `pfSize` comes from the stroke's MAXIMUM radius, but the actual radius varies by
 * `sizeRange²` along the stroke, so where the stroke is thin the spacing can be many times its
 * own width — no outline points are emitted through that run, both walls bridge it with a
 * chord, the chords cross where the path curves, and the nonzero fill leaves a HOLE. That is
 * the reported dashing (CLAUDE.md 2026-08-29).
 *
 * Capping the spacing at the thinnest width the stroke actually reaches removed 89% of the gap
 * cases across a 2,880-combination sweep (185 → 21) while costing the least of the artist's
 * setting. Measuring the stroke's own minimum rather than `widthRange`'s theoretical `min` is
 * what keeps it from over-correcting: a stroke that never presses lightly is never capped.
 *
 * The residual 21 are NOT this defect and are not chaseable here — five of them occur at
 * Smooth 0, where the spacing is 0 and nothing is dropped at all. Those are a self-intersecting
 * outline cancelling under nonzero winding, which the current code has too.
 *
 * Monotonic by construction: the cap can only tighten as a stroke reaches thinner widths, so a
 * live redraw re-decimates toward MORE fidelity and never oscillates.
 */
export function decimationSmoothing(
  smoothing: number,
  minStrokeWidth: number,
  pfSize: number,
): number {
  if (!(pfSize > 0)) return Math.max(0, smoothing);
  const cap = Math.max(0, minStrokeWidth) / pfSize;
  return Math.max(0, Math.min(smoothing, cap));
}

export interface BrushSettings {
  size: number;
  color: string;
  opacity: number;
  smoothing: number;
  isEraser: boolean;
  drawBehind: boolean;
  alphaLock: boolean;
  taper?: boolean;
}

/**
 * Convert perfect-freehand output points to an SVG path string,
 * then fill it on the canvas for smooth, pressure-sensitive strokes.
 */
export function drawStroke(
  ctx: CanvasRenderingContext2D,
  points: InputPoint[],
  settings: BrushSettings,
  done: boolean = false,
  sizeRange: number = 1.0,
) {
  if (points.length === 0) return;

  // Model 2: size is the nominal width; pressure opens the range both ways
  // (light → size/sizeRange clamped at 0.5px, full → size*sizeRange). We map
  // size→pressure ourselves and tell pf thinning=1 so it uses our mapped pressure directly.
  const { min: minSize, max: maxSize } = widthRange(settings.size, sizeRange);
  // Track the thinnest width this stroke actually reaches — decimationSmoothing caps the
  // outline spacing against it so a thin section cannot be bridged by a chord (see there).
  let minStrokeWidth = Infinity;
  const inputPoints = points.map((p) => {
    const desiredSize = minSize + p.pressure * (maxSize - minSize);
    if (desiredSize < minStrokeWidth) minStrokeWidth = desiredSize;
    const mappedPressure = maxSize > 0 ? desiredSize / maxSize : 1;
    return [p.x, p.y, mappedPressure];
  });
  const pfSize = maxSize / 2;

  const strokePoints = getStroke(inputPoints, {
    // perfect-freehand's `size` is a radius basis: with thinning=1 the stroke RADIUS = size*pressure,
    // so diameter = 2*size*pressure. Pass maxSize/2 so the rendered DIAMETER = desiredSize — matching
    // the stamp/ink engines (which treat size as diameter) and the on-canvas size cursor.
    size: pfSize,
    thinning: 1,
    smoothing: decimationSmoothing(settings.smoothing / 100, minStrokeWidth, pfSize),
    streamline: 0.3,
    start: { taper: settings.taper ?? false, cap: !(settings.taper ?? false) },
    end: { taper: settings.taper ?? false, cap: !(settings.taper ?? false) },
    last: done,
    // Always use our supplied (mapped) pressure. perfect-freehand's simulatePressure
    // is velocity-based and would override our size mapping, leaving the cursor
    // (which reflects the envelope) out of sync with the rendered stroke.
    simulatePressure: false,
  });

  if (strokePoints.length < 2) return;

  ctx.save();

  if (settings.isEraser) {
    ctx.globalCompositeOperation = "destination-out";
    ctx.globalAlpha = 1;
  } else if (settings.alphaLock) {
    ctx.globalCompositeOperation = "source-atop";
    ctx.globalAlpha = settings.opacity / 100;
  } else if (settings.drawBehind) {
    ctx.globalCompositeOperation = "destination-over";
    ctx.globalAlpha = settings.opacity / 100;
  } else {
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = settings.opacity / 100;
  }

  ctx.fillStyle = settings.color;
  ctx.beginPath();

  const path = getSvgPathFromStroke(strokePoints);
  const path2d = new Path2D(path);
  ctx.fill(path2d);

  ctx.restore();
}

/**
 * Turn an array of points into a smooth SVG path using quadratic curves.
 * This is the standard approach from the perfect-freehand docs.
 */
function getSvgPathFromStroke(points: number[][]): string {
  if (points.length === 0) return "";

  const max = points.length - 1;

  return points
    .reduce((acc, point, i, arr) => {
      if (i === 0) {
        return `M ${point[0]},${point[1]} Q`;
      }

      const mid = [
        (point[0] + arr[Math.min(i + 1, max)][0]) / 2,
        (point[1] + arr[Math.min(i + 1, max)][1]) / 2,
      ];

      return `${acc} ${point[0]},${point[1]} ${mid[0]},${mid[1]}`;
    }, "")
    .concat(" Z");
}
