/**
 * Momentum for the timeline's hand-rolled finger pan.
 *
 * The timeline cannot use native touch scrolling: its rows set `touch-action: none` so a Pencil
 * drag edits rather than scrolls (gotcha #10), which disables the browser's scrolling — and its
 * inertia — for fingers too. So a finger drag starting on a row moved 1:1 and stopped dead, while
 * one starting on empty space kept the native fling. This restores the fling for the custom path.
 */

export interface PanSample {
  /** ms, from a monotonic clock. */
  t: number;
  x: number;
  y: number;
}

/** Only samples this recent contribute to the release velocity. */
export const FLING_WINDOW_MS = 80;
/** px/ms below which a release is a stop, not a fling (and a glide has ended). */
export const FLING_MIN_V = 0.08;
/** Exponential decay per ms — ~0.996^ms, so a fling coasts for roughly a second. */
export const FLING_DECAY = 0.004;
/** Hard cap on release speed (px/ms), so a flick can't launch the view into next week. */
export const FLING_MAX_V = 4;

/**
 * Release velocity in px/ms, measured over the last `FLING_WINDOW_MS` of the gesture.
 *
 * Measuring across a WINDOW rather than the last two events is what makes a hold-then-release stop
 * dead: if the finger rested before lifting, the samples inside the window are all at the same
 * place, so the velocity is zero and nothing is thrown. Sampling only the final pair would instead
 * divide a one-pixel jitter by a couple of milliseconds and fling hard.
 */
export function flingVelocity(samples: PanSample[], now: number): { vx: number; vy: number } {
  const recent = samples.filter((s) => now - s.t <= FLING_WINDOW_MS);
  if (recent.length < 2) return { vx: 0, vy: 0 };
  const first = recent[0];
  const last = recent[recent.length - 1];
  const dt = last.t - first.t;
  if (dt <= 0) return { vx: 0, vy: 0 };
  return {
    vx: clampV((last.x - first.x) / dt),
    vy: clampV((last.y - first.y) / dt),
  };
}

function clampV(v: number): number {
  return Math.max(-FLING_MAX_V, Math.min(FLING_MAX_V, v));
}

/** Velocity after coasting for `dtMs`. Frame-rate independent, so a dropped frame doesn't shorten
 *  the glide the way a per-frame multiplier would. */
export function decayVelocity(v: number, dtMs: number): number {
  return v * Math.exp(-FLING_DECAY * dtMs);
}

/** Has the glide finished? Both axes must be under the threshold — a diagonal fling keeps going
 *  while either axis still carries speed. */
export function flingSpent(vx: number, vy: number): boolean {
  return Math.abs(vx) < FLING_MIN_V && Math.abs(vy) < FLING_MIN_V;
}

/**
 * Advance one axis by `dt`, clamped to `[0, max]`, reporting whether it hit a bound.
 *
 * The caller must keep this returned `pos` and feed it back next frame rather than re-reading
 * `element.scrollLeft`. **`scrollLeft` is not a faithful round trip**: WebKit snaps it to whole
 * device pixels, so a written 123.4 reads back 123. Accumulating from the readback loses the
 * fraction every frame — and a slow glide, whose per-frame step is under a pixel, stalls outright.
 * It also means an `!==` comparison against the written value is NOT an edge test: it fires on the
 * very first frame from rounding alone, which silently killed the whole fling on iPad while looking
 * fine on desktop Chrome (which keeps scroll offsets fractional). Compare against the BOUND instead,
 * which is what this does.
 */
export function stepFlingAxis(
  pos: number,
  v: number,
  dt: number,
  max: number,
): { pos: number; v: number } {
  const limit = Math.max(0, max);
  const next = pos - v * dt; // velocity is POINTER travel; the content moves the other way
  const clamped = Math.max(0, Math.min(limit, next));
  // Hitting an end stops that axis rather than coasting against the clamp for the rest of the glide.
  return { pos: clamped, v: clamped === next ? v : 0 };
}
