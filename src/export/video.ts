import {
  Output,
  Mp4OutputFormat,
  WebMOutputFormat,
  BufferTarget,
  CanvasSource,
  AudioBufferSource,
  QUALITY_HIGH,
  getFirstEncodableAudioCodec,
} from "mediabunny";
import { renderFrame } from "../anim/render";
import { evenDimensions } from "./frames";
import { buildExportAudio } from "./audio-mix";
import { abortError, yieldToEventLoop, type ExportProgress } from "./progress";
import type { Project } from "../anim/document";

export type VideoFormat = "mp4" | "webm";

export interface VideoExportResult {
  blob: Blob;
  /** Set when the video was produced but its audio had to be dropped. */
  warning?: string;
}

/** Video export needs the WebCodecs VideoEncoder (Chromium/Edge, Safari 16.4+). */
export function isVideoExportSupported(): boolean {
  return typeof window !== "undefined" && "VideoEncoder" in window;
}

/**
 * Encode every frame (drawing layers over the paper background, reference layers excluded)
 * to an MP4 (H.264) or WebM (VP9) Blob via mediabunny + WebCodecs, with the project audio
 * track muxed in when there is one.
 */
export async function exportVideo(
  project: Project,
  dpr: number,
  format: VideoFormat,
  range: { start: number; end: number },
  { signal, onProgress }: ExportProgress = {},
): Promise<VideoExportResult> {
  if (!isVideoExportSupported())
    throw new Error("Video export requires WebCodecs (try Chrome/Edge).");

  const frameTotal = range.end - range.start + 1;
  const { w, h } = evenDimensions(project.width * dpr, project.height * dpr);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  const outputFormat = format === "mp4" ? new Mp4OutputFormat() : new WebMOutputFormat();
  const output = new Output({ format: outputFormat, target: new BufferTarget() });
  const source = new CanvasSource(canvas, {
    codec: format === "mp4" ? "avc" : "vp9",
    bitrate: QUALITY_HIGH,
  });
  output.addVideoTrack(source);

  // Audio is decided BEFORE start() — tracks cannot be added afterwards. Every failure here
  // drops the audio and reports it; none of them may cost the caller the whole render.
  let warning: string | undefined;
  let audioBuffer: AudioBuffer | null = null;
  try {
    // The window is the RANGE, and it starts at `range.start` — the audio has to begin from
    // whatever is playing there, not from the animation's opening.
    audioBuffer = await buildExportAudio(project.audio, project.fps, frameTotal, range.start);
  } catch {
    warning = "the audio could not be prepared";
  }
  let audioSource: AudioBufferSource | null = null;
  if (audioBuffer) {
    try {
      // Probe only the one codec this container actually needs (aac/mp4, opus/webm), not
      // outputFormat.getSupportedAudioCodecs() — that list also includes PCM, and mediabunny's
      // canEncodeAudio reports PCM as always encodable ("we encode these ourselves"), so probing
      // the full list can never return null. That would mask a missing AAC/Opus encoder instead
      // of warning about it.
      const codec = await getFirstEncodableAudioCodec([format === "mp4" ? "aac" : "opus"], {
        numberOfChannels: audioBuffer.numberOfChannels,
        sampleRate: audioBuffer.sampleRate,
        bitrate: QUALITY_HIGH,
      });
      if (codec) {
        const s = new AudioBufferSource({ codec, bitrate: QUALITY_HIGH });
        output.addAudioTrack(s);
        audioSource = s;
      } else {
        warning = `this browser has no audio encoder for ${format.toUpperCase()}`;
      }
    } catch {
      warning = `this browser could not set up audio for ${format.toUpperCase()}`;
    }
  }

  await output.start();

  if (audioSource && audioBuffer) {
    try {
      await audioSource.add(audioBuffer);
      // Closing here starts the encoder flush now, so it runs alongside the frame loop instead of
      // only at output.finalize(). close() returns void — it does NOT surface the flush error at
      // this line, and an out-of-band encoder error still throws from finalize() and still costs
      // the render. What this buys is time-to-failure, not the file. See CLAUDE.md's Audio Phase 3
      // entry for the two real outcomes.
      await audioSource.close();
    } catch {
      warning = "the audio failed to encode";
    }
  }

  const dt = 1 / project.fps;
  // Timestamps run from 0 for the OUTPUT, so a range export is a normal clip that starts at zero
  // rather than a file with a gap of silence-and-nothing at its head.
  for (let f = range.start; f <= range.end; f++) {
    // Outside the try, so a cancel is never reported as a frame defect. `output.cancel()` is
    // mediabunny's own teardown — it releases the encoder and, unlike finalize(), produces no file.
    if (signal?.aborted) {
      await output.cancel();
      throw abortError();
    }
    // Export is the only code that renders EVERY frame, so it is where a defect that fires on one
    // frame surfaces — after minutes of encoding, and with nothing saying which frame. Name it.
    // Deliberately not skip-and-continue: a file that is quietly short (or missing a drawing) is
    // worse than no file, because it looks finished.
    try {
      // The canvas is padded to even dimensions, and `renderFrame` only clears/fills the DOCUMENT
      // rect — so the pad strip would stay transparent and encode as garbage. Fill the whole surface
      // first; renderFrame repaints the document area over it.
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = project.bgColor;
      ctx.fillRect(0, 0, w, h);
      renderFrame(ctx, project, f, dpr, {
        // Video has no alpha codec here (MP4/H.264); a transparent project is intentionally
        // flattened onto project.bgColor.
        drawBg: true,
        includeReference: false,
        boil: project.boil.enabled ? project.boil : undefined,
      });
      await source.add((f - range.start) * dt, dt);
    } catch (e) {
      throw new Error(
        `frame ${f - range.start + 1} of ${frameTotal} (timeline frame ${f + 1}) could not be encoded — ${e instanceof Error ? e.message : String(e)}`,
        { cause: e },
      );
    }
    onProgress?.(f - range.start + 1, frameTotal);
    await yieldToEventLoop(); // paint the bar, deliver a Cancel tap
  }

  if (signal?.aborted) {
    await output.cancel();
    throw abortError();
  }
  // Past this point cancel is refused (the dialog disables the button): finalize is where the
  // container is assembled, and interrupting it can only yield a file we would discard anyway.
  await output.finalize();
  const buffer = output.target.buffer!;
  return {
    blob: new Blob([buffer], { type: format === "mp4" ? "video/mp4" : "video/webm" }),
    warning,
  };
}
