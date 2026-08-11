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
): Promise<VideoExportResult> {
  if (!isVideoExportSupported())
    throw new Error("Video export requires WebCodecs (try Chrome/Edge).");

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
    audioBuffer = await buildExportAudio(project.audio, project.fps, project.frameCount);
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
      // Closing here flushes the encoder now, so an out-of-band encoder error throws here —
      // before the frame loop — instead of surfacing later from output.finalize(), which would
      // otherwise cost the whole render to a failure that happened in the first couple seconds.
      await audioSource.close();
    } catch {
      warning = "the audio failed to encode";
    }
  }

  const dt = 1 / project.fps;
  for (let f = 0; f < project.frameCount; f++) {
    renderFrame(ctx, project, f, dpr, {
      // Video has no alpha codec here (MP4/H.264); a transparent project is intentionally
      // flattened onto project.bgColor.
      drawBg: true,
      includeReference: false,
      boil: project.boil.enabled ? project.boil : undefined,
    });
    await source.add(f * dt, dt);
  }

  await output.finalize();
  const buffer = output.target.buffer!;
  return {
    blob: new Blob([buffer], { type: format === "mp4" ? "video/mp4" : "video/webm" }),
    warning,
  };
}
