/**
 * iOS WebKit refuses a canvas whose width × height is over 16,777,216 px ("Canvas area exceeds the
 * maximum limit"): its 2D context then draws nothing, so the canvas shows blank. Desktop browsers
 * allow far more, so nothing local shows it (review 2026-10-17 #10).
 */
export const MAX_CANVAS_AREA = 16_777_216;

/** Whether a `w` × `h` canvas is within `MAX_CANVAS_AREA`. */
export function fitsCanvasArea(w: number, h: number): boolean {
  return Math.round(w) * Math.round(h) <= MAX_CANVAS_AREA;
}

/**
 * The backing scale for a `w` × `h` (device px) canvas: `scale`, lowered just enough that the
 * rounded backing store stays within `MAX_CANVAS_AREA` — a zoomed display loses sharpness instead of
 * going blank. Never below 1: a document that is itself over the limit is over it in its cells
 * too, which no display scale can help, and below 1 the display would lose pixels on every device.
 */
export function capScaleToArea(scale: number, w: number, h: number): number {
  if (scale <= 1 || fitsCanvasArea(w * scale, h * scale)) return scale;
  let s = Math.sqrt(MAX_CANVAS_AREA / (w * h));
  const step = 1 / Math.max(w, h); // one backing pixel on the longer side
  while (s > 1 && !fitsCanvasArea(w * s, h * s)) s -= step;
  return Math.max(1, Math.min(scale, s));
}
