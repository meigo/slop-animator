// Cheap "does this keyframe have any ink?" test for the timeline display.
// A full-resolution scan per cell would be far too expensive to run every render, so we
// blit the keyframe down to a small probe canvas and check that for any non-transparent
// pixel. This is approximate at the single-pixel level (a lone dot can average away), which
// is acceptable for a timeline indicator: a cleared/blank keyframe reads as empty, a frame
// with an actual drawing reads as inked.

const PROBE = 24; // probe thumbnail size in px
let probe: HTMLCanvasElement | null = null;

/** True if `canvas` has no visible ink (every pixel fully transparent in the downscaled probe). */
export function isCellEmpty(canvas: HTMLCanvasElement): boolean {
  if (canvas.width === 0 || canvas.height === 0) return true;
  if (!probe) {
    probe = document.createElement("canvas");
    probe.width = PROBE;
    probe.height = PROBE;
  }
  const ctx = probe.getContext("2d", { willReadFrequently: true })!;
  ctx.clearRect(0, 0, PROBE, PROBE);
  ctx.drawImage(canvas, 0, 0, PROBE, PROBE);
  const { data } = ctx.getImageData(0, 0, PROBE, PROBE);
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 0) return false;
  }
  return true;
}
