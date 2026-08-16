import { bufferOffsetForFrame } from "../audio/peaks";
import { audioTrimSpan } from "../audio/trim";
import type { AudioTrack } from "../anim/document";

/** Just the fields the plan needs, so it stays node-testable (an AudioBuffer cannot be built
 *  in the test env — `durationS` is the source buffer's duration in seconds). */
export interface AudioExportInput {
  offsetFrames: number;
  muted: boolean;
  durationS: number;
  trimInFrames?: number;
  trimLenFrames?: number;
}

export interface AudioExportPlan {
  /** The export window: the animation's own length in seconds. */
  windowS: number;
  /** Seconds into the window where the clip begins (0 unless it was dragged right of frame 0). */
  startAt: number;
  /** Seconds into the source buffer to start from (0 unless it was dragged left of frame 0). */
  sourceOffset: number;
  /** Seconds of source to play from `sourceOffset`, so the trimmed tail is not rendered. */
  sourceDuration: number;
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
  windowFrames: number,
  startFrame = 0,
): AudioExportPlan | null {
  if (!input || input.muted) return null;
  const windowS = windowFrames / fps;
  const { inS, lenS } = audioTrimSpan(
    input.trimInFrames,
    input.trimLenFrames,
    input.durationS,
    fps,
  );
  // The window's FIRST frame, not frame 0 — an In/Out export starts partway into the timeline, and
  // the audio has to start from whatever is playing there. Passing 0 here would export the range's
  // pictures against the animation's opening audio.
  const at = bufferOffsetForFrame(startFrame, input.offsetFrames, fps); // KEPT-SPAN time
  const startAt = at >= 0 ? 0 : -at;
  const keptOffset = at >= 0 ? at : 0; // seconds into the KEPT span
  if (startAt >= windowS || keptOffset >= lenS) return null;
  return {
    windowS,
    startAt,
    // Buffer time: the in-point is added HERE, the same rule the engine follows.
    sourceOffset: keptOffset + inS,
    // Never render past the kept span, nor past the window.
    sourceDuration: Math.min(lenS - keptOffset, windowS - startAt),
  };
}

/** Accepted by both AAC (MP4) and Opus (WebM), so a 44.1 kHz import needs no special case. */
const EXPORT_SAMPLE_RATE = 48000;

// Module scope above this point must stay DOM-free (no OfflineAudioContext/AudioBuffer at the
// top level) — `audioExportPlan` is imported directly by node tests, and a DOM reference at
// module scope would fail to import outside a browser.
/**
 * The project's audio as ONE buffer exactly the export's length, with the clip at its
 * `offsetFrames` position: silence before it, cut off at the window end, resampled to 48 kHz.
 * Null when the export should carry no audio track (see `audioExportPlan`).
 *
 * One OfflineAudioContext render does placement, truncation and resampling together — the
 * context's own length is the truncation, and its sample rate is the resample.
 */
export async function buildExportAudio(
  track: AudioTrack | null,
  fps: number,
  windowFrames: number,
  startFrame = 0,
): Promise<AudioBuffer | null> {
  const plan = audioExportPlan(
    track && {
      offsetFrames: track.offsetFrames,
      muted: track.muted,
      durationS: track.buffer.duration,
      trimInFrames: track.trimInFrames,
      trimLenFrames: track.trimLenFrames,
    },
    fps,
    windowFrames,
    startFrame,
  );
  if (!plan || !track) return null;

  const ctx = new OfflineAudioContext(
    Math.min(track.buffer.numberOfChannels, 2),
    Math.ceil(plan.windowS * EXPORT_SAMPLE_RATE),
    EXPORT_SAMPLE_RATE,
  );
  const src = ctx.createBufferSource();
  src.buffer = track.buffer;
  src.connect(ctx.destination);
  // The same two branches AudioEngine.play takes: the clip either starts late inside the
  // window, or begins partway into its own buffer. Never both (see audioExportPlan).
  src.start(plan.startAt, plan.sourceOffset, plan.sourceDuration);
  return ctx.startRendering();
}
