/** Two taps on the same target, close in time and place, count as a double-tap. Timed by hand rather
 *  than with `dblclick`, which iPad touch does not fire reliably (the reason the 2026-06-15 rename
 *  spec chose a pencil button). Same window as the canvas's one-finger double-tap (touch-gestures.ts). */
export const DOUBLE_TAP_MS = 300;
/** How far apart the two taps may land: a Pencil or finger never hits the same pixel twice. */
export const DOUBLE_TAP_PX = 10;

export interface Tap {
  /** What was tapped, e.g. `layer:5` — taps on two different rows never pair. */
  target: string;
  /** Event time in ms. */
  t: number;
  x: number;
  y: number;
}

/** Does `next` complete a double-tap begun by `prev`? */
export function isDoubleTap(prev: Tap | null, next: Tap): boolean {
  if (!prev || prev.target !== next.target) return false;
  const dt = next.t - prev.t;
  if (dt < 0 || dt > DOUBLE_TAP_MS) return false;
  return Math.hypot(next.x - prev.x, next.y - prev.y) <= DOUBLE_TAP_PX;
}
