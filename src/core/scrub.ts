/**
 * Drag-to-change arithmetic for `lib/NumberField.svelte`. Pure: no DOM, no store.
 *
 * Mirrors slop-video-compositor's `src/lib/scrub.ts`, with the value quantised to the field's own
 * step — the compositor's fields are all 0.01-step floats, while these are whole fps, whole pixels
 * and half-pixel brush sizes, which must not drift off their grid.
 */

/** Travel before a press becomes a drag. Below this it is still a tap that focuses the field for
 *  typing, which is how one control serves both gestures. Same value as the compositor's. */
export const SCRUB_THRESHOLD_PX = 3;

/** Shift costs this many times more travel per step — FINER control on the SAME grid. (The
 *  compositor's Shift multiplies the step by 0.1 instead, which here would produce 0.1 fps.) */
export const FINE_FACTOR = 4;

/** Digits after the point implied by `step`, for display and for float cleanup. */
export function stepDecimals(step: number): number {
  const s = String(step);
  const dot = s.indexOf(".");
  return dot < 0 ? 0 : s.length - dot - 1;
}

export interface ScrubArgs {
  /** Value at pointerdown. The drag is always measured from here, never accumulated, so returning
   *  the pointer to where it was pressed restores the value exactly. */
  startValue: number;
  dx: number; // clientX - startX
  step: number;
  pxPerStep: number;
  fine: boolean; // Shift held
  min: number;
  max: number;
}

export function scrubbedValue({
  startValue,
  dx,
  step,
  pxPerStep,
  fine,
  min,
  max,
}: ScrubArgs): number {
  if (!Number.isFinite(dx)) return startValue;
  const steps = Math.round(dx / (pxPerStep * (fine ? FINE_FACTOR : 1)));
  // Snapped to the grid ANCHORED AT `min`, not at 0: that is the grid the arrow keys and the old
  // spinner walked, so a dragged value lands on the same numbers a typed one does.
  const raw = startValue + steps * step;
  const snapped = min + Math.round((raw - min) / step) * step;
  const clamped = Math.max(min, Math.min(max, snapped));
  return Number(clamped.toFixed(stepDecimals(step)));
}
