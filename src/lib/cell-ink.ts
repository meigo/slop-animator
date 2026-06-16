// Cheap "does this keyframe have any ink?" test for the timeline display.
// A full-resolution scan per cell would be far too expensive to run every render, so we
// downscale the keyframe to a small probe and check it for any non-transparent pixel.
//
// The downscale MUST area-average (imageSmoothingQuality "high"). A single extreme downscale
// of a high-DPR cell canvas (e.g. ~1500px wide → 24px) with the default sparse sampling skips
// thin strokes entirely, so an inked keyframe reads as empty — the canvas composites it but the
// timeline shows no ◆/— marker. A moderate probe size keeps the ratio sane so area-averaging
// reliably preserves thin lines. (A genuinely cleared keyframe still reads empty, as intended.)

const MAX_PROBE = 64; // longest probe side in px (aspect preserved)
let probe: HTMLCanvasElement | null = null;

/** True if `canvas` has no visible ink (every pixel fully transparent in the downscaled probe). */
export function isCellEmpty(canvas: HTMLCanvasElement): boolean {
  if (canvas.width === 0 || canvas.height === 0) return true;
  const scale = Math.min(1, MAX_PROBE / Math.max(canvas.width, canvas.height));
  const pw = Math.max(1, Math.round(canvas.width * scale));
  const ph = Math.max(1, Math.round(canvas.height * scale));
  if (!probe) probe = document.createElement("canvas");
  if (probe.width !== pw) probe.width = pw;
  if (probe.height !== ph) probe.height = ph;
  const ctx = probe.getContext("2d", { willReadFrequently: true })!;
  ctx.clearRect(0, 0, pw, ph);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high"; // area-average so thin strokes survive the downscale
  ctx.drawImage(canvas, 0, 0, pw, ph);
  const { data } = ctx.getImageData(0, 0, pw, ph);
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 0) return false;
  }
  return true;
}
