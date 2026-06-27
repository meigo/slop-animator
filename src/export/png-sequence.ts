import { zipSync } from "fflate";
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

  const files: Record<string, Uint8Array> = {};
  for (let f = 0; f < project.frameCount; f++) {
    renderFrame(ctx, project, f, dpr, {
      drawBg: !project.transparentBg,
      includeReference: false,
      boil: project.boil.enabled ? project.boil : undefined,
    });
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png"),
    );
    files[frameFileName(f, project.frameCount)] = new Uint8Array(await blob.arrayBuffer());
  }
  return new Blob([zipSync(files)], { type: "application/zip" });
}
