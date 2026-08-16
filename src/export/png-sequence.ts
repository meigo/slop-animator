import { zipSync, type ZipOptions } from "fflate";
import { renderFrame } from "../anim/render";
import { frameFileName } from "./frames";
import { abortError, yieldToEventLoop, type ExportProgress } from "./progress";
import type { Project } from "../anim/document";

/**
 * Render every frame (drawing layers over the paper background, reference layers excluded)
 * to a PNG and return a zip Blob containing `frame_0001.png`, `frame_0002.png`, ….
 */
export async function exportPngSequence(
  project: Project,
  dpr: number,
  range: { start: number; end: number },
  { signal, onProgress }: ExportProgress = {},
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = project.width * dpr;
  canvas.height = project.height * dpr;
  const ctx = canvas.getContext("2d")!;

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
      renderFrame(ctx, project, f, dpr, {
        drawBg: !project.transparentBg,
        includeReference: false,
        boil: project.boil.enabled ? project.boil : undefined,
      });
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png"),
      );
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
