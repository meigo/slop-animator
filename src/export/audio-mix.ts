import { bufferOffsetForFrame } from "../audio/peaks";

/** Just the fields the plan needs, so it stays node-testable (an AudioBuffer cannot be built
 *  in the test env — `durationS` is the source buffer's duration in seconds). */
export interface AudioExportInput {
  offsetFrames: number;
  muted: boolean;
  durationS: number;
}

export interface AudioExportPlan {
  /** The export window: the animation's own length in seconds. */
  windowS: number;
  /** Seconds into the window where the clip begins (0 unless it was dragged right of frame 0). */
  startAt: number;
  /** Seconds into the source buffer to start from (0 unless it was dragged left of frame 0). */
  sourceOffset: number;
}

/**
 * Where the audio clip sits inside an export of `frameCount` frames, or null when the export
 * should carry no audio track at all: no track, muted (mute means silent export), or the clip
 * lies entirely outside the window in either direction.
 *
 * The two branches mirror `AudioEngine.play` exactly — same `bufferOffsetForFrame` rule — so
 * export alignment and playback alignment cannot drift apart.
 */
export function audioExportPlan(
  input: AudioExportInput | null,
  fps: number,
  frameCount: number,
): AudioExportPlan | null {
  if (!input || input.muted) return null;
  const windowS = frameCount / fps;
  const at = bufferOffsetForFrame(0, input.offsetFrames, fps);
  const startAt = at >= 0 ? 0 : -at;
  const sourceOffset = at >= 0 ? at : 0;
  if (startAt >= windowS || sourceOffset >= input.durationS) return null;
  return { windowS, startAt, sourceOffset };
}
