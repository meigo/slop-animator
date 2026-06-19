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
  sizeRange: number = 1.0
) {
  if (points.length === 0) return;

  // Model 2: size is the nominal width; pressure opens the range both ways
  // (light → size/sizeRange clamped at 0.5px, full → size*sizeRange). We map
  // size→pressure ourselves and tell pf thinning=1 so it uses our mapped
  // pressure directly: rendered_width = maxSize * mappedPressure.
  const { min: minSize, max: maxSize } = widthRange(settings.size, sizeRange);
  const inputPoints = points.map((p) => {
    const desiredSize = minSize + p.pressure * (maxSize - minSize);
    const mappedPressure = maxSize > 0 ? desiredSize / maxSize : 1;
    return [p.x, p.y, mappedPressure];
  });

  const strokePoints = getStroke(inputPoints, {
    size: maxSize,
    thinning: 1,
    smoothing: settings.smoothing / 100,
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
    .reduce(
      (acc, point, i, arr) => {
        if (i === 0) {
          return `M ${point[0]},${point[1]} Q`;
        }

        const mid = [
          (point[0] + arr[Math.min(i + 1, max)][0]) / 2,
          (point[1] + arr[Math.min(i + 1, max)][1]) / 2,
        ];

        return `${acc} ${point[0]},${point[1]} ${mid[0]},${mid[1]}`;
      },
      ""
    )
    .concat(" Z");
}
