import { zipSync, type ZipOptions } from "fflate";
import { renderFrame } from "../anim/render";
import { frameFileName } from "./frames";
import type { Project } from "../anim/document";

/**
 * Render every frame (drawing layers over the paper background, reference layers excluded)
 * to a PNG and return a zip Blob containing `frame_0001.png`, `frame_0002.png`, ….
 */
export async function exportPngSequence(project: Project, dpr: number): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = project.width * dpr;
  canvas.height = project.height * dpr;
  const ctx = canvas.getContext("2d")!;

  const files: Record<string, Uint8Array | [Uint8Array, ZipOptions]> = {};
  for (let f = 0; f < project.frameCount; f++) {
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
      files[frameFileName(f, project.frameCount)] = [
        new Uint8Array(await blob.arrayBuffer()),
        { level: 0 },
      ];
    } catch (e) {
      throw new Error(
        `frame ${f + 1} of ${project.frameCount} could not be rendered — ${e instanceof Error ? e.message : String(e)}`,
        { cause: e },
      );
    }
  }
  return new Blob([zipSync(files)], { type: "application/zip" });
}
