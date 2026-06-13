import getStroke from "perfect-freehand";
import type { InputPoint } from "./input";

export interface BrushSettings {
  size: number;
  color: string;
  opacity: number;
  smoothing: number;
  isEraser: boolean;
  drawBehind: boolean;
  alphaLock: boolean;
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

  // sizeRange: light pressure → settings.size, full pressure → settings.size * sizeRange.
  // We handle size-from-pressure ourselves and tell pf thinning=1 so it
  // uses our mapped pressure directly: rendered_width = size * pressure.
  // Use at least 0.5 so strokes can be very thin
  const minSize = Math.max(0.5, settings.size);
  const maxSize = minSize * sizeRange;
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
    start: { taper: false, cap: true },
    end: { taper: false, cap: true },
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
