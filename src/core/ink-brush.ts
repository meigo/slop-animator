import type { InputPoint } from "./input";
import type { BrushSettings } from "./brush";
import { widthRange } from "./brush";

// Running state for the incremental ink/marker stroke. Reset at each stroke start.
let drawn = 0;
let prevMid: { x: number; y: number } | null = null;

export function resetInkState() {
  drawn = 0;
  prevMid = null;
}

/**
 * Incremental "ink/marker" brush (Atrament-style): draws smooth quadratic segments through
 * the running midpoints of consecutive points, with pressure-driven width. Cheap — each call
 * only renders the points added since the last call, so it stays fast on long strokes.
 *
 * Call resetInkState() at stroke start. The caller sets the dpr transform + selection clip.
 */
export function drawInkStrokeIncremental(
  ctx: CanvasRenderingContext2D,
  points: InputPoint[],
  settings: BrushSettings,
  sizeRange: number = 1.0,
) {
  if (points.length < 2) return;

  // Model 2 range (see widthRange in brush.ts): pressure thins below / widens above nominal.
  const { min: minSize, max: maxSize } = widthRange(settings.size, sizeRange);
  const widthAt = (p: InputPoint) => minSize + p.pressure * (maxSize - minSize);

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = settings.color;
  ctx.globalCompositeOperation = settings.isEraser ? "destination-out" : "source-over";
  ctx.globalAlpha = settings.isEraser ? 1 : settings.opacity / 100;

  // Resume from the first segment not yet drawn; continue the curve from the last midpoint.
  for (let i = Math.max(1, drawn); i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const start = prevMid ?? a;
    ctx.beginPath();
    ctx.lineWidth = (widthAt(a) + widthAt(b)) / 2;
    ctx.moveTo(start.x, start.y);
    ctx.quadraticCurveTo(a.x, a.y, mid.x, mid.y);
    ctx.stroke();
    prevMid = mid;
  }
  drawn = points.length;
}
