import { getAudioContext } from "./context";
import { bufferOffsetForFrame } from "./peaks";
import type { AudioTrack } from "../anim/document";

/** Frames-master audio playback: (re)starts the buffer in sync on play and on loop/jump; stops on
 *  pause. Holds its own track ref (set via setTrack) so it doesn't import appState. */
class AudioEngine {
  private track: AudioTrack | null = null;
  private source: AudioBufferSourceNode | null = null;

  setTrack(track: AudioTrack | null): void {
    this.track = track;
    this.stop();
  }

  /** Start audio aligned to animation `frame`. */
  play(frame: number, fps: number): void {
    if (!this.track) return;
    const ctx = getAudioContext();
    void ctx.resume();
    this.stop();
    const src = ctx.createBufferSource();
    src.buffer = this.track.buffer;
    src.connect(ctx.destination);
    src.start(0, bufferOffsetForFrame(frame, this.track.offsetFrames, fps));
    this.source = src;
  }

  /** Re-align to `frame` only if currently playing (used on loop wrap / range snap). */
  syncTo(frame: number, fps: number): void {
    if (this.source) this.play(frame, fps);
  }

  pause(): void {
    this.stop();
  }

  stop(): void {
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
