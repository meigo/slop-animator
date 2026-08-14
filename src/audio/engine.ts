import { getAudioContext } from "./context";
import { audioPlayPlan, bufferOffsetForFrame } from "./peaks";
import type { AudioTrack } from "../anim/document";

const SCRUB_WINDOW_S = 0.1; // ~100 ms preview per paused playhead move (P2 spec)

/** Frames-master audio playback: (re)starts the buffer in sync on play and on loop/jump; stops on
 *  pause. Holds its own track ref (set via setTrack) so it doesn't import appState. */
class AudioEngine {
  private track: AudioTrack | null = null;
  private source: AudioBufferSourceNode | null = null; // playback (frames-master)
  private scrubSource: AudioBufferSourceNode | null = null; // short scrub window (paused only)

  setTrack(track: AudioTrack | null): void {
    this.track = track;
    this.stop();
  }

  /** Start audio aligned to animation `frame`. */
  play(frame: number, fps: number): void {
    if (!this.track || this.track.muted) return;
    const at = bufferOffsetForFrame(frame, this.track.offsetFrames, fps);
    const plan = audioPlayPlan(at, this.track.buffer.duration);
    if (plan.kind === "silence") {
      this.stop(); // clip already over → silent, animation continues
      return;
    }
    const ctx = getAudioContext();
    void ctx.resume();
    this.stop();
    const src = ctx.createBufferSource();
    src.buffer = this.track.buffer;
    src.connect(ctx.destination);
    // Negative = the clip starts in the future (offset drag pushed it right of the playhead):
    // schedule the start so the audio begins exactly when the frame clock reaches the clip.
    if (plan.kind === "offset") src.start(0, plan.offsetS);
    else src.start(ctx.currentTime + plan.delayS, 0);
    this.source = src;
  }

  /** Re-align to `frame` only if currently playing (used on loop wrap / range snap). */
  syncTo(frame: number, fps: number): void {
    if (this.source) this.play(frame, fps);
  }

  /** ~100 ms audible window at `frame` while paused. Each call replaces the previous window, so
   *  fast scrubs self-coalesce. No-op when muted or while playback owns the output. */
  scrub(frame: number, fps: number): void {
    if (!this.track || this.track.muted || this.source) return;
    const at = bufferOffsetForFrame(frame, this.track.offsetFrames, fps);
    if (at < 0 || at >= this.track.buffer.duration) return; // playhead outside the clip → silence
    const ctx = getAudioContext();
    void ctx.resume();
    this.stopScrub();
    const src = ctx.createBufferSource();
    src.buffer = this.track.buffer;
    src.connect(ctx.destination);
    src.start(0, at);
    src.stop(ctx.currentTime + SCRUB_WINDOW_S);
    src.onended = () => {
      // Self-cleanup when the window ran out naturally (stopScrub handles replacement).
      if (this.scrubSource === src) {
        src.disconnect();
        this.scrubSource = null;
      }
    };
    this.scrubSource = src;
  }

  private stopScrub(): void {
    if (this.scrubSource) {
      try {
        this.scrubSource.stop();
      } catch {
        /* already stopped */
      }
      this.scrubSource.disconnect();
      this.scrubSource = null;
    }
  }

  pause(): void {
    this.stop();
  }

  stop(): void {
    this.stopScrub();
    if (this.source) {
      try {
        this.source.stop();
      } catch {
        /* already stopped */
      }
      this.source.disconnect();
      this.source = null;
    }
  }
}

export const audioEngine = new AudioEngine();
