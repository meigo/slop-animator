/** Next playhead position for a tick. `stop` is true when the end is reached and not looping. */
export function advancePlayhead(
  current: number,
  frameCount: number,
  loop: boolean
): { frame: number; stop: boolean } {
  if (current + 1 < frameCount) return { frame: current + 1, stop: false };
  if (loop) return { frame: 0, stop: false };
  return { frame: current, stop: true };
}

/** Clamp a stored range into [0, frameCount-1]; null or invalid (in>out) → the full timeline. */
export function effectiveRange(
  range: { in: number; out: number } | null,
  frameCount: number,
): { start: number; end: number } {
  const last = Math.max(0, frameCount - 1);
  if (!range) return { start: 0, end: last };
  const start = Math.max(0, Math.min(range.in, last));
  const end = Math.max(0, Math.min(range.out, last));
  if (start > end) return { start: 0, end: last };
  return { start, end };
}

/** Set the range's in-point to `frame`, dragging out along if in would pass it. */
export function withRangeIn(range: { in: number; out: number } | null, frame: number) {
  return { in: frame, out: range ? Math.max(range.out, frame) : frame };
}

/** Set the range's out-point to `frame`, dragging in along if out would precede it. */
export function withRangeOut(range: { in: number; out: number } | null, frame: number) {
  return { in: range ? Math.min(range.in, frame) : frame, out: frame };
}

/** Where the playhead should sit when play starts: snap to `start` only if outside [start, end]. */
export function snapPlayheadToRange(current: number, start: number, end: number): number {
  return current < start || current > end ? start : current;
}

export interface PlaybackOptions {
  getFps: () => number;
  getFrameCount: () => number;
  getLoop: () => boolean;
  getCurrent: () => number;
  setFrame: (frame: number) => void;
  onPlayingChange: (playing: boolean) => void;
}

/**
 * Drives the playhead from wall-clock time. `step(nowMs)` is deterministic and
 * side-effect-injected (testable); `play()`/`pause()` own the requestAnimationFrame loop.
 */
export class Playback {
  private opts: PlaybackOptions;
  private playing = false;
  private accumulatorMs = 0;
  private lastMs: number | null = null;
  private raf = 0;

  constructor(opts: PlaybackOptions) {
    this.opts = opts;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  /** Advance the playhead by however many fps-intervals elapsed since the previous step. */
  step(nowMs: number): void {
    if (this.lastMs === null) {
      this.lastMs = nowMs;
      return;
    }
    this.accumulatorMs += nowMs - this.lastMs;
    this.lastMs = nowMs;

    const frameDurMs = 1000 / this.opts.getFps();
    while (this.accumulatorMs >= frameDurMs) {
      this.accumulatorMs -= frameDurMs;
      const next = advancePlayhead(this.opts.getCurrent(), this.opts.getFrameCount(), this.opts.getLoop());
      if (next.stop) {
        this.playing = false;
        this.opts.onPlayingChange(false);
        return;
      }
      this.opts.setFrame(next.frame);
    }
  }

  play(): void {
    if (this.playing) return;
    this.playing = true;
    this.lastMs = null;
    this.accumulatorMs = 0;
    this.opts.onPlayingChange(true);
    this.scheduleNext();
  }

  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.opts.onPlayingChange(false);
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  private scheduleNext(): void {
    this.raf = requestAnimationFrame((ts) => {
      if (!this.playing) return;
      this.step(ts);
      if (this.playing) this.scheduleNext();
    });
  }
}
