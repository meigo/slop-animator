import { zipSync, type ZipOptions } from "fflate";
import { renderFrame } from "../anim/render";
import { frameFileName } from "./frames";
import { abortError, yieldToEventLoop, type ExportProgress } from "./progress";
import type { Project } from "../anim/document";

/**
 * Render one frame (drawing layers over the paper background, reference layers excluded) into
 * `canvas` and encode it as PNG. The sequence export and the single-frame export both go through
 * this, so the two can never disagree about what a frame looks like.
 */
export async function renderFramePng(
  canvas: HTMLCanvasElement,
  project: Project,
  frame: number,
  dpr: number,
  scale = 1,
): Promise<Blob> {
  const ctx = canvas.getContext("2d")!;
  renderFrame(ctx, project, frame, dpr, {
    drawBg: !project.transparentBg,
    includeReference: false,
    boil: project.boil.enabled ? project.boil : undefined,
    outputScale: scale,
  });
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png"),
  );
}

/** A fresh canvas at the project's export size, scaled by `scale` (1 = document size). */
export function exportCanvas(project: Project, dpr: number, scale = 1): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(project.width * dpr * scale));
  canvas.height = Math.max(1, Math.round(project.height * dpr * scale));
  return canvas;
}

/**
 * Render every frame (drawing layers over the paper background, reference layers excluded)
 * to a PNG and return a zip Blob containing `frame_0001.png`, `frame_0002.png`, ….
 */
export async function exportPngSequence(
  project: Project,
  dpr: number,
  range: { start: number; end: number },
  { signal, onProgress, scale = 1 }: ExportProgress & { scale?: number } = {},
): Promise<Blob> {
  const canvas = exportCanvas(project, dpr, scale);

  const files: Record<string, Uint8Array | [Uint8Array, ZipOptions]> = {};
  // The play In/Out range, inclusive. Filenames number the OUTPUT sequence from 1, not the source
  // frame: an image sequence is consumed positionally, and a gap-free run is what every tool
  // downstream expects.
  const total = range.end - range.start + 1;
  for (let f = range.start; f <= range.end; f++) {
    // OUTSIDE the try below, deliberately: an abort must not be caught and re-thrown as
    // "frame N could not be rendered", which would report a deliberate cancel as a defect.
    if (signal?.aborted) throw abortError();
    // Fail with the frame number rather than a bare "toBlob failed" after minutes of work — this is
    // the only pass over every frame, so a one-frame defect can only show up here. Never skip a bad
    // frame: a zip silently missing frame 240 reads as a complete export.
    try {
      const blob = await renderFramePng(canvas, project, f, dpr, scale);
      // PNG is already DEFLATE-compressed internally; store it (level 0) so the zip doesn't burn
      // CPU re-compressing it for ~nothing — same treatment as the key-cell PNGs in project-file.ts.
      files[frameFileName(f - range.start, total)] = [
        new Uint8Array(await blob.arrayBuffer()),
        { level: 0 },
      ];
    } catch (e) {
      throw new Error(
        `frame ${f - range.start + 1} of ${total} (timeline frame ${f + 1}) could not be rendered — ${e instanceof Error ? e.message : String(e)}`,
        { cause: e },
      );
    }
    onProgress?.(f - range.start + 1, total);
    await yieldToEventLoop(); // paint the bar, deliver a Cancel tap
  }
  if (signal?.aborted) throw abortError(); // the last frame's cancel, before the zip is built
  return new Blob([zipSync(files)], { type: "application/zip" });
}
