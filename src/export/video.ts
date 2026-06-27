import {
  Output,
  Mp4OutputFormat,
  WebMOutputFormat,
  BufferTarget,
  CanvasSource,
  QUALITY_HIGH,
} from "mediabunny";
import { renderFrame } from "../anim/render";
import { evenDimensions } from "./frames";
import type { Project } from "../anim/document";

export type VideoFormat = "mp4" | "webm";

/** Video export needs the WebCodecs VideoEncoder (Chromium/Edge, Safari 16.4+). */
export function isVideoExportSupported(): boolean {
  return typeof window !== "undefined" && "VideoEncoder" in window;
}

/**
 * Encode every frame (drawing layers over the paper background, reference layers excluded)
 * to an MP4 (H.264) or WebM (VP9) Blob via mediabunny + WebCodecs.
 */
export async function exportVideo(
  project: Project,
  dpr: number,
  format: VideoFormat,
): Promise<Blob> {
  if (!isVideoExportSupported())
    throw new Error("Video export requires WebCodecs (try Chrome/Edge).");

  const { w, h } = evenDimensions(project.width * dpr, project.height * dpr);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  const output = new Output({
    format: format === "mp4" ? new Mp4OutputFormat() : new WebMOutputFormat(),
    target: new BufferTarget(),
  });
  const source = new CanvasSource(canvas, {
    codec: format === "mp4" ? "avc" : "vp9",
    bitrate: QUALITY_HIGH,
  });
  output.addVideoTrack(source);
  await output.start();

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
  return new Blob([buffer], { type: format === "mp4" ? "video/mp4" : "video/webm" });
}
