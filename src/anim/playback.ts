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
